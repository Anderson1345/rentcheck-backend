import { Injectable, NotFoundException } from '@nestjs/common';
import { Momento } from '@prisma/client';
import { unlink } from 'fs/promises';
import { PrismaService } from '../prisma/prisma.service';
import { CrearFotoInventarioDto } from './dto/crear-foto-inventario.dto';

@Injectable()
export class FotoInventarioService {
  constructor(private readonly prisma: PrismaService) {}

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
      await this.eliminarFoto(foto.path);
      throw new NotFoundException(
        'Contrato no encontrado o no pertenece al arrendador autenticado.',
      );
    }

    try {
      return await this.prisma.fotoInventario.create({
        data: {
          contrato_id: contratoId,
          unidad_id: contrato.unidad_id,
          momento: dto.momento,
          zona: dto.zona,
          foto_url: `uploads/fotos-inventario/${foto.filename}`,
        },
      });
    } catch (error) {
      await this.eliminarFoto(foto.path);
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

    return this.prisma.fotoInventario.findMany({
      where: {
        contrato_id: contratoId,
        ...(momento ? { momento } : {}),
      },
      orderBy: [{ momento: 'asc' }, { zona: 'asc' }, { creado_en: 'asc' }],
    });
  }

  private async eliminarFoto(rutaAbsoluta: string): Promise<void> {
    try {
      await unlink(rutaAbsoluta);
    } catch {
      // La limpieza no debe ocultar el error original.
    }
  }
}
