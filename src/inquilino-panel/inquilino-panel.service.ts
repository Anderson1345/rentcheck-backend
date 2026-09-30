import { Injectable, NotFoundException } from '@nestjs/common';
import {
  EstadoContrato,
  EstadoPagoContrato,
  Momento,
  Prisma,
  RolSolicitante,
} from '@prisma/client';
import { calcularProximaFechaPago } from '../common/calcular-fecha-pago';
import { AlmacenamientoService } from '../almacenamiento/almacenamiento.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  calcularEstadoCuenta,
  construirRespuestaEstadoCuenta,
} from '../common/estado-cuenta.util';
import { hoyEnBogota } from '../common/hoy-bogota.util';
import { resolverIdContratoDelInquilino } from '../common/resolver-contrato-inquilino';
import {
  fechaFinParaEstadoCuenta,
  resumenTerminacion,
} from '../common/terminacion.util';
import { AvisoNoRenovacionService } from '../contrato/aviso-no-renovacion.service';
import { TerminacionAnticipadaService } from '../contrato/terminacion-anticipada.service';
import { resumenAvisoNoRenovacion } from '../common/aviso-no-renovacion.util';

const INCLUDE_CONTRATO_PANEL = {
  incrementos_ipc: { orderBy: { fecha_aplicacion: 'asc' } },
  fotos_inventario: true,
  aviso_no_renovacion: true,
  pagos: { select: { periodo: true, estado: true, monto_centavos: true } },
} as const satisfies Prisma.ContratoInclude;

type ContratoPanel = Prisma.ContratoGetPayload<{
  include: typeof INCLUDE_CONTRATO_PANEL;
}>;

