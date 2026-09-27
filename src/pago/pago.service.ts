import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EstadoContrato, EstadoPago, Prisma } from '@prisma/client';
import { basename, extname } from 'path';
import { AlmacenamientoService } from '../almacenamiento/almacenamiento.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  calcularEstadoCuenta,
  derivarEstadoPagoContrato,
  PeriodoEstadoCuenta,
} from '../common/estado-cuenta.util';
import { hoyEnBogota } from '../common/hoy-bogota.util';
import { CrearPagoDto } from './dto/crear-pago.dto';

const SELECT_PARA_ESTADO_CUENTA = {
  fecha_inicio: true,
  fecha_fin: true,
  dia_pago: true,
  canon_centavos: true,
  estado_pago: true,
  incrementos_ipc: {
    select: { fecha_aplicacion: true, canon_nuevo_centavos: true },
  },
  pagos: { select: { periodo: true, estado: true, monto_centavos: true } },
} as const satisfies Prisma.ContratoSelect;

function mismoMesUTC(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth()
  );
}

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
        unidad: { select: { inmueble: { select: { arrendador_id: true } } } },
        incrementos_ipc: {
          select: { fecha_aplicacion: true, canon_nuevo_centavos: true },
        },
        pagos: {
          select: { periodo: true, estado: true, monto_centavos: true },
        },
      },
    });

    if (!contrato) {
      throw new NotFoundException(
        'Contrato no encontrado o no pertenece al inquilino autenticado.',
      );
    }

    // B-39: no se puede reportar un pago anterior al inicio del contrato.
    if (dto.fecha_reportada.getTime() < contrato.fecha_inicio.getTime()) {
      throw new BadRequestException({
        codigo: 'FECHA_REPORTADA_ANTERIOR_A_INICIO',
        mensaje:
          'La fecha reportada no puede ser anterior a la fecha de inicio del contrato.',
      });
    }

    const periodos = calcularEstadoCuenta(
      {
        fecha_inicio: contrato.fecha_inicio,
        fecha_fin: contrato.fecha_fin,
        dia_pago: contrato.dia_pago,
        canon_centavos: contrato.canon_centavos,
      },
      contrato.incrementos_ipc,
      contrato.pagos,
      hoyEnBogota(),
    );

    let periodoEncontrado: PeriodoEstadoCuenta | undefined;

    if (dto.periodo) {
      const periodoSolicitado = dto.periodo;
      periodoEncontrado = periodos.find((periodo) =>
        mismoMesUTC(periodo.periodo, periodoSolicitado),
      );
      if (!periodoEncontrado) {
        throw new BadRequestException({
          codigo: 'PERIODO_INVALIDO',
          mensaje:
            'El período indicado no corresponde a ningún período del contrato.',
        });
      }
      if (periodoEncontrado.estado === 'PAGADO') {
        throw new ConflictException({
          codigo: 'PERIODO_YA_PAGADO',
          mensaje: 'El período indicado ya está pagado.',
        });
      }
    } else {
      periodoEncontrado = periodos.find(
        (periodo) => periodo.estado !== 'PAGADO',
      );
      if (!periodoEncontrado) {
        throw new ConflictException({
          codigo: 'SIN_PERIODOS_PENDIENTES',
          mensaje: 'No hay períodos pendientes de pago para este contrato.',
        });
      }
    }

    // B-38: con el contrato ya no activo, solo se permite reportar un
    // período explícito que haya quedado VENCIDO o PARCIAL al cierre.
    if (contrato.estado !== EstadoContrato.ACTIVO) {
      const permitidoPorCierre =
        dto.periodo !== undefined &&
        (periodoEncontrado.estado === 'VENCIDO' ||
          periodoEncontrado.estado === 'PARCIAL');
      if (!permitidoPorCierre) {
        throw new ConflictException({
          codigo: 'CONTRATO_NO_ACTIVO',
          mensaje: 'No puedes reportar pagos, tu contrato ya no está activo.',
        });
      }
    }

    const periodoElegido = periodoEncontrado.periodo;
    const arrendadorId = contrato.unidad.inmueble.arrendador_id;
    const rutaDestino = `pagos/${contrato.id}/${Date.now()}-${this.sanitizarNombreArchivo(comprobante.originalname)}`;

    await this.almacenamiento.subirArchivo(
      comprobante.buffer,
      rutaDestino,
      comprobante.mimetype,
    );

    try {
      const nuevoPago = await this.prisma.$transaction(async (tx) => {
        const pagoPendienteDelPeriodo = await tx.pago.findFirst({
          where: {
            contrato_id: contrato.id,
            estado: EstadoPago.PENDIENTE,
            periodo: periodoElegido,
          },
        });

        const datosNuevoPago: Prisma.PagoUncheckedCreateInput = {
          arrendador_id: arrendadorId,
          contrato_id: contrato.id,
          monto_centavos: dto.monto_centavos,
          fecha_reportada: dto.fecha_reportada,
          periodo: periodoElegido,
          comprobante_ruta: rutaDestino,
          estado: EstadoPago.PENDIENTE,
        };

        if (pagoPendienteDelPeriodo) {
          await tx.pago.update({
            where: { id: pagoPendienteDelPeriodo.id },
            data: { estado: EstadoPago.REEMPLAZADO },
          });
        }

        const creado = await tx.pago.create({ data: datosNuevoPago });

        await this.recalcularEstadoPagoContrato(tx, contrato.id);

        return creado;
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
    const pagoActualizado = await this.ejecutarTransicionPago(
      id,
      arrendadorId,
      EstadoPago.APROBADO,
    );
    return this.exponerUrlFirmada(pagoActualizado);
  }

  async rechazar(id: string, arrendadorId: string) {
    const pagoActualizado = await this.ejecutarTransicionPago(
      id,
      arrendadorId,
      EstadoPago.RECHAZADO,
    );
    return this.exponerUrlFirmada(pagoActualizado);
  }

  private async ejecutarTransicionPago(
    id: string,
    arrendadorId: string,
    nuevoEstado: Extract<EstadoPago, 'APROBADO' | 'RECHAZADO'>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const pagoExistente = await tx.pago.findFirst({
        where: { id, arrendador_id: arrendadorId },
        select: { contrato_id: true },
      });

      if (!pagoExistente) {
        throw new NotFoundException(
          'Pago no encontrado o no pertenece al arrendador autenticado.',
        );
      }

      const resultado = await tx.pago.updateMany({
        where: {
          id,
          arrendador_id: arrendadorId,
          estado: EstadoPago.PENDIENTE,
        },
        data: { estado: nuevoEstado },
      });

      if (resultado.count === 0) {
        throw new ConflictException({
          codigo: 'PAGO_YA_PROCESADO',
          mensaje:
            'El pago ya fue procesado y no puede aprobarse ni rechazarse nuevamente.',
        });
      }

      await this.recalcularEstadoPagoContrato(tx, pagoExistente.contrato_id);

      return tx.pago.findUniqueOrThrow({
        where: { id },
        include: this.INCLUDE_PAGO,
      });
    });
  }

  /**
   * Recalcula `estado_pago` del contrato con `calcularEstadoCuenta` +
   * `derivarEstadoPagoContrato`, usando los pagos ya actualizados dentro de
   * la transacción. Nunca lo fija a mano.
   */
  private async recalcularEstadoPagoContrato(
    tx: Prisma.TransactionClient,
    contratoId: string,
  ): Promise<void> {
    const contrato = await tx.contrato.findUniqueOrThrow({
      where: { id: contratoId },
      select: SELECT_PARA_ESTADO_CUENTA,
    });

    const periodos = calcularEstadoCuenta(
      {
        fecha_inicio: contrato.fecha_inicio,
        fecha_fin: contrato.fecha_fin,
        dia_pago: contrato.dia_pago,
        canon_centavos: contrato.canon_centavos,
      },
      contrato.incrementos_ipc,
      contrato.pagos,
      hoyEnBogota(),
    );

    const nuevoEstadoPago = derivarEstadoPagoContrato(periodos);

    if (nuevoEstadoPago !== contrato.estado_pago) {
      await tx.contrato.update({
        where: { id: contratoId },
        data: { estado_pago: nuevoEstadoPago },
      });
    }
  }

  private async exponerUrlFirmada<
    T extends { comprobante_ruta: string | null },
  >(
    pago: T,
  ): Promise<Omit<T, 'comprobante_ruta'> & { comprobante_url: string | null }> {
    const { comprobante_ruta, ...resto } = pago;
    if (!comprobante_ruta) {
      return { ...resto, comprobante_url: null };
    }
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
