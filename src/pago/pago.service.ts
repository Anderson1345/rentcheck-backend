import { Injectable, NotFoundException } from '@nestjs/common';
import { EstadoPago } from '@prisma/client';
import { unlink } from 'fs/promises';
import { PrismaService } from '../prisma/prisma.service';
import { CrearPagoDto } from './dto/crear-pago.dto';

@Injectable()
export class PagoService {
  constructor(private readonly prisma: PrismaService) {}

  async crear(
    dto: CrearPagoDto,
    inquilinoId: string,
    comprobante: Express.Multer.File,
  ) {
    const contrato = await this.prisma.contrato.findFirst({
      where: {
        id: dto.contratoId,
        inquilino_id: inquilinoId,
      },
      include: {
        unidad: { include: { inmueble: true } },
      },
    });

    if (!contrato) {
      await this.eliminarComprobante(comprobante.path);
      throw new NotFoundException(
        'Contrato no encontrado o no pertenece al inquilino autenticado.',
      );
    }

    const arrendadorId = contrato.unidad.inmueble.arrendador_id;

    try {
      return await this.prisma.pago.create({
        data: {
          arrendador_id: arrendadorId,
          contrato_id: contrato.id,
          monto_centavos: dto.monto_centavos,
          fecha_reportada: dto.fecha_reportada,
          comprobante_url: `uploads/comprobantes/${comprobante.filename}`,
          estado: EstadoPago.PENDIENTE,
        },
      });
    } catch (error) {
      await this.eliminarComprobante(comprobante.path);
      throw error;
    }
  }

  private async eliminarComprobante(rutaAbsoluta: string): Promise<void> {
    try {
      await unlink(rutaAbsoluta);
    } catch {
      // La limpieza no debe ocultar el error original.
    }
  }
}
