import { Injectable } from '@nestjs/common';
import { Prisma, TipoUnidad, UsoPermitido } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CrearInmuebleDto } from './dto/crear-inmueble.dto';
import { ActualizarInmuebleDto } from './dto/actualizar-inmueble.dto';

type InmuebleConUnidades = Prisma.InmuebleGetPayload<{
  include: { unidades: true };
}>;

@Injectable()
export class InmuebleService {
  constructor(private readonly prisma: PrismaService) {}

  async crear(
    dto: CrearInmuebleDto,
    arrendadorId: string,
  ): Promise<InmuebleConUnidades> {
    return this.prisma.$transaction(async (tx) => {
      const inmueble = await tx.inmueble.create({
        data: {
          arrendador_id: arrendadorId,
          direccion: dto.direccion,
          ciudad: dto.ciudad,
          estrato: dto.estrato,
          matricula_inmobiliaria: dto.matricula_inmobiliaria,
          foto_portada_url: dto.foto_portada_url,
        },
      });

      await tx.unidad.create({
        data: {
          inmueble_id: inmueble.id,
          nombre: 'Unidad principal',
          tipo: TipoUnidad.APARTAMENTO,
          metros_cuadrados: '0',
          numero_habitaciones: 0,
          numero_banos: 0,
          canon_base_centavos: 0,
          ocupantes_maximos: 1,
          acepta_mascotas: false,
          uso_permitido: UsoPermitido.RESIDENCIAL,
        },
      });

      return tx.inmueble.findUniqueOrThrow({
        where: { id: inmueble.id },
        include: { unidades: true },
      });
    });
  }

  listar(arrendadorId: string): Promise<InmuebleConUnidades[]> {
    return this.prisma.inmueble.findMany({
      where: { arrendador_id: arrendadorId },
      include: { unidades: true },
      orderBy: { creado_en: 'desc' },
    });
  }

  encontrarUno(
    id: string,
    arrendadorId: string,
  ): Promise<InmuebleConUnidades | null> {
    return this.prisma.inmueble.findFirst({
      where: { id, arrendador_id: arrendadorId },
      include: { unidades: true },
    });
  }

  async actualizar(
    id: string,
    dto: ActualizarInmuebleDto,
    arrendadorId: string,
  ): Promise<InmuebleConUnidades | null> {
    const resultado = await this.prisma.inmueble.updateMany({
      where: { id, arrendador_id: arrendadorId },
      data: dto,
    });
    if (resultado.count === 0) {
      return null;
    }
    return this.prisma.inmueble.findFirst({
      where: { id, arrendador_id: arrendadorId },
      include: { unidades: true },
    });
  }
}
