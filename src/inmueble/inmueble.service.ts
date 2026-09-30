import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  EstadoContrato,
  EstadoPago,
  Prisma,
  TipoDocumentoInmueble,
  TipoUnidad,
  UsoPermitido,
} from '@prisma/client';
import { ZipArchive } from 'archiver';
import { existsSync } from 'fs';
import { basename, extname, join } from 'path';
import { PassThrough } from 'stream';
import { AlmacenamientoService } from '../almacenamiento/almacenamiento.service';
import { PrismaService } from '../prisma/prisma.service';
import { CrearInmuebleDto } from './dto/crear-inmueble.dto';
import { ActualizarInmuebleDto } from './dto/actualizar-inmueble.dto';
import { CrearUnidadDto } from './dto/crear-unidad.dto';
import { ActualizarUnidadDto } from './dto/actualizar-unidad.dto';
import { CrearDocumentoInmuebleDto } from './dto/crear-documento-inmueble.dto';

type InmuebleConUnidades = Prisma.InmuebleGetPayload<{
  include: { unidades: true };
}>;

type InmuebleConUnidadesConUrl = Omit<
  InmuebleConUnidades,
  'foto_portada_ruta'
> & { foto_portada_url: string | null };

const INCLUDE_INMUEBLE_PARA_DESCARGA = {
  documentos: true,
  unidades: {
    select: {
      contratos: {
        select: {
          id: true,
          pdf_contrato_ruta: true,
          documentos: {
            orderBy: { version: 'asc' },
            select: { tipo: true, version: true, ruta: true },
          },
          // Solo los comprobantes aprobados: los rechazados, reemplazados y
          // pendientes no son evidencia de pago.
          pagos: {
            where: { estado: EstadoPago.APROBADO },
            orderBy: { periodo: 'asc' },
            select: { id: true, periodo: true, comprobante_ruta: true },
          },
        },
      },
    },
  },
} as const satisfies Prisma.InmuebleInclude;

type InmuebleConDocumentosParaDescarga = Prisma.InmuebleGetPayload<{
  include: typeof INCLUDE_INMUEBLE_PARA_DESCARGA;
}>;

type DocumentoInmuebleConUrl = Omit<
  Prisma.DocumentoInmuebleGetPayload<object>,
  'archivo_ruta'
> & { archivo_url: string | null };

interface CamposResidenciales {
  metros_cuadrados?: number | null;
  numero_habitaciones?: number | null;
  numero_banos?: number | null;
  ocupantes_maximos?: number | null;
}

function errorEstratoRequerido(): BadRequestException {
  return new BadRequestException({
    codigo: 'ESTRATO_REQUERIDO',
    mensaje:
      'El inmueble necesita un estrato (1 a 6) para tener unidades residenciales.',
  });
}

/**
 * Una unidad residencial necesita área (>= 1), habitaciones, baños y
 * ocupantes máximos (>= 1). Con `exigirTodos` falta = error; sin él solo se
 * valida lo que llegó (los nulos de la unidad principal siguen siendo
 * válidos hasta que el usuario los complete).
 */
function validarCamposResidenciales(
  valores: CamposResidenciales,
  exigirTodos: boolean,
): void {
  const problemas: string[] = [];
  const revisar = (nombre: keyof CamposResidenciales, minimo: number): void => {
    const valor = valores[nombre];
    if (valor === undefined || valor === null) {
      if (exigirTodos) problemas.push(`${nombre} es obligatorio`);
      return;
    }
    if (valor < minimo) problemas.push(`${nombre} debe ser >= ${minimo}`);
  };
  revisar('metros_cuadrados', 1);
  revisar('numero_habitaciones', 0);
  revisar('numero_banos', 0);
  revisar('ocupantes_maximos', 1);

  if (problemas.length > 0) {
    throw new BadRequestException({
      codigo: 'CAMPOS_RESIDENCIALES_REQUERIDOS',
      mensaje:
        'Una unidad residencial requiere área, habitaciones, baños y ocupantes máximos válidos.',
      detalles: problemas,
    });
  }
}

@Injectable()
export class InmuebleService {
  private readonly logger = new Logger(InmuebleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly almacenamiento: AlmacenamientoService,
  ) {}

