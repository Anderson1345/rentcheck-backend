import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { EstadoContrato, Prisma } from '@prisma/client';
import { randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CrearContratoDto } from './dto/crear-contrato.dto';

@Injectable()
export class ContratoService {
  constructor(private readonly prisma: PrismaService) {}

  private generarCodigoAcceso(): string {
    const caracteres = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const aleatorio = Array.from(
      { length: 4 },
      () => caracteres[randomInt(caracteres.length)],
    ).join('');

    return `RC-${new Date().getFullYear()}-${aleatorio}`;
  }

  private esColisionDeCodigoAcceso(error: unknown): boolean {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      return false;
    }

    const target = error.meta?.target;
    return (
      (Array.isArray(target) && target.includes('codigo')) ||
      (typeof target === 'string' && target.includes('CodigoAcceso_codigo_key'))
    );
  }

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
      for (let intento = 1; intento <= 5; intento += 1) {
        try {
          return await this.prisma.$transaction(async (tx) => {
            const contrato = await tx.contrato.create({
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

            await tx.codigoAcceso.create({
              data: {
                codigo: this.generarCodigoAcceso(),
                contrato_id: contrato.id,
                unidad_id: dto.unidad_id,
                inquilino_id: dto.inquilino_id,
              },
            });

            return tx.contrato.findUniqueOrThrow({
              where: { id: contrato.id },
              include: { codigo_acceso: true },
            });
          });
        } catch (error) {
          if (this.esColisionDeCodigoAcceso(error)) {
            if (intento === 5) {
              throw new InternalServerErrorException(
                'No fue posible generar el código de acceso',
              );
            }
            continue;
          }
          throw error;
        }
      }

      throw new InternalServerErrorException(
        'No fue posible generar el código de acceso',
      );
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
