import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EstadoContrato, TipoAlerta } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AlertaSchedulerService {
  private readonly logger = new Logger(AlertaSchedulerService.name);

  constructor(private readonly prisma: PrismaService) {}

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
      const proximaFechaPago = this.calcularProximaFechaPago(
        contrato.dia_pago,
        hoy,
      );
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

  private calcularProximaFechaPago(diaPago: number, hoy: Date): Date {
    const anio = hoy.getFullYear();
    const mesActual = hoy.getMonth();
    const diaHoy = hoy.getDate();

    const ultimoDiaDelMes = (anioObjetivo: number, mesObjetivo: number) =>
      new Date(anioObjetivo, mesObjetivo + 1, 0).getDate();

    const mesPago = diaHoy > diaPago ? mesActual + 1 : mesActual;
    const anioPago = anio + Math.floor(mesPago / 12);
    const mesNormalizado = ((mesPago % 12) + 12) % 12;

    const ultimoDia = ultimoDiaDelMes(anioPago, mesNormalizado);
    const diaAjustado = Math.min(diaPago, ultimoDia);

    return new Date(anioPago, mesNormalizado, diaAjustado);
  }
}
