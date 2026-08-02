import { Injectable } from '@nestjs/common';
import { Prisma, TipoUnidad, UsoPermitido } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CrearInmuebleDto } from './dto/crear-inmueble.dto';

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
}
