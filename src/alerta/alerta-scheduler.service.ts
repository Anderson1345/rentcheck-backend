import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  EstadoContrato,
  EstadoPago,
  EstadoPagoContrato,
  EstadoSolicitudMantenimiento,
  TipoAlerta,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  calcularFechaPagoAnterior,
  calcularProximaFechaPago,
} from '../common/calcular-fecha-pago';

@Injectable()
export class AlertaSchedulerService {
  private readonly logger = new Logger(AlertaSchedulerService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('55 23 * * *')
  async ejecutarTransicionVencimiento(): Promise<{ actualizados: number }> {
    const resultado = await this.prisma.contrato.updateMany({
      where: {
        estado: EstadoContrato.ACTIVO,
        fecha_fin: { lt: new Date() },
      },
      data: {
        estado: EstadoContrato.VENCIDO,
      },
    });

    this.logger.log(
      `Cron de transición de vencimiento: ${resultado.count} contrato(s) actualizado(s) a VENCIDO.`,
    );

    return { actualizados: resultado.count };
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async ejecutarVencimiento(): Promise<{ creadas: number }> {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const limite = new Date(hoy);
    limite.setDate(limite.getDate() + 30);
    limite.setHours(23, 59, 59, 999);

    const contratos = await this.prisma.contrato.findMany({
      where: {
        estado: EstadoContrato.ACTIVO,
        fecha_fin: { gte: hoy, lte: limite },
      },
      include: {
        unidad: { include: { inmueble: true } },
      },
    });

    let creadas = 0;
    for (const contrato of contratos) {
      const yaExiste = await this.prisma.alerta.findFirst({
        where: {
          tipo: TipoAlerta.CONTRATO_PROXIMO_A_VENCER,
          contrato_id: contrato.id,
          leida: false,
        },
      });
      if (yaExiste) {
        continue;
      }

      const arrendadorId = contrato.unidad.inmueble.arrendador_id;
      const fechaVencimiento = contrato.fecha_fin.toLocaleDateString('es-CO');

      await this.prisma.alerta.create({
        data: {
          arrendador_id: arrendadorId,
          tipo: TipoAlerta.CONTRATO_PROXIMO_A_VENCER,
          contrato_id: contrato.id,
          mensaje: `El contrato de la unidad ${contrato.unidad.nombre} vence el ${fechaVencimiento}.`,
        },
      });
      creadas += 1;
    }

    this.logger.log(
      `Cron de vencimiento de contratos: ${contratos.length} contrato(s) por vencer, ${creadas} alerta(s) nueva(s) creada(s).`,
    );

    return { creadas };
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async ejecutarRecordatorioPago(): Promise<{
    revisados: number;
    creadas: number;
  }> {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const contratos = await this.prisma.contrato.findMany({
      where: {
        estado: EstadoContrato.ACTIVO,
      },
      include: {
        unidad: { include: { inmueble: true } },
      },
    });

    const limiteReciente = new Date(hoy);
    limiteReciente.setDate(limiteReciente.getDate() - 20);

    let creadas = 0;
    for (const contrato of contratos) {
      const proximaFechaPago = calcularProximaFechaPago(contrato.dia_pago, hoy);
      const diferenciaDias = Math.round(
        (proximaFechaPago.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (diferenciaDias < 0 || diferenciaDias > 3) {
        continue;
      }

      const yaExiste = await this.prisma.alerta.findFirst({
        where: {
          tipo: TipoAlerta.RECORDATORIO_PAGO_PROXIMO,
          contrato_id: contrato.id,
          creado_en: { gte: limiteReciente },
        },
      });
      if (yaExiste) {
        continue;
      }

      const arrendadorId = contrato.unidad.inmueble.arrendador_id;
      const fechaPago = proximaFechaPago.toLocaleDateString('es-CO');

      await this.prisma.alerta.create({
        data: {
          arrendador_id: arrendadorId,
          tipo: TipoAlerta.RECORDATORIO_PAGO_PROXIMO,
          contrato_id: contrato.id,
          mensaje: `Recuerda que el pago de la unidad ${contrato.unidad.nombre} vence el ${fechaPago}.`,
        },
      });
      creadas += 1;
    }

    this.logger.log(
      `Cron de recordatorio de pago: ${contratos.length} contrato(s) revisado(s), ${creadas} alerta(s) nueva(s) creada(s).`,
    );

    return { revisados: contratos.length, creadas };
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async ejecutarMantenimientoSinAtender(): Promise<{
    revisadas: number;
    creadas: number;
  }> {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const limite = new Date(hoy);
    limite.setDate(limite.getDate() - 5);

    const solicitudes = await this.prisma.solicitudMantenimiento.findMany({
      where: {
        estado: EstadoSolicitudMantenimiento.PENDIENTE,
        creado_en: { lte: limite },
      },
      include: {
        unidad: { include: { inmueble: true } },
      },
    });

    let creadas = 0;
    for (const solicitud of solicitudes) {
      const yaExiste = await this.prisma.alerta.findFirst({
        where: {
          tipo: TipoAlerta.SOLICITUD_MANTENIMIENTO_SIN_ATENDER,
          solicitud_mantenimiento_id: solicitud.id,
          leida: false,
        },
      });
      if (yaExiste) {
        continue;
      }

      const arrendadorId = solicitud.unidad.inmueble.arrendador_id;
      const diasSinAtender = Math.floor(
        (hoy.getTime() - solicitud.creado_en.getTime()) / (1000 * 60 * 60 * 24),
      );

      await this.prisma.alerta.create({
        data: {
          arrendador_id: arrendadorId,
          tipo: TipoAlerta.SOLICITUD_MANTENIMIENTO_SIN_ATENDER,
          solicitud_mantenimiento_id: solicitud.id,
          mensaje: `La solicitud de mantenimiento de la unidad ${solicitud.unidad.nombre} lleva ${diasSinAtender} día(s) sin atenderse.`,
        },
      });
      creadas += 1;
    }

    this.logger.log(
      `Cron de mantenimiento sin atender: ${solicitudes.length} solicitud(es) revisada(s), ${creadas} alerta(s) nueva(s) creada(s).`,
    );

    return { revisadas: solicitudes.length, creadas };
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async ejecutarAjusteIpcPendiente(): Promise<{
    revisados: number;
    creadas: number;
  }> {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const limite = new Date(hoy);
    limite.setDate(limite.getDate() + 30);
    limite.setHours(23, 59, 59, 999);

    const contratos = await this.prisma.contrato.findMany({
      where: {
        estado: EstadoContrato.ACTIVO,
      },
      include: {
        unidad: { include: { inmueble: true } },
        incrementos_ipc: true,
      },
    });

    let creadas = 0;
    for (const contrato of contratos) {
      const referencia = contrato.incrementos_ipc.length
        ? contrato.incrementos_ipc.reduce((a, b) =>
            b.fecha_aplicacion.getTime() > a.fecha_aplicacion.getTime() ? b : a,
          ).fecha_aplicacion
        : contrato.fecha_inicio;

      const proximoAjuste = new Date(referencia);
      proximoAjuste.setFullYear(proximoAjuste.getFullYear() + 1);

      if (proximoAjuste < hoy || proximoAjuste > limite) {
        continue;
      }

      const yaExiste = await this.prisma.alerta.findFirst({
        where: {
          tipo: TipoAlerta.AJUSTE_IPC_PENDIENTE,
          contrato_id: contrato.id,
          leida: false,
        },
      });
      if (yaExiste) {
        continue;
      }

      const arrendadorId = contrato.unidad.inmueble.arrendador_id;
      const fechaAjuste = proximoAjuste.toLocaleDateString('es-CO');

      await this.prisma.alerta.create({
        data: {
          arrendador_id: arrendadorId,
          tipo: TipoAlerta.AJUSTE_IPC_PENDIENTE,
          contrato_id: contrato.id,
          mensaje: `El ajuste de IPC de la unidad ${contrato.unidad.nombre} debe realizarse el ${fechaAjuste}.`,
        },
      });
      creadas += 1;
    }

    this.logger.log(
      `Cron de ajuste de IPC: ${contratos.length} contrato(s) revisado(s), ${creadas} alerta(s) nueva(s) creada(s).`,
    );

    return { revisados: contratos.length, creadas };
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async ejecutarInquilinoEnMora(): Promise<{
    revisados: number;
    enMora: number;
    creadas: number;
  }> {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const contratos = await this.prisma.contrato.findMany({
      where: {
        estado: EstadoContrato.ACTIVO,
      },
      include: {
        unidad: { include: { inmueble: true } },
        pagos: true,
      },
    });

    let enMora = 0;
    let creadas = 0;
    for (const contrato of contratos) {
      const fechaVencimiento = calcularFechaPagoAnterior(
        contrato.dia_pago,
        hoy,
      );

      const pagoQueCubre = contrato.pagos.some(
        (pago) =>
          (pago.estado === EstadoPago.PENDIENTE ||
            pago.estado === EstadoPago.APROBADO) &&
          pago.fecha_reportada >= fechaVencimiento,
      );
      if (pagoQueCubre) {
        continue;
      }

      enMora += 1;
      if (contrato.estado_pago !== EstadoPagoContrato.EN_MORA) {
        await this.prisma.contrato.update({
          where: { id: contrato.id },
          data: { estado_pago: EstadoPagoContrato.EN_MORA },
        });
      }

      const yaExiste = await this.prisma.alerta.findFirst({
        where: {
          tipo: TipoAlerta.INQUILINO_EN_MORA,
          contrato_id: contrato.id,
          leida: false,
        },
      });
      if (yaExiste) {
        continue;
      }

      const arrendadorId = contrato.unidad.inmueble.arrendador_id;
      const fechaVencimientoStr = fechaVencimiento.toLocaleDateString('es-CO');

      await this.prisma.alerta.create({
        data: {
          arrendador_id: arrendadorId,
          tipo: TipoAlerta.INQUILINO_EN_MORA,
          contrato_id: contrato.id,
          mensaje: `El pago de la unidad ${contrato.unidad.nombre} correspondiente a ${fechaVencimientoStr} está vencido.`,
        },
      });
      creadas += 1;
    }

    this.logger.log(
      `Cron de mora: ${contratos.length} contrato(s) revisado(s), ${enMora} en mora, ${creadas} alerta(s) nueva(s) creada(s).`,
    );

    return { revisados: contratos.length, enMora, creadas };
  }
}