  async crear(
    dto: CrearInmuebleDto,
    arrendadorId: string,
  ): Promise<InmuebleConUnidadesConUrl> {
    const usoPrincipal = dto.uso_unidad_principal ?? UsoPermitido.RESIDENCIAL;
    if (usoPrincipal === UsoPermitido.RESIDENCIAL && !dto.estrato) {
      throw errorEstratoRequerido();
    }

    return this.prisma.$transaction(async (tx) => {
      const inmueble = await tx.inmueble.create({
        data: {
          arrendador_id: arrendadorId,
          direccion: dto.direccion,
          ciudad: dto.ciudad,
          estrato: dto.estrato ?? null,
          matricula_inmobiliaria: dto.matricula_inmobiliaria,
        },
      });

      await tx.unidad.create({
        data: {
          inmueble_id: inmueble.id,
          nombre: 'Unidad principal',
          tipo:
            usoPrincipal === UsoPermitido.COMERCIAL
              ? TipoUnidad.LOCAL
              : TipoUnidad.APARTAMENTO,
          metros_cuadrados: null,
          numero_habitaciones: null,
          numero_banos: null,
          canon_base_centavos: 0,
          ocupantes_maximos: null,
          acepta_mascotas: false,
          uso_permitido: usoPrincipal,
        },
      });

      return this.exponerUrlFirmadaInmueble(
        await tx.inmueble.findUniqueOrThrow({
          where: { id: inmueble.id },
          include: { unidades: true },
        }),
      );
    });
  }

  async listar(arrendadorId: string): Promise<InmuebleConUnidadesConUrl[]> {
    const inmuebles = await this.prisma.inmueble.findMany({
      where: { arrendador_id: arrendadorId },
      include: { unidades: true },
      orderBy: { creado_en: 'desc' },
    });

    return Promise.all(inmuebles.map((i) => this.exponerUrlFirmadaInmueble(i)));
  }

  async encontrarUno(
    id: string,
    arrendadorId: string,
  ): Promise<InmuebleConUnidadesConUrl | null> {
    const inmueble = await this.prisma.inmueble.findFirst({
      where: { id, arrendador_id: arrendadorId },
      include: { unidades: true },
    });
    if (!inmueble) {
      return null;
    }
    return this.exponerUrlFirmadaInmueble(inmueble);
  }

  async actualizar(
    id: string,
    dto: ActualizarInmuebleDto,
    arrendadorId: string,
  ): Promise<InmuebleConUnidadesConUrl | null> {
    if (dto.estrato === null) {
      const unidadesResidenciales = await this.prisma.unidad.count({
        where: {
          uso_permitido: UsoPermitido.RESIDENCIAL,
          inmueble: { id, arrendador_id: arrendadorId },
        },
      });
      if (unidadesResidenciales > 0) {
        throw errorEstratoRequerido();
      }
    }

    const resultado = await this.prisma.inmueble.updateMany({
      where: { id, arrendador_id: arrendadorId },
      data: dto,
    });
    if (resultado.count === 0) {
      return null;
    }
    const inmueble = await this.prisma.inmueble.findFirst({
      where: { id, arrendador_id: arrendadorId },
      include: { unidades: true },
    });
    if (!inmueble) {
      return null;
    }
    return this.exponerUrlFirmadaInmueble(inmueble);
  }

  async eliminar(id: string, arrendadorId: string) {
    const inmueble = await this.prisma.inmueble.findFirst({
      where: { id, arrendador_id: arrendadorId },
    });
    if (!inmueble) {
      return null;
    }

    const unidadesAsociadas = await this.prisma.unidad.count({
      where: { inmueble_id: id },
    });
    if (unidadesAsociadas > 0) {
      throw new ConflictException(
        'No se puede eliminar: este inmueble tiene unidades asociadas, elimínalas primero',
      );
    }

    const documentosAsociados = await this.prisma.documentoInmueble.count({
      where: { inmueble_id: id },
    });
    if (documentosAsociados > 0) {
      throw new ConflictException({
        codigo: 'INMUEBLE_CON_DOCUMENTOS',
        mensaje:
          'No se puede eliminar: este inmueble tiene documentos asociados, elimínalos primero',
      });
    }

    return this.exponerUrlFirmadaInmueble(
      await this.prisma.inmueble.delete({ where: { id } }),
    );
  }

