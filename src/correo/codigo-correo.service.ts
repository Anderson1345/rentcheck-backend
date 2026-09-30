import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, PropositoCodigoCorreo } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ESPERA_ENTRE_ENVIOS_SEGUNDOS,
  MAX_ENVIOS_POR_HORA,
  MAX_INTENTOS_CODIGO,
  VIGENCIA_CODIGO_MINUTOS,
} from './correo.constants';
import { CorreoService } from './correo.service';
import {
  generarCodigoNumerico,
  hashCodigoCorreo,
  hashesIguales,
} from './codigo-correo.util';

const MINUTO_MS = 60 * 1000;

/** Se lanza dentro de la transacción de `verificar` para revertirla sin consumir el código. */
class ReversionDeVerificacion extends Error {}

/**
 * Códigos de 6 dígitos enviados por correo (D-10). Solo se guarda su
 * HMAC-SHA256; el código en claro vive unos milisegundos en memoria y solo se
 * escribe en un log en el canal `consola`. Lo reutiliza la verificación del
 * correo y, en B0.4-D2, la recuperación de contraseña.
 *
 * Las fechas de la tabla se escriben siempre desde el servidor (no con el
 * `now()` de la base) para compararlas sin depender de la zona horaria de la
 * sesión de la base de datos.
 */
@Injectable()
export class CodigoCorreoService {
  private readonly logger = new Logger(CodigoCorreoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly correo: CorreoService,
  ) {}

  private hash(
    correo: string,
    proposito: PropositoCodigoCorreo,
    codigo: string,
  ): string {
    return hashCodigoCorreo(
      this.config.getOrThrow<string>('JWT_SECRET'),
      correo,
      proposito,
      codigo,
    );
  }

  /**
   * Crea un código nuevo y lo envía, si corresponde: no antes de 60 s desde el
   * último envío ni más de 5 por hora (por correo y propósito). Crear uno
   * consume los anteriores. El envío va FUERA de la transacción. Nunca lanza:
   * devuelve si se envió (un fallo del canal se registra sin el código).
   */
  async emitir(
    correo: string,
    proposito: PropositoCodigoCorreo,
  ): Promise<boolean> {
    let codigo: string | null;
    try {
      codigo = await this.prepararCodigo(correo, proposito);
    } catch (error) {
      this.logger.error(
        `No se pudo preparar el código de ${proposito}: ${this.describir(error)}`,
      );
      return false;
    }
    if (codigo === null) {
      return false;
    }
    try {
      await this.correo.enviarCodigoVerificacion(correo, codigo);
      return true;
    } catch (error) {
      this.logger.warn(
        `No se pudo enviar el correo de ${proposito}: ${this.describir(error)}`,
      );
      return false;
    }
  }

  private describir(error: unknown): string {
    return error instanceof Error ? error.message : 'error desconocido';
  }

  private prepararCodigo(
    correo: string,
    proposito: PropositoCodigoCorreo,
  ): Promise<string | null> {
    return this.prisma.$transaction(async (tx) => {
      // Serializa los envíos del mismo correo y propósito: la espera y el tope
      // se comprueban y se escriben bajo el mismo bloqueo.
      const clave = `codigo-correo|${correo}|${proposito}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${clave}))`;
      const ahora = new Date();

      const ultimo = await tx.codigoCorreo.findFirst({
        where: { correo, proposito },
        orderBy: { creado_en: 'desc' },
        select: { creado_en: true },
      });
      if (
        ultimo &&
        ahora.getTime() - ultimo.creado_en.getTime() <
          ESPERA_ENTRE_ENVIOS_SEGUNDOS * 1000
      ) {
        return null;
      }
      const enLaUltimaHora = await tx.codigoCorreo.count({
        where: {
          correo,
          proposito,
          creado_en: { gt: new Date(ahora.getTime() - 60 * MINUTO_MS) },
        },
      });
      if (enLaUltimaHora >= MAX_ENVIOS_POR_HORA) {
        return null;
      }

      // El código nuevo invalida los anteriores.
      await tx.codigoCorreo.updateMany({
        where: { correo, proposito, consumido_en: null },
        data: { consumido_en: ahora },
      });
      const codigo = generarCodigoNumerico();
      await tx.codigoCorreo.create({
        data: {
          correo,
          proposito,
          codigo_hash: this.hash(correo, proposito, codigo),
          expira_en: new Date(
            ahora.getTime() + VIGENCIA_CODIGO_MINUTOS * MINUTO_MS,
          ),
          creado_en: ahora,
        },
      });
      return codigo;
    });
  }

  /**
   * Comprueba un código. Devuelve true solo si el último código vigente (sin
   * consumir, sin vencer y con intentos disponibles) coincide; en ese caso lo
   * consume y, dentro de la MISMA transacción, ejecuta `alConsumir`: si esa
   * función devuelve false todo se revierte (el código no se gasta).
   *
   * Cada intento cuenta: el contador sube con un UPDATE atómico condicionado
   * (`intentos < 5`), así que ni las peticiones en paralelo superan 5
   * comparaciones; al llegar a 5 fallos el código se consume.
   */
  async verificar(
    correo: string,
    proposito: PropositoCodigoCorreo,
    codigo: string,
    alConsumir: (tx: Prisma.TransactionClient) => Promise<boolean>,
  ): Promise<boolean> {
    const ahora = new Date();
    const fila = await this.prisma.codigoCorreo.findFirst({
      where: {
        correo,
        proposito,
        consumido_en: null,
        expira_en: { gt: ahora },
        intentos: { lt: MAX_INTENTOS_CODIGO },
      },
      orderBy: { creado_en: 'desc' },
      select: { id: true, codigo_hash: true },
    });
    if (!fila) {
      return false;
    }

    const intento = await this.prisma.codigoCorreo.updateMany({
      where: {
        id: fila.id,
        consumido_en: null,
        intentos: { lt: MAX_INTENTOS_CODIGO },
      },
      data: { intentos: { increment: 1 } },
    });
    if (intento.count === 0) {
      return false;
    }

    if (
      !hashesIguales(fila.codigo_hash, this.hash(correo, proposito, codigo))
    ) {
      // Quinto fallo: el código se consume.
      await this.prisma.codigoCorreo.updateMany({
        where: {
          id: fila.id,
          consumido_en: null,
          intentos: { gte: MAX_INTENTOS_CODIGO },
        },
        data: { consumido_en: new Date() },
      });
      return false;
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const consumido = await tx.codigoCorreo.updateMany({
          where: { id: fila.id, consumido_en: null },
          data: { consumido_en: new Date() },
        });
        if (consumido.count === 0) {
          throw new ReversionDeVerificacion();
        }
        if (!(await alConsumir(tx))) {
          throw new ReversionDeVerificacion();
        }
        return true;
      });
    } catch (error) {
      if (error instanceof ReversionDeVerificacion) {
        return false;
      }
      throw error;
    }
  }
}
