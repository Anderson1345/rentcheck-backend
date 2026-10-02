import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AdjuntoTipo,
  extensionDeAdjunto,
  tipoDeAdjunto,
} from '../common/adjunto-tipo.util';
import { firmarTolerante } from '../common/firma-tolerante';
import {
  EstadoContrato,
  EstadoSolicitudMantenimiento,
  Prisma,
} from '@prisma/client';
import { basename, extname } from 'path';
import { AlmacenamientoService } from '../almacenamiento/almacenamiento.service';
import { contratoVinculadoDelInquilino } from '../common/contrato-vinculado-inquilino';
import { conFotoDeUnidadAnidada } from '../common/foto-perfil';
import { calcularHuellaSolicitud } from '../common/huella-idempotencia.util';
import { resolverIdContratoDelInquilino } from '../common/resolver-contrato-inquilino';
import {
  IdempotenciaService,
  ParametrosClave,
} from '../idempotencia/idempotencia.service';
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
    private readonly idempotencia: IdempotenciaService,
  ) {}

  async crear(
    dto: CrearSolicitudMantenimientoDto,
    inquilinoId: string,
    adjunto?: Express.Multer.File,
    claveIdempotencia?: string,
  ) {
    let parametrosClave: ParametrosClave | undefined;
    if (claveIdempotencia) {
      parametrosClave = {
        inquilinoId,
        endpoint: 'POST /solicitudes-mantenimiento',
        clave: claveIdempotencia,
        huella: calcularHuellaSolicitud({
          unidadId: dto.unidadId,
          descripcion: dto.descripcion,
          urgencia: dto.urgencia,
          adjunto: adjunto?.buffer ?? null,
        }),
      };
      const recursoId =
        await this.idempotencia.buscarRecursoExistente(parametrosClave);
      if (recursoId) {
        return this.reproducirSolicitud(recursoId);
      }
    }

    const donde = {
      unidad_id: dto.unidadId,
      inquilino_id: inquilinoId,
    };
    const include = {
      unidad: { select: { inmueble: { select: { arrendador_id: true } } } },
    };

    const contratoId = await resolverIdContratoDelInquilino(this.prisma, donde);
    const contrato = contratoId
      ? await this.prisma.contrato.findUnique({
          where: { id: contratoId },
          include,
        })
      : null;

    if (!contrato) {
      throw new NotFoundException(
        'No existe un contrato para el inquilino autenticado en esa unidad.',
      );
    }

    if (contrato.estado !== EstadoContrato.ACTIVO) {
      throw new ConflictException({
        codigo: 'CONTRATO_NO_ACTIVO',
        mensaje:
          contrato.estado === EstadoContrato.PROGRAMADO
            ? 'No puedes crear solicitudes de mantenimiento todavía: tu contrato aún no está activo.'
            : 'No puedes crear solicitudes de mantenimiento, tu contrato ya no está activo.',
      });
    }

    let reclamoId: string | undefined;
    if (parametrosClave) {
      const reclamo = await this.idempotencia.reclamar(parametrosClave);
      if ('recursoId' in reclamo) {
        return this.reproducirSolicitud(reclamo.recursoId);
      }
      reclamoId = reclamo.reclamoId;
    }

    let adjuntoRuta: string | null = null;
    let adjuntoSubido = false;
    let solicitud: Awaited<
      ReturnType<PrismaService['solicitudMantenimiento']['create']>
    >;

    try {
      if (adjunto) {
        adjuntoRuta = `solicitudes-mantenimiento/${dto.unidadId}/${Date.now()}-${this.nombreDeAdjunto(adjunto.originalname, adjunto.mimetype)}`;
        await this.almacenamiento.subirArchivo(
          adjunto.buffer,
          adjuntoRuta,
          adjunto.mimetype,
        );
        adjuntoSubido = true;
      }

      const datos = {
        arrendador_id: contrato.unidad.inmueble.arrendador_id,
        unidad_id: dto.unidadId,
        inquilino_id: inquilinoId,
        descripcion: dto.descripcion,
        adjunto_ruta: adjuntoRuta,
        urgencia: dto.urgencia,
        estado: EstadoSolicitudMantenimiento.PENDIENTE,
      };

      solicitud = reclamoId
        ? await this.crearYAsociarReclamo(datos, reclamoId)
        : await this.prisma.solicitudMantenimiento.create({ data: datos });
    } catch (error) {
      if (reclamoId) {
        await this.idempotencia.liberarReclamo(reclamoId);
      }
      if (adjuntoSubido && adjuntoRuta) {
        await this.eliminarArchivoHuérfano(adjuntoRuta);
      }
      throw error;
    }

    return {
      solicitud: await this.exponerUrlFirmada(solicitud),
      reproducido: false,
    };
  }

  private crearYAsociarReclamo(
    datos: Prisma.SolicitudMantenimientoUncheckedCreateInput,
    reclamoId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const creada = await tx.solicitudMantenimiento.create({ data: datos });
      await this.idempotencia.asociarRecurso(tx, reclamoId, creada.id);
      return creada;
    });
  }

  private async reproducirSolicitud(solicitudId: string) {
    const solicitud =
      await this.prisma.solicitudMantenimiento.findUniqueOrThrow({
        where: { id: solicitudId },
      });
    return {
      solicitud: await this.exponerUrlFirmada(solicitud),
      reproducido: true,
    };
  }

  /**
   * Solicitudes del inquilino; con `contratoId`, solo las de la unidad de ese
   * contrato (que debe ser suyo, estar vinculado y no cancelado).
   */
  async listarMias(inquilinoId: string, contratoId?: string) {
    const unidadDelFiltro = contratoId
      ? (
          await contratoVinculadoDelInquilino(
            this.prisma,
            inquilinoId,
            contratoId,
            { unidad_id: true },
          )
        ).unidad_id
      : undefined;
    const solicitudes = await this.prisma.solicitudMantenimiento.findMany({
      where: {
        inquilino_id: inquilinoId,
        ...(unidadDelFiltro ? { unidad_id: unidadDelFiltro } : {}),
        // Solo las de unidades con un contrato suyo ya vinculado.
        unidad: {
          contratos: {
            some: { inquilino_id: inquilinoId, vinculado_en: { not: null } },
          },
        },
      },
      orderBy: { creado_en: 'desc' },
    });

    return Promise.all(solicitudes.map((s) => this.exponerUrlFirmada(s)));
  }

  /** Una solicitud propia, solo si su unidad tiene un contrato suyo vinculado. */
  async encontrarUnaDelInquilino(id: string, inquilinoId: string) {
    const solicitud = await this.prisma.solicitudMantenimiento.findFirst({
      where: {
        id,
        inquilino_id: inquilinoId,
        unidad: {
          contratos: {
            some: { inquilino_id: inquilinoId, vinculado_en: { not: null } },
          },
        },
      },
    });
    if (!solicitud) {
      throw new NotFoundException('Solicitud de mantenimiento no encontrada.');
    }
    return this.exponerUrlFirmada(solicitud);
  }

  private readonly INCLUDE_SOLICITUD = {
    unidad: {
      include: {
        inmueble: {
          select: {
            id: true,
            direccion: true,
            ciudad: true,
            estrato: true,
            matricula_inmobiliaria: true,
            creado_en: true,
          },
        },
      },
    },
  } as const;

  /**
   * Nombre, cédula y teléfono del inquilino según lo que escribió el
   * arrendador: la copia del contrato más reciente no cancelado de esa unidad
   * con esa persona. La solicitud no tiene `contrato_id`; si no se encuentra
   * ningún contrato, los tres datos van en null (nunca los del perfil global).
   */
  private async conInquilinoDeLaCopia<
    T extends {
      arrendador_id: string;
      unidad_id: string;
      inquilino_id: string;
    },
  >(solicitudes: T[]) {
    if (solicitudes.length === 0) {
      return [];
    }
    const contratos = await this.prisma.contrato.findMany({
      where: {
        arrendador_id: solicitudes[0].arrendador_id,
        estado: { not: EstadoContrato.CANCELADO },
        unidad_id: { in: [...new Set(solicitudes.map((s) => s.unidad_id))] },
        inquilino_id: {
          in: [...new Set(solicitudes.map((s) => s.inquilino_id))],
        },
      },
      orderBy: { creado_en: 'desc' },
      select: {
        unidad_id: true,
        inquilino_id: true,
        inquilino_nombre: true,
        inquilino_cedula: true,
        inquilino_telefono: true,
      },
    });
    return solicitudes.map((solicitud) => {
      const copia = contratos.find(
        (c) =>
          c.unidad_id === solicitud.unidad_id &&
          c.inquilino_id === solicitud.inquilino_id,
      );
      return {
        ...solicitud,
        inquilino: {
          id: solicitud.inquilino_id,
          nombre: copia?.inquilino_nombre ?? null,
          cedula: copia?.inquilino_cedula ?? null,
          telefono: copia?.inquilino_telefono ?? null,
        },
      };
    });
  }

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
      (await this.conInquilinoDeLaCopia(solicitudes)).map((s) =>
        this.exponerUrlFirmada(s),
      ),
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
    const [conCopia] = await this.conInquilinoDeLaCopia([solicitud]);
    return this.exponerUrlFirmada(conCopia);
  }

  async actualizarEstado(
    id: string,
    arrendadorId: string,
    dto: ActualizarEstadoSolicitudMantenimientoDto,
  ) {
    const actualizada = await this.prisma.$transaction(async (tx) => {
      const solicitudExistente = await tx.solicitudMantenimiento.findFirst({
        where: { id, arrendador_id: arrendadorId },
        select: { id: true },
      });
      if (!solicitudExistente) {
        throw new NotFoundException(
          'Solicitud de mantenimiento no encontrada o no pertenece al arrendador autenticado.',
        );
      }

      // Reglas de transición: RESUELTO no cambia de estado; EN_PROCESO solo
      // puede pasar a RESUELTO (no "cambiar" a EN_PROCESO otra vez).
      const estadosOrigenValidos =
        dto.estado === EstadoSolicitudMantenimiento.EN_PROCESO
          ? [EstadoSolicitudMantenimiento.PENDIENTE]
          : [
              EstadoSolicitudMantenimiento.PENDIENTE,
              EstadoSolicitudMantenimiento.EN_PROCESO,
            ];

      const resultado = await tx.solicitudMantenimiento.updateMany({
        where: {
          id,
          arrendador_id: arrendadorId,
          estado: { in: estadosOrigenValidos },
        },
        data: { estado: dto.estado },
      });

      if (resultado.count === 0) {
        throw new ConflictException({
          codigo: 'TRANSICION_INVALIDA',
          mensaje:
            'La transición de estado no es válida para el estado actual de la solicitud.',
        });
      }

      return tx.solicitudMantenimiento.findUniqueOrThrow({
        where: { id },
        include: this.INCLUDE_SOLICITUD,
      });
    });

    const [conCopia] = await this.conInquilinoDeLaCopia([actualizada]);
    return this.exponerUrlFirmada(conCopia);
  }

  private async exponerUrlFirmada<
    T extends { id: string; adjunto_ruta: string | null },
  >(
    solicitud: T,
  ): Promise<
    Omit<T, 'adjunto_ruta'> & {
      adjunto_url: string | null;
      adjunto_tipo: AdjuntoTipo | null;
    }
  > {
    const { adjunto_ruta, ...sinRuta } = solicitud;
    // La unidad anidada trae `foto_principal_url`: siempre firmada, nunca la ruta.
    const resto = await conFotoDeUnidadAnidada(
      sinRuta,
      this.almacenamiento,
      this.logger,
    );
    return {
      ...resto,
      adjunto_url: await firmarTolerante(
        this.almacenamiento,
        adjunto_ruta,
        this.logger,
        `el adjunto de la solicitud ${solicitud.id}`,
      ),
      // Por la extensión de la ruta; la ruta misma nunca sale (B-68).
      adjunto_tipo: tipoDeAdjunto(adjunto_ruta),
    };
  }

  /**
   * Nombre del archivo guardado: el nombre base del cliente, saneado, y una extensión que sale del
   * mimetype ya validado por el contenido real (el validador de B0.5-C comprueba los bytes antes de
   * llegar aquí), nunca de la extensión que mande el cliente.
   */
  private nombreDeAdjunto(nombre: string, mimetype: string): string {
    const base = basename(nombre, extname(nombre));
    const baseLimpia = base.replace(/[^a-zA-Z0-9_-]/g, '_');
    return `${baseLimpia}${extensionDeAdjunto(mimetype) ?? ''}`;
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
