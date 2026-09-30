import { Injectable, Logger } from '@nestjs/common';
import { PropositoCodigoCorreo } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { IntentosCodigoService } from '../contrato/intentos-codigo.service';
import { CodigoCorreoService } from '../correo/codigo-correo.service';
import { CorreoService } from '../correo/correo.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CodigoCorreoInvalidoException,
  esCodigoCorreoInvalido,
} from './codigo-correo-invalido.exception';
import { COSTO_BCRYPT } from './contrasena.util';
import { RecuperarContrasenaDto } from './dto/recuperar-contrasena.dto';
import { RestablecerContrasenaDto } from './dto/restablecer-contrasena.dto';

export const MENSAJE_RECUPERACION =
  'Si el correo corresponde a una cuenta, te enviamos un código.';

/**
 * Recuperación de contraseña por código (D-10, parte 2). Confirmar la
 * recuperación prueba la propiedad del correo: fija la contraseña nueva y
 * marca el correo como verificado (cierra B-56: quien ocupó el correo de otra
 * persona sin verificarlo ya no lo conserva). No toca el JWT ni las sesiones
 * abiertas (eso es B0.5).
 */
@Injectable()
export class RecuperacionContrasenaService {
  private readonly logger = new Logger(RecuperacionContrasenaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly correo: CorreoService,
    private readonly codigos: CodigoCorreoService,
    private readonly intentos: IntentosCodigoService,
  ) {}

  /**
   * Envía el código SOLO si el correo es de una cuenta con contraseña
   * (arrendador o inquilino con cuenta) y no está en espera ni en el tope por
   * hora. La respuesta no depende de nada de eso.
   */
  async solicitar(dto: RecuperarContrasenaDto) {
    this.correo.exigirDisponible();
    const [arrendador, inquilino] = await Promise.all([
      this.prisma.arrendador.findUnique({
        where: { correo: dto.correo },
        select: { id: true },
      }),
      this.prisma.inquilino.findFirst({
        where: { correo: dto.correo, contrasena_hash: { not: null } },
        select: { id: true },
      }),
    ]);
    if (arrendador || inquilino) {
      await this.codigos.emitir(dto.correo, PropositoCodigoCorreo.RECUPERACION);
    }
    return { mensaje: MENSAJE_RECUPERACION };
  }

  /**
   * Cambia la contraseña con el código. La contraseña nueva ya se validó en el
   * DTO (antes de tocar el código). El código se consume en la MISMA
   * transacción que actualiza la contraseña y el correo verificado; sin cuenta
   * para ese correo el código no se gasta.
   */
  restablecer(dto: RestablecerContrasenaDto, ip: string) {
    this.correo.exigirDisponible();
    return this.intentos.ejecutar(
      `recuperacion:${ip}`,
      async () => {
        const restablecida = await this.codigos.verificar(
          dto.correo,
          PropositoCodigoCorreo.RECUPERACION,
          dto.codigo,
          async (tx) => {
            // Solo con el código correcto se paga el costo de bcrypt.
            const contrasena_hash = await bcrypt.hash(
              dto.nueva_contrasena,
              COSTO_BCRYPT,
            );
            const arrendador = await tx.arrendador.updateMany({
              where: { correo: dto.correo },
              data: { contrasena_hash },
            });
            const inquilino = await tx.inquilino.updateMany({
              where: { correo: dto.correo, contrasena_hash: { not: null } },
              data: { contrasena_hash },
            });
            if (arrendador.count + inquilino.count === 0) {
              return false;
            }
            // El código llegó al correo: queda probado que es de quien lo usa.
            const ahora = new Date();
            await tx.arrendador.updateMany({
              where: { correo: dto.correo, correo_verificado_en: null },
              data: { correo_verificado_en: ahora },
            });
            await tx.inquilino.updateMany({
              where: {
                correo: dto.correo,
                contrasena_hash: { not: null },
                correo_verificado_en: null,
              },
              data: { correo_verificado_en: ahora },
            });
            return true;
          },
        );
        if (!restablecida) {
          throw new CodigoCorreoInvalidoException();
        }
        // Fuera de la transacción y sin propagar un fallo del canal.
        await this.avisarCambio(dto.correo);
        return { contrasena_actualizada: true as const };
      },
      esCodigoCorreoInvalido,
    );
  }

  private async avisarCambio(correo: string): Promise<void> {
    try {
      await this.correo.enviarAvisoCambioContrasena(correo);
    } catch (error) {
      this.logger.warn(
        `No se pudo enviar el aviso de cambio de contraseña: ${error instanceof Error ? error.message : 'error desconocido'}`,
      );
    }
  }
}
