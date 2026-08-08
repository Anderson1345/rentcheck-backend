import { Injectable, NotFoundException } from '@nestjs/common';
import { EstadoContrato, EstadoSolicitudMantenimiento } from '@prisma/client';
import { unlink } from 'fs/promises';
import { PrismaService } from '../prisma/prisma.service';
import { CrearSolicitudMantenimientoDto } from './dto/crear-solicitud-mantenimiento.dto';

@Injectable()
export class SolicitudMantenimientoService {
  constructor(private readonly prisma: PrismaService) {}

  async crear(
    dto: CrearSolicitudMantenimientoDto,
    inquilinoId: string,
    adjunto?: Express.Multer.File,
  ) {
    const contratoActivo = await this.prisma.contrato.findFirst({
      where: {
        unidad_id: dto.unidadId,
        inquilino_id: inquilinoId,
        estado: EstadoContrato.ACTIVO,
      },
      include: {
        unidad: { include: { inmueble: true } },
      },
    });

    if (!contratoActivo) {
      if (adjunto) {
        await this.eliminarAdjunto(adjunto.path);
      }
      throw new NotFoundException(
        'No existe un contrato activo para el inquilino autenticado en esa unidad.',
      );
    }

    try {
      return await this.prisma.solicitudMantenimiento.create({
        data: {
          arrendador_id: contratoActivo.unidad.inmueble.arrendador_id,
          unidad_id: dto.unidadId,
          inquilino_id: inquilinoId,
          descripcion: dto.descripcion,
          adjunto_url: adjunto
            ? `uploads/solicitudes-mantenimiento/${adjunto.filename}`
            : null,
          urgencia: dto.urgencia,
          estado: EstadoSolicitudMantenimiento.PENDIENTE,
        },
      });
    } catch (error) {
      if (adjunto) {
        await this.eliminarAdjunto(adjunto.path);
      }
      throw error;
    }
  }

  listarMias(inquilinoId: string) {
    return this.prisma.solicitudMantenimiento.findMany({
      where: { inquilino_id: inquilinoId },
      orderBy: { creado_en: 'desc' },
    });
  }

  private async eliminarAdjunto(rutaAbsoluta: string): Promise<void> {
    try {
      await unlink(rutaAbsoluta);
    } catch {
      // La limpieza no debe ocultar el error original.
    }
  }
}
