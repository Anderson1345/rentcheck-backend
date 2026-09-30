import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DIA_MS = 24 * 60 * 60 * 1000;

export interface ResultadoLimpieza {
  codigos_correo: number;
  intentos_codigo: number;
  claves_idempotencia: number;
  errores: number;
}

/**
 * Limpieza de las tablas técnicas que crecen sin límite. Nada con valor legal
 * o financiero se toca. Las fechas de corte se calculan en JS (no con el
 * `now()` de la base) y cada borrado va en su propio `try/catch`.
 */
@Injectable()
export class LimpiezaTecnicaService {
  private readonly logger = new Logger(LimpiezaTecnicaService.name);

  constructor(private readonly prisma: PrismaService) {}

  async limpiar(ahora: Date = new Date()): Promise<ResultadoLimpieza> {
    const haceUnDia = new Date(ahora.getTime() - DIA_MS);
    const haceSieteDias = new Date(ahora.getTime() - 7 * DIA_MS);
    const resultado: ResultadoLimpieza = {
      codigos_correo: 0,
      intentos_codigo: 0,
      claves_idempotencia: 0,
      errores: 0,
    };

    // Códigos de correo consumidos o vencidos hace más de 1 día.
    await this.borrar(
      'codigos_correo',
      resultado,
      async () =>
        (
          await this.prisma.codigoCorreo.deleteMany({
            where: {
              OR: [
                { consumido_en: { lt: haceUnDia } },
                { expira_en: { lt: haceUnDia } },
              ],
            },
          })
        ).count,
    );

    // Intentos sin bloqueo vigente y sin actividad hace más de 1 día.
    await this.borrar(
      'intentos_codigo',
      resultado,
      async () =>
        (
          await this.prisma.intentoCodigo.deleteMany({
            where: {
              actualizado_en: { lt: haceUnDia },
              OR: [
                { bloqueado_hasta: null },
                { bloqueado_hasta: { lte: ahora } },
              ],
            },
          })
        ).count,
    );

    // Claves de idempotencia de más de 7 días.
    await this.borrar(
      'claves_idempotencia',
      resultado,
      async () =>
        (
          await this.prisma.claveIdempotencia.deleteMany({
            where: { creado_en: { lt: haceSieteDias } },
          })
        ).count,
    );

    return resultado;
  }

  private async borrar(
    tabla: 'codigos_correo' | 'intentos_codigo' | 'claves_idempotencia',
    resultado: ResultadoLimpieza,
    accion: () => Promise<number>,
  ): Promise<void> {
    try {
      resultado[tabla] = await accion();
    } catch (error) {
      resultado.errores += 1;
      this.logger.error(
        `No se pudo limpiar ${tabla}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
