import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActualizarPerfilArrendadorDto } from './dto/actualizar-perfil-arrendador.dto';

const CAMPOS_PERFIL = {
  id: true,
  nombre: true,
  correo: true,
  telefono: true,
  cedula: true,
  foto_cedula_nit_url: true,
  creado_en: true,
} as const;

@Injectable()
export class ArrendadorService {
  constructor(private readonly prisma: PrismaService) {}

  verPerfil(arrendadorId: string) {
    return this.prisma.arrendador.findUnique({
      where: { id: arrendadorId },
      select: CAMPOS_PERFIL,
    });
  }

  async actualizarPerfil(
    arrendadorId: string,
    dto: ActualizarPerfilArrendadorDto,
  ) {
    const data: { nombre?: string; telefono?: string; cedula?: string } = {};
    if (dto.nombre !== undefined) data.nombre = dto.nombre;
    if (dto.telefono !== undefined) data.telefono = dto.telefono;
    if (dto.cedula !== undefined) data.cedula = dto.cedula;

    const arrendador = await this.prisma.arrendador.update({
      where: { id: arrendadorId },
      data,
      select: CAMPOS_PERFIL,
    });

    if (!arrendador) {
      throw new NotFoundException('Arrendador no encontrado.');
    }

    return arrendador;
  }
}
