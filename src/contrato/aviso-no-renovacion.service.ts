import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EstadoContrato,
  Prisma,
  RolSolicitante,
  TipoAlerta,
} from '@prisma/client';
import { resumenAvisoNoRenovacion } from '../common/aviso-no-renovacion.util';
import { hoyEnBogota } from '../common/hoy-bogota.util';
import { OMITIR_COPIA_INQUILINO } from '../common/inquilino-copia';
import { alertarAlArrendadorDelContrato } from '../alerta/crear-alerta';
import { PrismaService } from '../prisma/prisma.service';

/** Cómo se localiza el contrato de quien actúa (pertenencia, nunca por rol). */
type Alcance = Prisma.ContratoWhereInput;

function errorAvisoNoDado(): ConflictException {
  return new ConflictException({
    codigo: 'AVISO_NO_DADO',
    mensaje: 'No hay un aviso de no renovación vigente.',
  });
}

/**
 * Aviso de no renovación (D-1). Hay a lo sumo una fila por contrato; está
 * vigente mientras `cancelado_en` sea nulo y un aviso cancelado se reactiva en
 * la misma fila. Solo se da o se cancela con el contrato ACTIVO y antes de su
 * último día. Toda escritura es condicional (seguras ante peticiones
 * simultáneas); la creación usa `skipDuplicates` para no envenenar la
 * transacción con un P2002.
 */
@Injectable()
export class AvisoNoRenovacionService {
  constructor(private readonly prisma: PrismaService) {}

  private async contratoEnPlazo(
    tx: Prisma.TransactionClient,
    contratoId: string,
    alcance: Alcance,
    hoy: Date,
  ): Promise<void> {
    const contrato = await tx.contrato.findFirst({
      where: { id: contratoId, ...alcance },
      select: { estado: true, fecha_fin: true },
    });
    if (!contrato) {
      throw new NotFoundException('Contrato no encontrado.');
    }
    if (contrato.estado !== EstadoContrato.ACTIVO) {
      throw new ConflictException({
        codigo: 'CONTRATO_NO_ACTIVO',
        mensaje: 'El contrato no está activo.',
      });
    }
    if (hoy.getTime() >= contrato.fecha_fin.getTime()) {
      throw new ConflictException({
        codigo: 'AVISO_FUERA_DE_PLAZO',
        mensaje:
          'El aviso de no renovación debe darse antes del último día del contrato.',
        detalles: { fecha_fin: contrato.fecha_fin.toISOString().slice(0, 10) },
      });
    }
  }

  private async respuesta(
    tx: Prisma.TransactionClient,
    contratoId: string,
    rol: RolSolicitante,
    hoy: Date,
  ) {
    const contrato = await tx.contrato.findUniqueOrThrow({
      where: { id: contratoId },
      omit: { pdf_contrato_ruta: true, ...OMITIR_COPIA_INQUILINO },
    });
    const aviso = await tx.avisoNoRenovacion.findUnique({
      where: { contrato_id: contratoId },
    });
    return {
      ...contrato,
      aviso_no_renovacion: resumenAvisoNoRenovacion(aviso, contrato, rol, hoy),
    };
  }

  private async alertarAlArrendador(
    tx: Prisma.TransactionClient,
    contratoId: string,
    rol: RolSolicitante,
    tipo: TipoAlerta,
    mensaje: string,
  ): Promise<void> {
    // Solo hay alertas cuando actúa el inquilino. Las alertas para el
    // inquilino como destinatario llegan en B0.6.
    if (rol !== RolSolicitante.INQUILINO) {
      return;
    }
    await alertarAlArrendadorDelContrato(tx, contratoId, tipo, mensaje);
  }

  async dar(
    contratoId: string,
    alcance: Alcance,
    rol: RolSolicitante,
    motivo?: string,
  ) {
    const hoy = hoyEnBogota();

    return this.prisma.$transaction(async (tx) => {
      await this.contratoEnPlazo(tx, contratoId, alcance, hoy);

      const creado = await tx.avisoNoRenovacion.createMany({
        data: [
          { contrato_id: contratoId, dado_por: rol, motivo: motivo ?? null },
        ],
        skipDuplicates: true,
      });
      if (creado.count === 0) {
        // Ya hay una fila: se reactiva solo si estaba cancelada.
        const reactivado = await tx.avisoNoRenovacion.updateMany({
          where: { contrato_id: contratoId, cancelado_en: { not: null } },
          data: {
            dado_por: rol,
            dado_en: new Date(),
            motivo: motivo ?? null,
            cancelado_en: null,
          },
        });
        if (reactivado.count === 0) {
          throw new ConflictException({
            codigo: 'AVISO_YA_DADO',
            mensaje:
              'Este contrato ya tiene un aviso de no renovación vigente.',
          });
        }
      }

      await this.alertarAlArrendador(
        tx,
        contratoId,
        rol,
        TipoAlerta.AVISO_NO_RENOVACION_DADO,
        'El inquilino de la unidad {unidad} dio aviso de no renovación del contrato.',
      );
      return this.respuesta(tx, contratoId, rol, hoy);
    });
  }

  async cancelar(contratoId: string, alcance: Alcance, rol: RolSolicitante) {
    const hoy = hoyEnBogota();

    return this.prisma.$transaction(async (tx) => {
      await this.contratoEnPlazo(tx, contratoId, alcance, hoy);

      const resultado = await tx.avisoNoRenovacion.updateMany({
        where: { contrato_id: contratoId, cancelado_en: null, dado_por: rol },
        data: { cancelado_en: new Date() },
      });
      if (resultado.count === 0) {
        const actual = await tx.avisoNoRenovacion.findUnique({
          where: { contrato_id: contratoId },
        });
        if (!actual || actual.cancelado_en !== null) {
          throw errorAvisoNoDado();
        }
        throw new ForbiddenException({
          codigo: 'NO_PUEDE_CANCELAR_AVISO_AJENO',
          mensaje: 'Solo quien dio el aviso de no renovación puede cancelarlo.',
        });
      }

      await this.alertarAlArrendador(
        tx,
        contratoId,
        rol,
        TipoAlerta.AVISO_NO_RENOVACION_CANCELADO,
        'El inquilino de la unidad {unidad} canceló su aviso de no renovación.',
      );
      return this.respuesta(tx, contratoId, rol, hoy);
    });
  }
}
