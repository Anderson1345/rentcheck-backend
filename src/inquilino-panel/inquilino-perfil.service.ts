import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AlmacenamientoService } from '../almacenamiento/almacenamiento.service';
import { firmarFotoOpcional, reemplazarFoto } from '../common/foto-perfil';
import { PrismaService } from '../prisma/prisma.service';

const CAMPOS_PERFIL_INQUILINO = {
  id: true,
  nombre: true,
  cedula: true,
  telefono: true,
  correo: true,
  foto_cedula_url: true,
} as const;

/** Perfil de la propia persona (no la copia que ve el arrendador). */
@Injectable()
export class InquilinoPerfilService {
  private readonly logger = new Logger(InquilinoPerfilService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly almacenamiento: AlmacenamientoService,
  ) {}

  async verPerfil(inquilinoId: string) {
    const perfil = await this.prisma.inquilino.findUnique({
      where: { id: inquilinoId },
      select: CAMPOS_PERFIL_INQUILINO,
    });
    if (!perfil) {
      throw new NotFoundException('Inquilino no encontrado.');
    }
    return {
      ...perfil,
      // Nunca la ruta interna: URL firmada (null si no hay foto o falla la firma).
      foto_cedula_url: await firmarFotoOpcional(
        this.almacenamiento,
        perfil.foto_cedula_url,
        this.logger,
      ),
    };
  }

  /** Sube o reemplaza la foto de la cédula (patrón de la portada del inmueble). */
  async subirFotoCedula(inquilinoId: string, foto: Express.Multer.File) {
    const actual = await this.prisma.inquilino.findUnique({
      where: { id: inquilinoId },
      select: { foto_cedula_url: true },
    });
    if (!actual) {
      throw new NotFoundException('Inquilino no encontrado.');
    }

    const guardada = await reemplazarFoto({
      almacenamiento: this.almacenamiento,
      logger: this.logger,
      foto,
      prefijo: `inquilinos/${inquilinoId}/`,
      nombre: 'cedula',
      rutaAnterior: actual.foto_cedula_url,
      guardar: async (rutaNueva) =>
        (
          await this.prisma.inquilino.updateMany({
            where: { id: inquilinoId },
            data: { foto_cedula_url: rutaNueva },
          })
        ).count > 0
          ? true
          : null,
    });
    if (!guardada) {
      throw new NotFoundException('Inquilino no encontrado.');
    }
    return this.verPerfil(inquilinoId);
  }
}
