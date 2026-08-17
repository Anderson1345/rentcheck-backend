import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EstadoContrato,
  EstadoPago,
  EstadoPagoContrato,
  Prisma,
} from '@prisma/client';
import { unlink } from 'fs/promises';
import { PrismaService } from '../prisma/prisma.service';
import { calcularCicloPagoActual } from '../common/ciclo-pago.util';
import { CrearPagoDto } from './dto/crear-pago.dto';

@Injectable()
export class PagoService {
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

  constructor(private readonly prisma: PrismaService) {}

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
      await this.eliminarComprobante(comprobante.path);
      throw new NotFoundException(
        'Contrato no encontrado o no pertenece al inquilino autenticado.',
      );
    }

    if (contrato.estado !== EstadoContrato.ACTIVO) {
      await this.eliminarComprobante(comprobante.path);
      throw new ConflictException(
        'No puedes reportar pagos, tu contrato ya no está activo.',
      );
    }

    const arrendadorId = contrato.unidad.inmueble.arrendador_id;

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
        comprobante_url: `uploads/comprobantes/${comprobante.filename}`,
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

        return nuevoPago;
      }

      return await this.prisma.pago.create({ data: datosNuevoPago });
    } catch (error) {
      await this.eliminarComprobante(comprobante.path);
      throw error;
    }
  }

  async listar(arrendadorId: string, estado?: EstadoPago) {
    return this.prisma.pago.findMany({
      where: {
        arrendador_id: arrendadorId,
        ...(estado ? { estado } : {}),
      },
      include: this.INCLUDE_PAGO,
      orderBy: { fecha_reportada: 'desc' },
    });
  }

  async listarMios(inquilinoId: string) {
    return this.prisma.pago.findMany({
      where: {
        contrato: { inquilino_id: inquilinoId },
      },
      include: this.INCLUDE_PAGO,
      orderBy: { fecha_reportada: 'desc' },
    });
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

    return pago;
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

    return pagoActualizado;
  }

  async rechazar(id: string, arrendadorId: string) {
    const pago = await this.obtenerPagoPendiente(id, arrendadorId);

    return this.prisma.pago.update({
      where: { id: pago.id },
      data: { estado: EstadoPago.RECHAZADO },
      include: this.INCLUDE_PAGO,
    });
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

  private async eliminarComprobante(rutaAbsoluta: string): Promise<void> {
    try {
      await unlink(rutaAbsoluta);
    } catch {
      // La limpieza no debe ocultar el error original.
    }
  }
}
