import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CrearInquilinoDto } from './dto/crear-inquilino.dto';
import { normalizarCedula } from '../common/utils/normalizar-cedula';

type InquilinoSeguro = Prisma.InquilinoGetPayload<{
  select: {
    id: true;
    nombre: true;
    cedula: true;
    telefono: true;
    correo: true;
    creado_en: true;
  };
}>;

const SELECT_INQUILINO_SEGURO = {
  id: true,
  nombre: true,
  cedula: true,
  telefono: true,
  correo: true,
  creado_en: true,
} as const satisfies Prisma.InquilinoSelect;

@Injectable()
export class InquilinoService {
  constructor(private readonly prisma: PrismaService) {}

  listar(arrendadorId: string): Promise<InquilinoSeguro[]> {
    return this.prisma.inquilino.findMany({
      where: { arrendador_id: arrendadorId },
      orderBy: { creado_en: 'desc' },
      select: SELECT_INQUILINO_SEGURO,
    });
  }

  encontrarUno(
    id: string,
    arrendadorId: string,
  ): Promise<InquilinoSeguro | null> {
    return this.prisma.inquilino.findFirst({
      where: { id, arrendador_id: arrendadorId },
      select: SELECT_INQUILINO_SEGURO,
    });
  }

  crear(
    dto: CrearInquilinoDto,
    arrendadorId: string,
  ): Promise<InquilinoSeguro> {
    const cedula = normalizarCedula(dto.cedula);
    if (cedula.length < 5 || cedula.length > 20) {
      throw new BadRequestException(
        'La cédula debe tener entre 5 y 20 caracteres alfanuméricos.',
      );
    }
    return this.prisma.inquilino.create({
      data: {
        arrendador_id: arrendadorId,
        nombre: dto.nombre,
        cedula,
        telefono: dto.telefono,
      },
      select: SELECT_INQUILINO_SEGURO,
    });
  }
}
