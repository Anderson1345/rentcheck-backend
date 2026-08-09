import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EstadoContrato,
  EstadoPagoContrato,
  Momento,
  Prisma,
  RolSolicitante,
} from '@prisma/client';
import { calcularProximaFechaPago } from '../common/calcular-fecha-pago';
import { PrismaService } from '../prisma/prisma.service';

const INCLUDE_CONTRATO_PANEL = {
  incrementos_ipc: { orderBy: { fecha_aplicacion: 'asc' } },
  fotos_inventario: { where: { momento: Momento.ENTREGA } },
} as const satisfies Prisma.ContratoInclude;

type ContratoPanel = Prisma.ContratoGetPayload<{
  include: typeof INCLUDE_CONTRATO_PANEL;
}>;

@Injectable()
export class InquilinoPanelService {
  constructor(private readonly prisma: PrismaService) {}

  async obtenerMiPanel(inquilinoId: string) {
    const contrato = await this.resolverContrato(inquilinoId);

    if (!contrato) {
      throw new NotFoundException(
        'El inquilino autenticado no tiene ningún contrato.',
      );
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

    return {
      canon_centavos: contrato.canon_centavos,
      dia_pago: contrato.dia_pago,
      forma_pago: contrato.forma_pago,
      deposito_centavos: contrato.deposito_centavos,
      fecha_inicio: contrato.fecha_inicio,
      fecha_fin: contrato.fecha_fin,
      pdf_contrato_url: contrato.pdf_contrato_url,
      incrementos_ipc: contrato.incrementos_ipc,
      fotos_entrega: contrato.fotos_inventario,
    };
  }

  async solicitarTerminacionAnticipada(inquilinoId: string, motivo: string) {
    const contrato = await this.resolverContrato(inquilinoId);

    if (!contrato) {
      throw new NotFoundException(
        'El inquilino autenticado no tiene ningún contrato.',
      );
    }

    if (contrato.estado !== EstadoContrato.ACTIVO) {
      throw new ConflictException(
        'Solo un contrato activo puede solicitar terminación anticipada.',
      );
    }

    if (contrato.terminacionAnticipadaSolicitada) {
      throw new ConflictException(
        'Este contrato ya tiene una solicitud de terminación anticipada pendiente.',
      );
    }

    return this.prisma.contrato.update({
      where: { id: contrato.id },
      data: {
        terminacionAnticipadaSolicitada: true,
        terminacionAnticipadaSolicitadaPor: RolSolicitante.INQUILINO,
        terminacionAnticipadaSolicitadaEn: new Date(),
        terminacionAnticipadaMotivo: motivo,
      },
    });
  }

  private async resolverContrato(
    inquilinoId: string,
  ): Promise<ContratoPanel | null> {
    const donde = { inquilino_id: inquilinoId };

    return (
      (await this.prisma.contrato.findFirst({
        where: { ...donde, estado: EstadoContrato.ACTIVO },
        include: INCLUDE_CONTRATO_PANEL,
      })) ??
      (await this.prisma.contrato.findFirst({
        where: donde,
        orderBy: { creado_en: 'desc' },
        include: INCLUDE_CONTRATO_PANEL,
      }))
    );
  }
}
