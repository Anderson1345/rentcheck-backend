import { Injectable, NotFoundException } from '@nestjs/common';
import { EstadoContrato, Prisma, TipoAlerta } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Respuesta única para un código que no se puede usar (sin distinguir causas). */
export function errorCodigoNoValido(): NotFoundException {
  return new NotFoundException('Código de acceso no válido');
}

/**
 * Vinculación del contrato por el inquilino (B0.4-A2): `vinculado_en` es nulo
 * hasta que el inquilino usa el código de acceso; el portal del inquilino solo
 * ve contratos vinculados.
 */
@Injectable()
export class VinculacionContratoService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fija `vinculado_en` con una escritura condicionada (`vinculado_en` nulo) y,
   * solo la primera vez, avisa al arrendador. Devuelve false si el contrato ya
   * estaba vinculado. Se usa dentro de la transacción de quien vincula
   * (`completar-registro` la comparte con la creación de la cuenta).
   */
  async vincularEnTransaccion(
    tx: Prisma.TransactionClient,
    contratoId: string,
  ): Promise<boolean> {
    const resultado = await tx.contrato.updateMany({
      where: { id: contratoId, vinculado_en: null },
      data: { vinculado_en: new Date() },
    });
    if (resultado.count === 0) {
      return false;
    }

    const contrato = await tx.contrato.findUniqueOrThrow({
      where: { id: contratoId },
      select: { arrendador_id: true, unidad: { select: { nombre: true } } },
    });
    await tx.alerta.create({
      data: {
        arrendador_id: contrato.arrendador_id,
        tipo: TipoAlerta.CONTRATO_VINCULADO_POR_INQUILINO,
        contrato_id: contratoId,
        mensaje: `El inquilino de la unidad ${contrato.unidad.nombre} vinculó el contrato con su código de acceso.`,
      },
    });
    return true;
  }

  /**
   * `POST /inquilino/contratos/vincular`: la cuenta autenticada vincula el
   * contrato de un código. Un código inexistente, de otra cuenta o de un
   * contrato CANCELADO recibe la misma respuesta. Idempotente para la misma
   * cuenta.
   */
  async vincular(inquilinoId: string, codigo: string) {
    return this.prisma.$transaction(async (tx) => {
      const codigoAcceso = await tx.codigoAcceso.findUnique({
        where: { codigo },
        select: {
          inquilino_id: true,
          contrato: { select: { id: true, estado: true } },
        },
      });
      if (
        !codigoAcceso ||
        codigoAcceso.inquilino_id !== inquilinoId ||
        codigoAcceso.contrato.estado === EstadoContrato.CANCELADO
      ) {
        throw errorCodigoNoValido();
      }

      await this.vincularEnTransaccion(tx, codigoAcceso.contrato.id);

      const contrato = await tx.contrato.findUniqueOrThrow({
        where: { id: codigoAcceso.contrato.id },
        select: {
          id: true,
          estado: true,
          fecha_inicio: true,
          fecha_fin: true,
          vinculado_en: true,
          datos_recaudo: true,
          unidad: {
            select: {
              id: true,
              nombre: true,
              tipo: true,
              inmueble: {
                select: { id: true, direccion: true, ciudad: true },
              },
            },
          },
        },
      });
      const { unidad, datos_recaudo, ...resto } = contrato;
      const { inmueble, ...datosUnidad } = unidad;
      return {
        ...resto,
        // Regla 11: los datos de recaudo solo con el contrato ACTIVO.
        datos_recaudo:
          contrato.estado === EstadoContrato.ACTIVO ? datos_recaudo : null,
        unidad: datosUnidad,
        inmueble,
      };
    });
  }
}
