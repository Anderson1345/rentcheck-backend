import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EstadoContrato, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CrearContratoDto } from './dto/crear-contrato.dto';

@Injectable()
export class ContratoService {
  constructor(private readonly prisma: PrismaService) {}

  async crear(dto: CrearContratoDto, arrendadorId: string) {
    const unidad = await this.prisma.unidad.findFirst({
      where: {
        id: dto.unidad_id,
        inmueble: { arrendador_id: arrendadorId },
      },
    });
    if (!unidad) {
      throw new NotFoundException('Unidad no encontrada');
    }

    const inquilino = await this.prisma.inquilino.findFirst({
      where: { id: dto.inquilino_id, arrendador_id: arrendadorId },
    });
    if (!inquilino) {
      throw new NotFoundException('Inquilino no encontrado');
    }

    try {
      return await this.prisma.contrato.create({
        data: {
          arrendador_id: arrendadorId,
          unidad_id: dto.unidad_id,
          inquilino_id: dto.inquilino_id,
          tipo_plantilla: dto.tipo_plantilla,
          canon_centavos: dto.canon_centavos,
          dia_pago: dto.dia_pago,
          forma_pago: dto.forma_pago,
          deposito_centavos: dto.deposito_centavos,
          datos_recaudo: dto.datos_recaudo,
          datos_fiador_o_poliza: dto.datos_fiador_o_poliza,
          fecha_inicio: dto.fecha_inicio,
          fecha_fin: dto.fecha_fin,
          estado: EstadoContrato.ACTIVO,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Esta unidad ya tiene un contrato activo');
      }
      throw error;
    }
  }
}
