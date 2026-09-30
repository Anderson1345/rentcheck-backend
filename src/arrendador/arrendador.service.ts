import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AlmacenamientoService } from '../almacenamiento/almacenamiento.service';
import { firmarFotoOpcional, reemplazarFoto } from '../common/foto-perfil';
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
  private readonly logger = new Logger(ArrendadorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly almacenamiento: AlmacenamientoService,
  ) {}

  /** El perfil nunca expone la ruta interna: `foto_cedula_nit_url` va firmada. */
  private async conFotoFirmada<
    T extends { id: string; foto_cedula_nit_url: string | null },
  >(perfil: T): Promise<T> {
    return {
      ...perfil,
      foto_cedula_nit_url: await firmarFotoOpcional(
        this.almacenamiento,
        perfil.foto_cedula_nit_url,
        `arrendadores/${perfil.id}/`,
        this.logger,
      ),
    };
  }

  async verPerfil(arrendadorId: string) {
    const perfil = await this.prisma.arrendador.findUnique({
      where: { id: arrendadorId },
      select: CAMPOS_PERFIL,
    });
    return perfil ? this.conFotoFirmada(perfil) : null;
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

    return this.conFotoFirmada(arrendador);
  }

  /**
   * Sube o reemplaza la foto de la cédula/NIT del arrendador autenticado (patrón
   * de la portada del inmueble). Responde con el perfil y la foto firmada.
   */
  async subirFotoCedula(arrendadorId: string, foto: Express.Multer.File) {
    const actual = await this.prisma.arrendador.findUnique({
      where: { id: arrendadorId },
      select: { foto_cedula_nit_url: true },
    });
    if (!actual) {
      throw new NotFoundException('Arrendador no encontrado.');
    }

    const guardada = await reemplazarFoto({
      almacenamiento: this.almacenamiento,
      logger: this.logger,
      foto,
      prefijo: `arrendadores/${arrendadorId}/`,
      nombre: 'cedula-nit',
      rutaAnterior: actual.foto_cedula_nit_url,
      guardar: async (rutaNueva) =>
        (
          await this.prisma.arrendador.updateMany({
            where: { id: arrendadorId },
            data: { foto_cedula_nit_url: rutaNueva },
          })
        ).count > 0
          ? true
          : null,
    });
    if (!guardada) {
      throw new NotFoundException('Arrendador no encontrado.');
    }

    const perfil = await this.verPerfil(arrendadorId);
    if (!perfil) {
      throw new NotFoundException('Arrendador no encontrado.');
    }
    return perfil;
  }
}
