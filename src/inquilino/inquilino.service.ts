import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CrearInquilinoDto } from './dto/crear-inquilino.dto';

type InquilinoSeguro = Prisma.InquilinoGetPayload<{
  select: {
    id: true;
    arrendador_id: true;
    nombre: true;
    cedula: true;
    telefono: true;
    correo: true;
    foto_cedula_url: true;
    creado_en: true;
  };
}>;

@Injectable()
export class InquilinoService {
  constructor(private readonly prisma: PrismaService) {}

  crear(
    dto: CrearInquilinoDto,
    arrendadorId: string,
  ): Promise<InquilinoSeguro> {
    return this.prisma.inquilino.create({
      data: {
        arrendador_id: arrendadorId,
        nombre: dto.nombre,
        cedula: dto.cedula,
        telefono: dto.telefono,
      },
      select: {
        id: true,
        arrendador_id: true,
        nombre: true,
        cedula: true,
        telefono: true,
        correo: true,
        foto_cedula_url: true,
        creado_en: true,
      },
    });
  }
}
