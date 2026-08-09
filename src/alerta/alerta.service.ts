import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ListarAlertasQueryDto } from './dto/listar-alertas-query.dto';

@Injectable()
export class AlertaService {
  constructor(private readonly prisma: PrismaService) {}

  listar(arrendadorId: string, query: ListarAlertasQueryDto) {
    return this.prisma.alerta.findMany({
      where: {
        arrendador_id: arrendadorId,
        ...(query.leida !== undefined ? { leida: query.leida } : {}),
      },
      orderBy: { creado_en: 'desc' },
    });
  }

  async marcarComoLeida(id: string, arrendadorId: string) {
    const alerta = await this.prisma.alerta.findFirst({
      where: { id, arrendador_id: arrendadorId },
    });
    if (!alerta) {
      throw new NotFoundException(
        'Alerta no encontrada o no pertenece al arrendador autenticado.',
      );
    }
    return this.prisma.alerta.update({
      where: { id: alerta.id },
      data: { leida: true },
    });
  }
}
