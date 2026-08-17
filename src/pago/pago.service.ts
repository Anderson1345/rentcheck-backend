import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  EstadoContrato,
  EstadoPago,
  EstadoPagoContrato,
  Prisma,
} from '@prisma/client';
import { basename, extname } from 'path';
import { AlmacenamientoService } from '../almacenamiento/almacenamiento.service';
import { PrismaService } from '../prisma/prisma.service';
import { calcularCicloPagoActual } from '../common/ciclo-pago.util';
import { CrearPagoDto } from './dto/crear-pago.dto';

@Injectable()
export class PagoService {
  private readonly logger = new Logger(PagoService.name);
  private readonly INCLUDE_PAGO: Prisma.PagoInclude = {
    contrato: {
      select: {
        id: true,
        tipo_plantilla: true,
        canon_centavos: true,
        dia_pago: true,
        forma_pago: true,
        deposito_centavos: true,
        fecha_inicio: true,
        fecha_fin: true,
        estado: true,
        unidad: {
          include: {
            inmueble: {
              select: { id: true, direccion: true, ciudad: true },
            },
          },
        },
        inquilino: {
          select: { id: true, nombre: true, cedula: true, telefono: true },
        },
      },
    },
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly almacenamiento: AlmacenamientoService,
  ) {}

  async crear(
    dto: CrearPagoDto,
    inquilinoId: string,
    comprobante: Express.Multer.File,
  ) {
    const contrato = await this.prisma.contrato.findFirst({
      where: {
        id: dto.contratoId,
        inquilino_id: inquilinoId,
      },
      include: {
        unidad: { include: { inmueble: true } },
      },
    });

    if (!contrato) {
      throw new NotFoundException(
        'Contrato no encontrado o no pertenece al inquilino autenticado.',
      );
    }

    if (contrato.estado !== EstadoContrato.ACTIVO) {
      throw new ConflictException(
        'No puedes reportar pagos, tu contrato ya no está activo.',
      );
    }

    const arrendadorId = contrato.unidad.inmueble.arrendador_id;
    const rutaDestino = `pagos/${contrato.id}/${Date.now()}-${this.sanitizarNombreArchivo(comprobante.originalname)}`;

    await this.almacenamiento.subirArchivo(
      comprobante.buffer,
      rutaDestino,
      comprobante.mimetype,
    );

    try {
      const cicloActual = calcularCicloPagoActual(contrato.dia_pago);

      const pagoPendienteDelCiclo = await this.prisma.pago.findFirst({
        where: {
          contrato_id: contrato.id,
          estado: EstadoPago.PENDIENTE,
          fecha_reportada: { gte: cicloActual },
        },
      });

      const datosNuevoPago: Prisma.PagoUncheckedCreateInput = {
        arrendador_id: arrendadorId,
        contrato_id: contrato.id,
        monto_centavos: dto.monto_centavos,
        fecha_reportada: dto.fecha_reportada,
        comprobante_ruta: rutaDestino,
        estado: EstadoPago.PENDIENTE,
      };

      if (pagoPendienteDelCiclo) {
        const [, nuevoPago] = await this.prisma.$transaction([
          this.prisma.pago.update({
            where: { id: pagoPendienteDelCiclo.id },
            data: { estado: EstadoPago.REEMPLAZADO },
          }),
          this.prisma.pago.create({ data: datosNuevoPago }),
        ]);

        return this.exponerUrlFirmada(nuevoPago);
      }

      const nuevoPago = await this.prisma.pago.create({
        data: datosNuevoPago,
      });
      return this.exponerUrlFirmada(nuevoPago);
    } catch (error) {
      await this.eliminarArchivoHuérfano(rutaDestino);
      throw error;
    }
  }

  async listar(arrendadorId: string, estado?: EstadoPago) {
    const pagos = await this.prisma.pago.findMany({
      where: {
        arrendador_id: arrendadorId,
        ...(estado ? { estado } : {}),
      },
      include: this.INCLUDE_PAGO,
      orderBy: { fecha_reportada: 'desc' },
    });

    return Promise.all(pagos.map((p) => this.exponerUrlFirmada(p)));
  }

  async listarMios(inquilinoId: string) {
    const pagos = await this.prisma.pago.findMany({
      where: {
        contrato: { inquilino_id: inquilinoId },
      },
      include: this.INCLUDE_PAGO,
      orderBy: { fecha_reportada: 'desc' },
    });

    return Promise.all(pagos.map((p) => this.exponerUrlFirmada(p)));
  }

  async encontrarUno(id: string, arrendadorId: string) {
    const pago = await this.prisma.pago.findFirst({
      where: { id, arrendador_id: arrendadorId },
      include: this.INCLUDE_PAGO,
    });

    if (!pago) {
      throw new NotFoundException(
        'Pago no encontrado o no pertenece al arrendador autenticado.',
      );
    }

    return this.exponerUrlFirmada(pago);
  }

  async aprobar(id: string, arrendadorId: string) {
    const pago = await this.obtenerPagoPendiente(id, arrendadorId);

    const [pagoActualizado] = await this.prisma.$transaction([
      this.prisma.pago.update({
        where: { id: pago.id },
        data: { estado: EstadoPago.APROBADO },
        include: this.INCLUDE_PAGO,
      }),
      this.prisma.contrato.update({
        where: { id: pago.contrato_id },
        data: { estado_pago: EstadoPagoContrato.AL_DIA },
      }),
    ]);

    return this.exponerUrlFirmada(pagoActualizado);
  }

  async rechazar(id: string, arrendadorId: string) {
    const pago = await this.obtenerPagoPendiente(id, arrendadorId);

    const pagoActualizado = await this.prisma.pago.update({
      where: { id: pago.id },
      data: { estado: EstadoPago.RECHAZADO },
      include: this.INCLUDE_PAGO,
    });

    return this.exponerUrlFirmada(pagoActualizado);
  }

  private async obtenerPagoPendiente(id: string, arrendadorId: string) {
    const pago = await this.prisma.pago.findFirst({
      where: { id, arrendador_id: arrendadorId },
    });

    if (!pago) {
      throw new NotFoundException(
        'Pago no encontrado o no pertenece al arrendador autenticado.',
      );
    }

    if (pago.estado !== EstadoPago.PENDIENTE) {
      throw new ConflictException(
        'El pago ya fue procesado y no puede aprobarse ni rechazarse nuevamente.',
      );
    }

    return pago;
  }

  private async exponerUrlFirmada<T extends { comprobante_ruta: string }>(
    pago: T,
  ): Promise<Omit<T, 'comprobante_ruta'> & { comprobante_url: string }> {
    const { comprobante_ruta, ...resto } = pago;
    return {
      ...resto,
      comprobante_url:
        await this.almacenamiento.generarUrlFirmada(comprobante_ruta),
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