@Injectable()
export class InquilinoPanelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly almacenamiento: AlmacenamientoService,
    private readonly terminacion: TerminacionAnticipadaService,
    private readonly aviso: AvisoNoRenovacionService,
  ) {}

  async obtenerMiPanel(inquilinoId: string) {
    const contrato = await this.resolverContrato(inquilinoId);

    if (!contrato) {
      throw new NotFoundException(
        'El inquilino autenticado no tiene ningún contrato.',
      );
    }

    // Un contrato PROGRAMADO aún no empieza: no está finalizado ni muestra
    // datos de recaudo.
    if (contrato.estado === EstadoContrato.PROGRAMADO) {
      return {
        contratoFinalizado: false,
        programado: true,
        estado: contrato.estado,
        fecha_inicio: contrato.fecha_inicio,
        fecha_fin: contrato.fecha_fin,
      };
    }

    if (contrato.estado !== EstadoContrato.ACTIVO) {
      return {
        contratoFinalizado: true,
        estado: contrato.estado,
      };
    }

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const proximaFechaPago = calcularProximaFechaPago(contrato.dia_pago, hoy);

    const diasRestantes = Math.max(
      0,
      Math.ceil(
        (contrato.fecha_fin.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24),
      ),
    );

    const estadoPago =
      contrato.estado_pago === EstadoPagoContrato.AL_DIA
        ? 'al_dia'
        : contrato.estado_pago === EstadoPagoContrato.EN_MORA
          ? 'en_mora'
          : 'pendiente';

    return {
      proximoPago: {
        monto_centavos: contrato.canon_centavos,
        fecha: proximaFechaPago,
      },
      estadoPago,
      diasRestantes,
    };
  }

  async obtenerMiContrato(inquilinoId: string) {
    const contrato = await this.resolverContrato(inquilinoId);

    if (!contrato) {
      throw new NotFoundException(
        'El inquilino autenticado no tiene ningún contrato.',
      );
    }

    const fotosEntrega = contrato.fotos_inventario.filter(
      (f) => f.momento === Momento.ENTREGA,
    );
    const fotosDevolucion = contrato.fotos_inventario.filter(
      (f) => f.momento === Momento.DEVOLUCION,
    );

    return {
      contratoId: contrato.id,
      estado: contrato.estado,
      programado: contrato.estado === EstadoContrato.PROGRAMADO,
      canon_centavos: contrato.canon_centavos,
      dia_pago: contrato.dia_pago,
      forma_pago: contrato.forma_pago,
      deposito_centavos: contrato.deposito_centavos,
      datos_recaudo:
        contrato.estado === EstadoContrato.ACTIVO
          ? contrato.datos_recaudo
          : null,
      fecha_inicio: contrato.fecha_inicio,
      fecha_fin: contrato.fecha_fin,
      pdf_contrato_url: contrato.pdf_contrato_ruta
        ? await this.almacenamiento.generarUrlFirmada(
            contrato.pdf_contrato_ruta,
          )
        : null,
      incrementos_ipc: contrato.incrementos_ipc,
      terminacion_anticipada: resumenTerminacion(
        contrato,
        RolSolicitante.INQUILINO,
      ),
      aviso_no_renovacion: resumenAvisoNoRenovacion(
        contrato.aviso_no_renovacion,
        contrato,
        RolSolicitante.INQUILINO,
      ),
      fotos_entrega: await Promise.all(
        fotosEntrega.map((f) => this.exponerUrlFirmada(f)),
      ),
      fotos_devolucion: await Promise.all(
        fotosDevolucion.map((f) => this.exponerUrlFirmada(f)),
      ),
    };
  }

  async obtenerEstadoCuenta(inquilinoId: string) {
    const contrato = await this.resolverContrato(inquilinoId);

    if (!contrato) {
      throw new NotFoundException(
        'El inquilino autenticado no tiene ningún contrato.',
      );
    }

    const periodos = calcularEstadoCuenta(
      {
        fecha_inicio: contrato.fecha_inicio,
        fecha_fin: fechaFinParaEstadoCuenta(contrato),
        dia_pago: contrato.dia_pago,
        canon_centavos: contrato.canon_centavos,
      },
      contrato.incrementos_ipc,
      contrato.pagos,
      hoyEnBogota(),
    );

    return construirRespuestaEstadoCuenta(periodos);
  }

  async solicitarTerminacionAnticipada(
    inquilinoId: string,
    motivo: string,
    fechaEfectiva: Date,
  ) {
    const contratoId =
      await this.terminacion.resolverContratoDelInquilino(inquilinoId);
    return this.terminacion.solicitar(
      contratoId,
      { inquilino_id: inquilinoId },
      RolSolicitante.INQUILINO,
      motivo,
      fechaEfectiva,
    );
  }

  async darAvisoNoRenovacion(inquilinoId: string, motivo?: string) {
    const contratoId =
      await this.terminacion.resolverContratoDelInquilino(inquilinoId);
    return this.aviso.dar(
      contratoId,
      { inquilino_id: inquilinoId },
      RolSolicitante.INQUILINO,
      motivo,
    );
  }

  async cancelarAvisoNoRenovacion(inquilinoId: string) {
    const contratoId =
      await this.terminacion.resolverContratoDelInquilino(inquilinoId);
    return this.aviso.cancelar(
      contratoId,
      { inquilino_id: inquilinoId },
      RolSolicitante.INQUILINO,
    );
  }

  async confirmarTerminacionAnticipada(inquilinoId: string) {
    const contratoId =
      await this.terminacion.resolverContratoDelInquilino(inquilinoId);
    return this.terminacion.confirmar(
      contratoId,
      { inquilino_id: inquilinoId },
      RolSolicitante.INQUILINO,
    );
  }

  async cancelarTerminacionAnticipada(inquilinoId: string) {
    const contratoId =
      await this.terminacion.resolverContratoDelInquilino(inquilinoId);
    return this.terminacion.cancelar(
      contratoId,
      { inquilino_id: inquilinoId },
      RolSolicitante.INQUILINO,
    );
  }

  private async exponerUrlFirmada<T extends { foto_ruta: string | null }>(
    foto: T,
  ): Promise<Omit<T, 'foto_ruta'> & { foto_url: string | null }> {
    const { foto_ruta, ...resto } = foto;
    if (!foto_ruta) {
      return { ...resto, foto_url: null };
    }
    return {
      ...resto,
      foto_url: await this.almacenamiento.generarUrlFirmada(foto_ruta),
    };
  }

  private async resolverContrato(
    inquilinoId: string,
  ): Promise<ContratoPanel | null> {
    const id = await resolverIdContratoDelInquilino(this.prisma, {
      inquilino_id: inquilinoId,
    });
    if (!id) {
      return null;
    }
    return this.prisma.contrato.findUnique({
      where: { id },
      include: INCLUDE_CONTRATO_PANEL,
    });
  }
}
