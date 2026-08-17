import { ConflictException, Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  TipoDocumentoInmueble,
  TipoUnidad,
  UsoPermitido,
} from '@prisma/client';
import { ZipArchive } from 'archiver';
import { existsSync } from 'fs';
import { unlink } from 'fs/promises';
import { basename, join } from 'path';
import { PassThrough } from 'stream';
import { PrismaService } from '../prisma/prisma.service';
import { CrearInmuebleDto } from './dto/crear-inmueble.dto';
import { ActualizarInmuebleDto } from './dto/actualizar-inmueble.dto';
import { CrearUnidadDto } from './dto/crear-unidad.dto';
import { ActualizarUnidadDto } from './dto/actualizar-unidad.dto';
import { CrearDocumentoInmuebleDto } from './dto/crear-documento-inmueble.dto';

type InmuebleConUnidades = Prisma.InmuebleGetPayload<{
  include: { unidades: true };
}>;

type InmuebleConDocumentosParaDescarga = Prisma.InmuebleGetPayload<{
  include: {
    documentos: true;
    unidades: {
      include: {
        contratos: { include: { pagos: true } };
      };
    };
  };
}>;

@Injectable()
export class InmuebleService {
  private readonly logger = new Logger(InmuebleService.name);

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

    return this.prisma.inmueble.delete({ where: { id } });
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
  ): Promise<Prisma.DocumentoInmuebleGetPayload<{}> | null> {
    const inmueble = await this.prisma.inmueble.findFirst({
      where: { id: inmuebleId, arrendador_id: arrendadorId },
    });
    if (!inmueble) {
      await this.eliminarArchivo(archivo.path);
      return null;
    }

    try {
      return await this.prisma.documentoInmueble.create({
        data: {
          inmueble_id: inmuebleId,
          tipo: dto.tipo,
          archivo_url: `uploads/documentos-inmueble/${archivo.filename}`,
        },
      });
    } catch (error) {
      await this.eliminarArchivo(archivo.path);
      throw error;
    }
  }

  async listarDocumentos(
    inmuebleId: string,
    arrendadorId: string,
    tipo?: TipoDocumentoInmueble,
  ): Promise<Prisma.DocumentoInmuebleGetPayload<{}>[] | null> {
    const inmueble = await this.prisma.inmueble.findFirst({
      where: { id: inmuebleId, arrendador_id: arrendadorId },
    });
    if (!inmueble) {
      return null;
    }
    return this.prisma.documentoInmueble.findMany({
      where: {
        inmueble_id: inmuebleId,
        ...(tipo ? { tipo } : {}),
      },
      orderBy: { creado_en: 'desc' },
    });
  }

  private async eliminarArchivo(rutaAbsoluta: string): Promise<void> {
    try {
      await unlink(rutaAbsoluta);
    } catch {
      // La limpieza no debe ocultar el error original.
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
    const archivosSaltados: string[] = [];

    const agregarArchivo = (
      rutaRelativa: string | null | undefined,
      carpeta: string,
    ) => {
      if (!rutaRelativa) {
        return;
      }
      const rutaAbsoluta = join(process.cwd(), rutaRelativa);
      if (!existsSync(rutaAbsoluta)) {
        archivosSaltados.push(rutaRelativa);
        return;
      }
      archivo.file(rutaAbsoluta, {
        name: `${carpeta}/${basename(rutaRelativa)}`,
      });
    };

    for (const documento of inmueble.documentos) {
      agregarArchivo(documento.archivo_url, 'documentos-inmueble');
    }
    for (const unidad of inmueble.unidades) {
      for (const contrato of unidad.contratos) {
        agregarArchivo(contrato.pdf_contrato_url, 'contratos');
        for (const pago of contrato.pagos) {
          agregarArchivo(pago.comprobante_url, 'comprobantes');
        }
      }
    }

    if (archivosSaltados.length > 0) {
      this.logger.warn(
        `Archivos referenciados no encontrados en disco para el inmueble ${id}: ${archivosSaltados.join(', ')}`,
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
      include: {
        documentos: true,
        unidades: {
          include: {
            contratos: { include: { pagos: true } },
          },
        },
      },
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
