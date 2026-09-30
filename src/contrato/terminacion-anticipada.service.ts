import {
  BadRequestException,
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
import { hoyEnBogota } from '../common/hoy-bogota.util';
import { OMITIR_COPIA_INQUILINO } from '../common/inquilino-copia';
import { recalcularEstadoPagoContrato } from '../common/recalcular-estado-pago';
import { resolverIdContratoDelInquilino } from '../common/resolver-contrato-inquilino';
import { resumenTerminacion } from '../common/terminacion.util';
import { PrismaService } from '../prisma/prisma.service';

/** Cómo se localiza el contrato de quien actúa (pertenencia, nunca por rol). */
type Alcance = Prisma.ContratoWhereInput;

const CONTRAPARTE: Record<RolSolicitante, RolSolicitante> = {
  [RolSolicitante.ARRENDADOR]: RolSolicitante.INQUILINO,
  [RolSolicitante.INQUILINO]: RolSolicitante.ARRENDADOR,
};

const ETIQUETA_ROL: Record<RolSolicitante, string> = {
  [RolSolicitante.ARRENDADOR]: 'el arrendador',
  [RolSolicitante.INQUILINO]: 'el inquilino',
};

function soloFecha(fecha: Date): Date {
  return new Date(
    Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()),
  );
}

function errorContratoNoActivo(): ConflictException {
  return new ConflictException({
    codigo: 'CONTRATO_NO_ACTIVO',
    mensaje: 'El contrato no está activo.',
  });
}

function errorYaConfirmada(mensaje: string): ConflictException {
  return new ConflictException({
    codigo: 'TERMINACION_YA_CONFIRMADA',
    mensaje,
  });
}

/**
 * Terminación anticipada por mutuo acuerdo (regla 17, D-2): una parte solicita
 * con motivo y fecha efectiva, la OTRA confirma y quien solicitó puede
 * cancelar mientras no esté confirmada. Toda transición es una escritura
 * condicional dentro de una transacción; si no afecta filas se distingue el
 * error leyendo el estado actual.
 */
@Injectable()
export class TerminacionAnticipadaService {
  constructor(private readonly prisma: PrismaService) {}

  /** Contrato del inquilino autenticado: el activo o, si no hay, el último. */
  async resolverContratoDelInquilino(inquilinoId: string): Promise<string> {
    const id = await resolverIdContratoDelInquilino(this.prisma, {
      inquilino_id: inquilinoId,
    });
    if (!id) {
      throw new NotFoundException(
        'El inquilino autenticado no tiene ningún contrato.',
      );
    }
    return id;
  }