  async crearUnidad(
    inmuebleId: string,
    dto: CrearUnidadDto,
    arrendadorId: string,
  ): Promise<Prisma.UnidadGetPayload<object> | null> {
    const inmueble = await this.prisma.inmueble.findFirst({
      where: { id: inmuebleId, arrendador_id: arrendadorId },
    });
    if (!inmueble) {
      return null;
    }
    if (dto.uso_permitido === UsoPermitido.RESIDENCIAL) {
      validarCamposResidenciales(dto, true);
      if (inmueble.estrato === null) {
        throw errorEstratoRequerido();
      }
    }
    return this.prisma.unidad.create({
      data: {
        inmueble_id: inmuebleId,
        nombre: dto.nombre,
        tipo: dto.tipo,
        metros_cuadrados: dto.metros_cuadrados?.toString() ?? null,
        numero_habitaciones: dto.numero_habitaciones ?? null,
        numero_banos: dto.numero_banos ?? null,
        canon_base_centavos: dto.canon_base_centavos,
        ocupantes_maximos: dto.ocupantes_maximos ?? null,
        acepta_mascotas: dto.acepta_mascotas,
        uso_permitido: dto.uso_permitido,
      },
    });
  }

  async actualizarUnidad(
    inmuebleId: string,
    unidadId: string,
    dto: ActualizarUnidadDto,
    arrendadorId: string,
  ): Promise<Prisma.UnidadGetPayload<object> | null> {
    return this.prisma.$transaction(async (tx) => {
      const inmueble = await tx.inmueble.findFirst({
        where: { id: inmuebleId, arrendador_id: arrendadorId },
      });
      if (!inmueble) {
        return null;
      }
      const unidad = await tx.unidad.findFirst({
        where: { id: unidadId, inmueble_id: inmuebleId },
      });
      if (!unidad) {
        return null;
      }

      const cambiaTipo = dto.tipo !== undefined && dto.tipo !== unidad.tipo;
      const cambiaUso =
        dto.uso_permitido !== undefined &&
        dto.uso_permitido !== unidad.uso_permitido;

      if (cambiaTipo || cambiaUso) {
        const contratosActivos = await tx.contrato.count({
          where: {
            unidad_id: unidadId,
            estado: {
              in: [EstadoContrato.ACTIVO, EstadoContrato.PROGRAMADO],
            },
          },
        });
        if (contratosActivos > 0) {
          throw new ConflictException({
            codigo: 'UNIDAD_CON_CONTRATO_ACTIVO',
            mensaje:
              'No se puede cambiar el tipo ni el uso de una unidad con un contrato activo.',
          });
        }
      }

      const usoFinal = dto.uso_permitido ?? unidad.uso_permitido;
      if (usoFinal === UsoPermitido.RESIDENCIAL) {
        if (cambiaUso) {
          validarCamposResidenciales(
            {
              metros_cuadrados:
                dto.metros_cuadrados ?? unidad.metros_cuadrados?.toNumber(),
              numero_habitaciones:
                dto.numero_habitaciones ?? unidad.numero_habitaciones,
              numero_banos: dto.numero_banos ?? unidad.numero_banos,
              ocupantes_maximos:
                dto.ocupantes_maximos ?? unidad.ocupantes_maximos,
            },
            true,
          );
          if (inmueble.estrato === null) {
            throw errorEstratoRequerido();
          }
        } else {
          validarCamposResidenciales(dto, false);
        }
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
      if (dto.uso_permitido !== undefined)
        data.uso_permitido = dto.uso_permitido;

      return tx.unidad.update({ where: { id: unidadId }, data });
    });
  }

  async eliminarUnidad(
    inmuebleId: string,
    unidadId: string,
    arrendadorId: string,
  ) {
    const inmueble = await this.prisma.inmueble.findFirst({
      where: { id: inmuebleId, arrendador_id: arrendadorId },
    });
    if (!inmueble) {
      return null;
    }

    const unidad = await this.prisma.unidad.findFirst({
      where: { id: unidadId, inmueble_id: inmuebleId },
    });
    if (!unidad) {
      return null;
    }

    const contratosAsociados = await this.prisma.contrato.count({
      where: { unidad_id: unidadId },
    });
    if (contratosAsociados > 0) {
      throw new ConflictException(
        'No se puede eliminar: esta unidad tiene contratos asociados',
      );
    }

    return this.prisma.unidad.delete({ where: { id: unidadId } });
  }

  async crearDocumento(
    inmuebleId: string,
    arrendadorId: string,
    dto: CrearDocumentoInmuebleDto,
    archivo: Express.Multer.File,
  ): Promise<DocumentoInmuebleConUrl | null> {
    const inmueble = await this.prisma.inmueble.findFirst({
      where: { id: inmuebleId, arrendador_id: arrendadorId },
    });
    if (!inmueble) {
      return null;
    }

    const rutaDestino = `documentos/${inmuebleId}/${Date.now()}-${this.sanitizarNombreArchivo(archivo.originalname)}`;

    await this.almacenamiento.subirArchivo(
      archivo.buffer,
      rutaDestino,
      archivo.mimetype,
    );

    try {
      const documento = await this.prisma.documentoInmueble.create({
        data: {
          inmueble_id: inmuebleId,
          tipo: dto.tipo,
          archivo_ruta: rutaDestino,
        },
      });

      return this.exponerUrlFirmada(documento);
    } catch (error) {
      await this.eliminarArchivoHuérfano(rutaDestino);
      throw error;
    }
  }

  async listarDocumentos(
    inmuebleId: string,
    arrendadorId: string,
    tipo?: TipoDocumentoInmueble,
  ): Promise<DocumentoInmuebleConUrl[] | null> {
    const inmueble = await this.prisma.inmueble.findFirst({
      where: { id: inmuebleId, arrendador_id: arrendadorId },
    });
    if (!inmueble) {
      return null;
    }
    const documentos = await this.prisma.documentoInmueble.findMany({
      where: {
        inmueble_id: inmuebleId,
        ...(tipo ? { tipo } : {}),
      },
      orderBy: { creado_en: 'desc' },
    });

    return Promise.all(documentos.map((d) => this.exponerUrlFirmada(d)));
  }

  async subirFotoPortada(
    id: string,
    arrendadorId: string,
    foto: Express.Multer.File,
  ): Promise<InmuebleConUnidadesConUrl | null> {
    const inmueble = await this.prisma.inmueble.findFirst({
      where: { id, arrendador_id: arrendadorId },
    });
    if (!inmueble) {
      return null;
    }

    const rutaAnterior = inmueble.foto_portada_ruta;
    const extension = foto.mimetype === 'image/png' ? '.png' : '.jpg';
    const rutaDestino = `inmuebles/${id}/portada${extension}`;

    if (rutaAnterior && rutaAnterior !== rutaDestino) {
      await this.eliminarArchivoHuérfano(rutaAnterior);
    }

    await this.almacenamiento.subirArchivo(
      foto.buffer,
      rutaDestino,
      foto.mimetype,
      true,
    );

    try {
      const resultado = await this.prisma.inmueble.updateMany({
        where: { id, arrendador_id: arrendadorId },
        data: { foto_portada_ruta: rutaDestino },
      });
      if (resultado.count === 0) {
        return null;
      }
      return this.exponerUrlFirmadaInmueble(
        await this.prisma.inmueble.findFirstOrThrow({
          where: { id, arrendador_id: arrendadorId },
          include: { unidades: true },
        }),
      );
    } catch (error) {
      await this.eliminarArchivoHuérfano(rutaDestino);
      throw error;
    }
  }

  private async exponerUrlFirmadaInmueble<
    T extends { foto_portada_ruta: string | null },
  >(
    inmueble: T,
  ): Promise<
    Omit<T, 'foto_portada_ruta'> & { foto_portada_url: string | null }
  > {
    const { foto_portada_ruta, ...resto } = inmueble;
    if (!foto_portada_ruta) {
      return { ...resto, foto_portada_url: null };
    }
    return {
      ...resto,
      foto_portada_url:
        await this.almacenamiento.generarUrlFirmada(foto_portada_ruta),
    };
  }

  private async exponerUrlFirmada<T extends { archivo_ruta: string | null }>(
    documento: T,
  ): Promise<Omit<T, 'archivo_ruta'> & { archivo_url: string | null }> {
    const { archivo_ruta, ...resto } = documento;
    if (!archivo_ruta) {
      return { ...resto, archivo_url: null };
    }
    return {
      ...resto,
      archivo_url: await this.almacenamiento.generarUrlFirmada(archivo_ruta),
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

  async construirZipDocumentos(
    id: string,
    arrendadorId: string,
  ): Promise<{ stream: PassThrough; nombreArchivo: string } | null> {
    const inmueble = await this.obtenerInmuebleParaDescarga(id, arrendadorId);
    if (!inmueble) {
      return null;
    }

    const archivo = new ZipArchive({ zlib: { level: 9 } });
    const archivosFallidos: string[] = [];

    const agregarArchivo = async (
      ruta: string | null | undefined,
      carpeta: string,
      nombre: string | null = null,
    ) => {
      if (!ruta) {
        return;
      }
      // Rutas legacy de disco (aún no migradas, p. ej. pdf_contrato_ruta).
      if (ruta.startsWith('uploads/')) {
        const rutaAbsoluta = join(process.cwd(), ruta);
        if (!existsSync(rutaAbsoluta)) {
          archivosFallidos.push(ruta);
          return;
        }
        archivo.file(rutaAbsoluta, {
          name: `${carpeta}/${nombre ?? basename(ruta)}`,
        });
        return;
      }
      try {
        const buffer = await this.almacenamiento.descargarArchivo(ruta);
        archivo.append(buffer, {
          name: `${carpeta}/${nombre ?? basename(ruta)}`,
        });
      } catch {
        archivosFallidos.push(ruta);
      }
    };

    for (const documento of inmueble.documentos) {
      await agregarArchivo(documento.archivo_ruta, 'documentos-inmueble');
    }
    for (const unidad of inmueble.unidades) {
      for (const contrato of unidad.contratos) {
        const contratoCorto = contrato.id.slice(0, 8);
        const carpetaContrato = `contratos/${contratoCorto}`;
        // Todas las versiones: el original y cada otrosí.
        for (const documento of contrato.documentos) {
          await agregarArchivo(
            documento.ruta,
            carpetaContrato,
            `v${documento.version}-${documento.tipo}.pdf`,
          );
        }
        // Contrato sin historial de documentos: se conserva la ruta heredada.
        if (contrato.documentos.length === 0) {
          await agregarArchivo(contrato.pdf_contrato_ruta, carpetaContrato);
        }
        // El nombre lleva período e id del pago para que dos comprobantes
        // con el mismo nombre de archivo no se pisen.
        for (const pago of contrato.pagos) {
          await agregarArchivo(
            pago.comprobante_ruta,
            'comprobantes',
            `${pago.periodo.toISOString().slice(0, 10)}-${pago.id.slice(0, 8)}-${basename(pago.comprobante_ruta ?? '')}`,
          );
        }
      }
    }

    if (archivosFallidos.length > 0) {
      this.logger.warn(
        `Archivos referenciados no descargables desde Supabase para el inmueble ${id}: ${archivosFallidos.join(', ')}`,
      );
    }

    const stream = new PassThrough();
    archivo.on('error', (error) => {
      this.logger.error(
        `Error al generar el ZIP de documentos del inmueble ${id}`,
        error instanceof Error ? error.stack : String(error),
      );
      stream.destroy(error);
    });
    archivo.pipe(stream);
    await archivo.finalize();

    return {
      stream,
      nombreArchivo: `documentos-${this.simplificarDireccion(inmueble.direccion)}.zip`,
    };
  }

  private obtenerInmuebleParaDescarga(
    id: string,
    arrendadorId: string,
  ): Promise<InmuebleConDocumentosParaDescarga | null> {
    return this.prisma.inmueble.findFirst({
      where: { id, arrendador_id: arrendadorId },
      include: INCLUDE_INMUEBLE_PARA_DESCARGA,
    });
  }

  private simplificarDireccion(direccion: string): string {
    const simplificada = direccion
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return simplificada || 'inmueble';
  }
}
