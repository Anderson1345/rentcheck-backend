import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EstadoContrato, EstadoSolicitudMantenimiento } from '@prisma/client';
import { unlink } from 'fs/promises';
import { PrismaService } from '../prisma/prisma.service';
import { ActualizarEstadoSolicitudMantenimientoDto } from './dto/actualizar-estado-solicitud-mantenimiento.dto';
import { CrearSolicitudMantenimientoDto } from './dto/crear-solicitud-mantenimiento.dto';
import { ListarSolicitudesMantenimientoQueryDto } from './dto/listar-solicitudes-mantenimiento-query.dto';

@Injectable()
export class SolicitudMantenimientoService {
  constructor(private readonly prisma: PrismaService) {}

  async crear(
    dto: CrearSolicitudMantenimientoDto,
    inquilinoId: string,
    adjunto?: Express.Multer.File,
  ) {
    const donde = {
      unidad_id: dto.unidadId,
      inquilino_id: inquilinoId,
    };
    const include = {
      unidad: { include: { inmueble: true } },
    };

    const contrato =
      (await this.prisma.contrato.findFirst({
        where: { ...donde, estado: EstadoContrato.ACTIVO },
        include,
      })) ??
      (await this.prisma.contrato.findFirst({
        where: donde,
        orderBy: { creado_en: 'desc' },
        include,
      }));

    if (!contrato) {
      if (adjunto) {
        await this.eliminarAdjunto(adjunto.path);
      }
      throw new NotFoundException(
        'No existe un contrato para el inquilino autenticado en esa unidad.',
      );
    }

    if (contrato.estado !== EstadoContrato.ACTIVO) {
      if (adjunto) {
        await this.eliminarAdjunto(adjunto.path);
      }
      throw new ConflictException(
        'No puedes crear solicitudes de mantenimiento, tu contrato ya no está activo.',
      );
    }

    try {
      return await this.prisma.solicitudMantenimiento.create({
        data: {
          arrendador_id: contrato.unidad.inmueble.arrendador_id,
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

  private readonly INCLUDE_SOLICITUD = {
    unidad: { include: { inmueble: true } },
    inquilino: {
      select: { id: true, nombre: true, cedula: true, telefono: true },
    },
  } as const;

  listar(arrendadorId: string, query: ListarSolicitudesMantenimientoQueryDto) {
    return this.prisma.solicitudMantenimiento.findMany({
      where: {
        arrendador_id: arrendadorId,
        ...(query.estado ? { estado: query.estado } : {}),
        ...(query.urgencia ? { urgencia: query.urgencia } : {}),
        ...(query.unidadId ? { unidad_id: query.unidadId } : {}),
      },
      include: this.INCLUDE_SOLICITUD,
      orderBy: [{ urgencia: 'desc' }, { creado_en: 'desc' }],
    });
  }

  async encontrarUno(id: string, arrendadorId: string) {
    const solicitud = await this.prisma.solicitudMantenimiento.findFirst({
      where: { id, arrendador_id: arrendadorId },
      include: this.INCLUDE_SOLICITUD,
    });
    if (!solicitud) {
      throw new NotFoundException(
        'Solicitud de mantenimiento no encontrada o no pertenece al arrendador autenticado.',
      );
    }
    return solicitud;
  }

  async actualizarEstado(
    id: string,
    arrendadorId: string,
    dto: ActualizarEstadoSolicitudMantenimientoDto,
  ) {
    const solicitud = await this.prisma.solicitudMantenimiento.findFirst({
      where: { id, arrendador_id: arrendadorId },
    });
    if (!solicitud) {
      throw new NotFoundException(
        'Solicitud de mantenimiento no encontrada o no pertenece al arrendador autenticado.',
      );
    }

    if (solicitud.estado === EstadoSolicitudMantenimiento.RESUELTO) {
      throw new ConflictException(
        'La solicitud ya está resuelta y no puede cambiar de estado.',
      );
    }

    if (
      solicitud.estado === EstadoSolicitudMantenimiento.EN_PROCESO &&
      dto.estado === EstadoSolicitudMantenimiento.EN_PROCESO
    ) {
      throw new ConflictException(
        'Una solicitud en proceso solo puede pasar a resuelto.',
      );
    }

    return this.prisma.solicitudMantenimiento.update({
      where: { id: solicitud.id },
      data: { estado: dto.estado },
      include: this.INCLUDE_SOLICITUD,
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