  private async respuesta(
    tx: Prisma.TransactionClient,
    id: string,
    rol: RolSolicitante,
  ) {
    const contrato = await tx.contrato.findUniqueOrThrow({
      where: { id },
      omit: { pdf_contrato_ruta: true, ...OMITIR_COPIA_INQUILINO },
    });
    return {
      ...contrato,
      terminacion_anticipada: resumenTerminacion(contrato, rol),
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
    const contrato = await tx.contrato.findUniqueOrThrow({
      where: { id: contratoId },
      select: { arrendador_id: true, unidad: { select: { nombre: true } } },
    });
    await tx.alerta.create({
      data: {
        arrendador_id: contrato.arrendador_id,
        tipo,
        contrato_id: contratoId,
        mensaje: mensaje.replace('{unidad}', contrato.unidad.nombre),
      },
    });
  }

  private async estadoActual(tx: Prisma.TransactionClient, id: string) {
    const actual = await tx.contrato.findUniqueOrThrow({
      where: { id },
      select: {
        estado: true,
        terminacionAnticipadaSolicitada: true,
        terminacionAnticipadaSolicitadaPor: true,
        terminacionAnticipadaConfirmadaEn: true,
      },
    });
    return {
      estado: actual.estado,
      solicitada: actual.terminacionAnticipadaSolicitada,
      por: actual.terminacionAnticipadaSolicitadaPor,
      confirmada: actual.terminacionAnticipadaConfirmadaEn !== null,
    };
  }

  /** Contrato no activo: terminado anticipadamente cuenta como ya confirmada. */
  private errorPorEstadoNoActivo(estado: EstadoContrato): Error {
    return estado === EstadoContrato.TERMINADO_ANTICIPADAMENTE
      ? errorYaConfirmada('La terminación anticipada ya fue confirmada.')
      : errorContratoNoActivo();
  }

  async solicitar(
    contratoId: string,
    alcance: Alcance,
    rol: RolSolicitante,
    motivo: string,
    fechaEfectiva: Date,
  ) {
    const hoy = hoyEnBogota();
    const efectiva = soloFecha(fechaEfectiva);

    return this.prisma.$transaction(async (tx) => {
      const contrato = await tx.contrato.findFirst({
        where: { id: contratoId, ...alcance },
        select: { estado: true, fecha_inicio: true, fecha_fin: true },
      });
      if (!contrato) {
        throw new NotFoundException('Contrato no encontrado.');
      }
      if (contrato.estado !== EstadoContrato.ACTIVO) {
        throw errorContratoNoActivo();
      }

      const desde =
        contrato.fecha_inicio.getTime() > hoy.getTime()
          ? contrato.fecha_inicio
          : hoy;
      if (
        efectiva.getTime() < desde.getTime() ||
        efectiva.getTime() > contrato.fecha_fin.getTime()
      ) {
        throw new BadRequestException({
          codigo: 'FECHA_EFECTIVA_INVALIDA',
          mensaje:
            'La fecha efectiva debe estar entre hoy y la fecha de fin del contrato, y no puede ser anterior a su inicio.',
          detalles: {
            desde: desde.toISOString().slice(0, 10),
            hasta: contrato.fecha_fin.toISOString().slice(0, 10),
          },
        });
      }

      const resultado = await tx.contrato.updateMany({
        where: {
          id: contratoId,
          estado: EstadoContrato.ACTIVO,
          terminacionAnticipadaSolicitada: false,
        },
        data: {
          terminacionAnticipadaSolicitada: true,
          terminacionAnticipadaSolicitadaPor: rol,
          terminacionAnticipadaSolicitadaEn: new Date(),
          terminacionAnticipadaMotivo: motivo,
          terminacionAnticipadaConfirmadaEn: null,
          terminacion_confirmada_por: null,
          terminacion_fecha_efectiva: efectiva,
        },
      });
      if (resultado.count === 0) {
        const actual = await this.estadoActual(tx, contratoId);
        if (actual.estado !== EstadoContrato.ACTIVO) {
          throw errorContratoNoActivo();
        }
        throw new ConflictException({
          codigo: 'TERMINACION_YA_SOLICITADA',
          mensaje:
            'Este contrato ya tiene una solicitud de terminación anticipada vigente.',
        });
      }

      await this.alertarAlArrendador(
        tx,
        contratoId,
        rol,
        TipoAlerta.TERMINACION_ANTICIPADA_SOLICITADA,
        `El inquilino de la unidad {unidad} solicitó la terminación anticipada del contrato (fecha efectiva ${efectiva.toISOString().slice(0, 10)}).`,
      );
      return this.respuesta(tx, contratoId, rol);
    });
  }

  async confirmar(contratoId: string, alcance: Alcance, rol: RolSolicitante) {
    const hoy = hoyEnBogota();

    return this.prisma.$transaction(async (tx) => {
      const existente = await tx.contrato.findFirst({
        where: { id: contratoId, ...alcance },
        select: { id: true },
      });
      if (!existente) {
        throw new NotFoundException('Contrato no encontrado.');
      }

      const resultado = await tx.contrato.updateMany({
        where: {
          id: contratoId,
          estado: EstadoContrato.ACTIVO,
          terminacionAnticipadaSolicitada: true,
          terminacionAnticipadaSolicitadaPor: CONTRAPARTE[rol],
          terminacionAnticipadaConfirmadaEn: null,
        },
        data: {
          terminacionAnticipadaConfirmadaEn: new Date(),
          terminacion_confirmada_por: rol,
        },
      });

      if (resultado.count === 0) {
        const actual = await this.estadoActual(tx, contratoId);
        if (actual.estado !== EstadoContrato.ACTIVO) {
          throw this.errorPorEstadoNoActivo(actual.estado);
        }
        if (!actual.solicitada) {
          throw new ConflictException({
            codigo: 'TERMINACION_NO_SOLICITADA',
            mensaje:
              'No hay una solicitud de terminación anticipada pendiente para confirmar.',
          });
        }
        if (actual.confirmada) {
          throw errorYaConfirmada(
            'La terminación anticipada ya fue confirmada.',
          );
        }
        if (actual.por === rol) {
          throw new ForbiddenException({
            codigo: 'NO_PUEDE_CONFIRMAR_SU_PROPIA_SOLICITUD',
            mensaje: `La terminación anticipada debe confirmarla la otra parte, no ${ETIQUETA_ROL[rol]}.`,
          });
        }
        throw errorYaConfirmada('La terminación anticipada ya fue confirmada.');
      }

      // Fecha efectiva de hoy (o anterior, o una solicitud antigua sin
      // fecha): el contrato termina ahora. Si es futura, sigue ACTIVO y el
      // cron diario la aplica al llegar la fecha.
      const confirmado = await tx.contrato.findUniqueOrThrow({
        where: { id: contratoId },
        select: { terminacion_fecha_efectiva: true },
      });
      const efectiva = confirmado.terminacion_fecha_efectiva;
      if (efectiva === null || efectiva.getTime() <= hoy.getTime()) {
        await tx.contrato.updateMany({
          where: {
            id: contratoId,
            estado: EstadoContrato.ACTIVO,
            terminacionAnticipadaConfirmadaEn: { not: null },
          },
          data: { estado: EstadoContrato.TERMINADO_ANTICIPADAMENTE },
        });
        await recalcularEstadoPagoContrato(tx, contratoId, hoy);
      }

      await this.alertarAlArrendador(
        tx,
        contratoId,
        rol,
        TipoAlerta.TERMINACION_ANTICIPADA_CONFIRMADA,
        'El inquilino de la unidad {unidad} confirmó la terminación anticipada del contrato.',
      );
      return this.respuesta(tx, contratoId, rol);
    });
  }

  async cancelar(contratoId: string, alcance: Alcance, rol: RolSolicitante) {
    return this.prisma.$transaction(async (tx) => {
      const existente = await tx.contrato.findFirst({
        where: { id: contratoId, ...alcance },
        select: { id: true },
      });
      if (!existente) {
        throw new NotFoundException('Contrato no encontrado.');
      }

      const resultado = await tx.contrato.updateMany({
        where: {
          id: contratoId,
          estado: EstadoContrato.ACTIVO,
          terminacionAnticipadaSolicitada: true,
          terminacionAnticipadaSolicitadaPor: rol,
          terminacionAnticipadaConfirmadaEn: null,
        },
        data: {
          terminacionAnticipadaSolicitada: false,
          terminacionAnticipadaSolicitadaPor: null,
          terminacionAnticipadaSolicitadaEn: null,
          terminacionAnticipadaMotivo: null,
          terminacion_fecha_efectiva: null,
        },
      });

      if (resultado.count === 0) {
        const actual = await this.estadoActual(tx, contratoId);
        if (actual.estado !== EstadoContrato.ACTIVO) {
          throw this.errorPorEstadoNoActivo(actual.estado);
        }
        if (actual.confirmada) {
          throw errorYaConfirmada(
            'La terminación anticipada ya fue confirmada y no se puede cancelar.',
          );
        }
        if (!actual.solicitada) {
          throw new ConflictException({
            codigo: 'TERMINACION_NO_SOLICITADA',
            mensaje: 'No hay una solicitud de terminación anticipada vigente.',
          });
        }
        throw new ForbiddenException({
          codigo: 'NO_PUEDE_CANCELAR_SOLICITUD_AJENA',
          mensaje: 'Solo quien solicitó la terminación puede cancelarla.',
        });
      }

      await this.alertarAlArrendador(
        tx,
        contratoId,
        rol,
        TipoAlerta.TERMINACION_ANTICIPADA_CANCELADA,
        'El inquilino de la unidad {unidad} canceló su solicitud de terminación anticipada.',
      );
      return this.respuesta(tx, contratoId, rol);
    });
  }
}
