import { Injectable } from '@nestjs/common';
import { Prisma, TipoUnidad, UsoPermitido } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CrearInmuebleDto } from './dto/crear-inmueble.dto';
import { ActualizarInmuebleDto } from './dto/actualizar-inmueble.dto';
import { CrearUnidadDto } from './dto/crear-unidad.dto';
import { ActualizarUnidadDto } from './dto/actualizar-unidad.dto';

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

  async crearUnidad(
    inmuebleId: string,
    dto: CrearUnidadDto,
    arrendadorId: string,
  ): Promise<Prisma.UnidadGetPayload<{}> | null> {
    const inmueble = await this.prisma.inmueble.findFirst({
      where: { id: inmuebleId, arrendador_id: arrendadorId },
    });
    if (!inmueble) {
      return null;
    }
    return this.prisma.unidad.create({
      data: {
        inmueble_id: inmuebleId,
        nombre: dto.nombre,
        tipo: dto.tipo,
        metros_cuadrados: dto.metros_cuadrados.toString(),
        numero_habitaciones: dto.numero_habitaciones,
        numero_banos: dto.numero_banos,
        canon_base_centavos: dto.canon_base_centavos,
        ocupantes_maximos: dto.ocupantes_maximos,
        acepta_mascotas: dto.acepta_mascotas,
        uso_permitido: dto.uso_permitido,
        foto_principal_url: dto.foto_principal_url,
      },
    });
  }

  async actualizarUnidad(
    inmuebleId: string,
    unidadId: string,
    dto: ActualizarUnidadDto,
    arrendadorId: string,
  ): Promise<Prisma.UnidadGetPayload<{}> | null> {
    const inmueble = await this.prisma.inmueble.findFirst({
      where: { id: inmuebleId, arrendador_id: arrendadorId },
    });
    if (!inmueble) {
      return null;
    }

    const data: Prisma.UnidadUpdateInput = {};
    if (dto.nombre !== undefined) data.nombre = dto.nombre;
    if (dto.tipo !== undefined) data.tipo = dto.tipo;
    if (dto.metros_cuadrados !== undefined)
      data.metros_cuadrados = dto.metros_cuadrados.toString();
    if (dto.numero_habitaciones !== undefined)
      data.numero_habitaciones = dto.numero_habitaciones;
    if (dto.numero_banos !== undefined) data.numero_banos = dto.numero_banos;
    if (dto.canon_base_centavos !== undefined)
      data.canon_base_centavos = dto.canon_base_centavos;
    if (dto.ocupantes_maximos !== undefined)
      data.ocupantes_maximos = dto.ocupantes_maximos;
    if (dto.acepta_mascotas !== undefined)
      data.acepta_mascotas = dto.acepta_mascotas;
    if (dto.uso_permitido !== undefined) data.uso_permitido = dto.uso_permitido;
    if (dto.foto_principal_url !== undefined)
      data.foto_principal_url = dto.foto_principal_url;

    const resultado = await this.prisma.unidad.updateMany({
      where: { id: unidadId, inmueble_id: inmuebleId },
      data,
    });
    if (resultado.count === 0) {
      return null;
    }
    return this.prisma.unidad.findFirst({
      where: { id: unidadId, inmueble_id: inmuebleId },
    });
  }
}
