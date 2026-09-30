import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  BLOQUEO_MINUTOS,
  MAX_INTENTOS_FALLIDOS,
} from '../common/utils/codigo-acceso';
import { PrismaService } from '../prisma/prisma.service';
import { CodigoNoValidoException } from './codigo-no-valido.exception';

/**
 * Bloqueo por intentos fallidos con códigos de acceso. El origen es la IP en
 * `validar-codigo` y `completar-registro`, y `cuenta:<id>` en `vincular`.
 * Un intento cuenta como fallido cuando el código no es utilizable
 * (inexistente, vencido, ajeno, ya usado o cancelado). 5 fallidos seguidos
 * bloquean 15 minutos; un intento correcto reinicia el contador. Las
 * actualizaciones del contador son atómicas (upsert con incremento).
 */
@Injectable()
export class IntentosCodigoService {
  constructor(private readonly prisma: PrismaService) {}

  async ejecutar<T>(origen: string, accion: () => Promise<T>): Promise<T> {
    await this.verificarNoBloqueado(origen);
    try {
      const resultado = await accion();
      await this.reiniciar(origen);
      return resultado;
    } catch (error) {
      if (error instanceof CodigoNoValidoException) {
        await this.registrarFallo(origen);
      }
      throw error;
    }
  }

  private async verificarNoBloqueado(origen: string): Promise<void> {
    const ahora = new Date();
    // Un bloqueo que ya pasó reinicia el contador (escritura condicionada).
    await this.prisma.intentoCodigo.updateMany({
      where: { origen, bloqueado_hasta: { lte: ahora } },
      data: { fallidos: 0, bloqueado_hasta: null },
    });
    const fila = await this.prisma.intentoCodigo.findUnique({
      where: { origen },
      select: { bloqueado_hasta: true },
    });
    if (
      fila?.bloqueado_hasta &&
      fila.bloqueado_hasta.getTime() > ahora.getTime()
    ) {
      throw new HttpException(
        {
          codigo: 'DEMASIADOS_INTENTOS',
          mensaje: 'Demasiados intentos. Inténtalo de nuevo más tarde.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async registrarFallo(origen: string): Promise<void> {
    // Contador atómico: la fila se crea con skipDuplicates (un upsert con el
    // adaptador de pg puede chocar en el INSERT) y luego se incrementa con un
    // UPDATE ... SET fallidos = fallidos + 1, sin leer y luego escribir.
    await this.prisma.intentoCodigo.createMany({
      data: [{ origen, fallidos: 0 }],
      skipDuplicates: true,
    });
    await this.prisma.intentoCodigo.updateMany({
      where: { origen },
      data: { fallidos: { increment: 1 } },
    });
    const fila = await this.prisma.intentoCodigo.findUnique({
      where: { origen },
      select: { fallidos: true },
    });
    if ((fila?.fallidos ?? 0) >= MAX_INTENTOS_FALLIDOS) {
      await this.prisma.intentoCodigo.updateMany({
        where: { origen, fallidos: { gte: MAX_INTENTOS_FALLIDOS } },
        data: {
          bloqueado_hasta: new Date(Date.now() + BLOQUEO_MINUTOS * 60 * 1000),
        },
      });
    }
  }

  private async reiniciar(origen: string): Promise<void> {
    await this.prisma.intentoCodigo.updateMany({
      where: {
        origen,
        OR: [{ fallidos: { gt: 0 } }, { bloqueado_hasta: { not: null } }],
      },
      data: { fallidos: 0, bloqueado_hasta: null },
    });
  }
}
