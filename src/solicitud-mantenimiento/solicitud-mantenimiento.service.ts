import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  EstadoContrato,
  EstadoSolicitudMantenimiento,
} from '@prisma/client';
import { basename, extname } from 'path';
import { AlmacenamientoService } from '../almacenamiento/almacenamiento.service';
import { PrismaService } from '../prisma/prisma.service';
import { ActualizarEstadoSolicitudMantenimientoDto } from './dto/actualizar-estado-solicitud-mantenimiento.dto';
import { CrearSolicitudMantenimientoDto } from './dto/crear-solicitud-mantenimiento.dto';
import { ListarSolicitudesMantenimientoQueryDto } from './dto/listar-solicitudes-mantenimiento-query.dto';

@Injectable()
export class SolicitudMantenimientoService {
  private readonly logger = new Logger(SolicitudMantenimientoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly almacenamiento: AlmacenamientoService,
  ) {}

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
      throw new NotFoundException(
        'No existe un contrato para el inquilino autenticado en esa unidad.',
      );
    }

    if (contrato.estado !== EstadoContrato.ACTIVO) {
      throw new ConflictException(
        'No puedes crear solicitudes de mantenimiento, tu contrato ya no está activo.',
      );
    }

    let adjuntoRuta: string | null = null;
    if (adjunto) {
      adjuntoRuta = `solicitudes-mantenimiento/${dto.unidadId}/${Date.now()}-${this.sanitizarNombreArchivo(adjunto.originalname)}`;
      await this.almacenamiento.subirArchivo(
        adjunto.buffer,
        adjuntoRuta,
        adjunto.mimetype,
      );
    }

    try {
      const solicitud = await this.prisma.solicitudMantenimiento.create({
        data: {
          arrendador_id: contrato.unidad.inmueble.arrendador_id,
          unidad_id: dto.unidadId,
          inquilino_id: inquilinoId,
          descripcion: dto.descripcion,
          adjunto_ruta: adjuntoRuta,
          urgencia: dto.urgencia,
          estado: EstadoSolicitudMantenimiento.PENDIENTE,
        },
      });

      return this.exponerUrlFirmada(solicitud);
    } catch (error) {
      if (adjuntoRuta) {
        await this.eliminarArchivoHuérfano(adjuntoRuta);
      }
      throw error;
    }
  }

  async listarMias(inquilinoId: string) {
    const solicitudes = await this.prisma.solicitudMantenimiento.findMany({
      where: { inquilino_id: inquilinoId },
      orderBy: { creado_en: 'desc' },
    });

    return Promise.all(
      solicitudes.map((s) => this.exponerUrlFirmada(s)),
    );
  }

  private readonly INCLUDE_SOLICITUD = {
    unidad: { include: { inmueble: true } },
    inquilino: {
      select: { id: true, nombre: true, cedula: true, telefono: true },
    },
  } as const;

  async listar(
    arrendadorId: string,
    query: ListarSolicitudesMantenimientoQueryDto,
  ) {
    const solicitudes = await this.prisma.solicitudMantenimiento.findMany({
      where: {
        arrendador_id: arrendadorId,
        ...(query.estado ? { estado: query.estado } : {}),
        ...(query.urgencia ? { urgencia: query.urgencia } : {}),
        ...(query.unidadId ? { unidad_id: query.unidadId } : {}),
      },
      include: this.INCLUDE_SOLICITUD,
      orderBy: [{ urgencia: 'desc' }, { creado_en: 'desc' }],
    });

    return Promise.all(
      solicitudes.map((s) => this.exponerUrlFirmada(s)),
    );
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
    return this.exponerUrlFirmada(solicitud);
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

    const actualizada = await this.prisma.solicitudMantenimiento.update({
      where: { id: solicitud.id },
      data: { estado: dto.estado },
      include: this.INCLUDE_SOLICITUD,
    });

    return this.exponerUrlFirmada(actualizada);
  }

  private async exponerUrlFirmada<
    T extends { adjunto_ruta: string | null },
  >(
    solicitud: T,
  ): Promise<Omit<T, 'adjunto_ruta'> & { adjunto_url: string | null }> {
    const { adjunto_ruta, ...resto } = solicitud;
    if (!adjunto_ruta) {
      return { ...resto, adjunto_url: null };
    }
    return {
      ...resto,
      adjunto_url: await this.almacenamiento.generarUrlFirmada(adjunto_ruta),
    };
  }

  private sanitizarNombreArchivo(nombre: string): string {
    const extension = extname(nombre);
    const base = basename(nombre, extension);
    const baseLimpia = base.replace(/[^a-zA-Z0-9_-]/g, '_');
    const extensionLimpia = extension.replace(/[^a-zA-Z0-9.]/g, '');
    return `${baseLimpia}${extensionLimpia}`;
  }

  private async eliminarArchivoHuérfano(ruta: string): Promise<void> {
    try {
      await this.almacenamiento.eliminarArchivo(ruta);
    } catch {
      this.logger.warn(
        `No se pudo eliminar el archivo huérfano '${ruta}' del bucket.`,
      );
    }
  }
}
