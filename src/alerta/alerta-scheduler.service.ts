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
}
