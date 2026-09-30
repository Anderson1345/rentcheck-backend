import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { firmarTolerante } from '../common/firma-tolerante';
import { Momento } from '@prisma/client';
import { basename, extname } from 'path';
import { AlmacenamientoService } from '../almacenamiento/almacenamiento.service';
import { PrismaService } from '../prisma/prisma.service';
import { CrearFotoInventarioDto } from './dto/crear-foto-inventario.dto';

@Injectable()
export class FotoInventarioService {
  private readonly logger = new Logger(FotoInventarioService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly almacenamiento: AlmacenamientoService,
  ) {}

  async crear(
    contratoId: string,
    arrendadorId: string,
    dto: CrearFotoInventarioDto,
    foto: Express.Multer.File,
  ) {
    const contrato = await this.prisma.contrato.findFirst({
      where: {
        id: contratoId,
        unidad: { inmueble: { arrendador_id: arrendadorId } },
      },
    });
    if (!contrato) {
      throw new NotFoundException(
        'Contrato no encontrado o no pertenece al arrendador autenticado.',
      );
    }

    const rutaDestino = `fotos-inventario/${contratoId}/${Date.now()}-${this.sanitizarNombreArchivo(foto.originalname)}`;

    await this.almacenamiento.subirArchivo(
      foto.buffer,
      rutaDestino,
      foto.mimetype,
    );

    try {
      const fotoInventario = await this.prisma.fotoInventario.create({
        data: {
          contrato_id: contratoId,
          unidad_id: contrato.unidad_id,
          momento: dto.momento,
          zona: dto.zona,
          foto_ruta: rutaDestino,
        },
      });

      return this.exponerUrlFirmada(fotoInventario);
    } catch (error) {
      await this.eliminarArchivoHuérfano(rutaDestino);
      throw error;
    }
  }

  async listar(contratoId: string, arrendadorId: string, momento?: Momento) {
    const contrato = await this.prisma.contrato.findFirst({
      where: {
        id: contratoId,
        unidad: { inmueble: { arrendador_id: arrendadorId } },
      },
    });
    if (!contrato) {
      throw new NotFoundException(
        'Contrato no encontrado o no pertenece al arrendador autenticado.',
      );
    }

    const fotos = await this.prisma.fotoInventario.findMany({
      where: {
        contrato_id: contratoId,
        ...(momento ? { momento } : {}),
      },
      orderBy: [{ momento: 'asc' }, { zona: 'asc' }, { creado_en: 'asc' }],
    });

    return Promise.all(fotos.map((f) => this.exponerUrlFirmada(f)));
  }

  private async exponerUrlFirmada<
    T extends { id: string; foto_ruta: string | null },
  >(foto: T): Promise<Omit<T, 'foto_ruta'> & { foto_url: string | null }> {
    const { foto_ruta, ...resto } = foto;
    return {
      ...resto,
      foto_url: await firmarTolerante(
        this.almacenamiento,
        foto_ruta,
        this.logger,
        `la foto de inventario ${foto.id}`,
      ),
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
