import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { firmarTolerante } from '../common/firma-tolerante';
import {
  EstadoContrato,
  EstadoPago,
  MotivoRechazoPago,
  Prisma,
} from '@prisma/client';
import { basename, extname } from 'path';
import { AlmacenamientoService } from '../almacenamiento/almacenamiento.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  calcularEstadoCuenta,
  PeriodoEstadoCuenta,
} from '../common/estado-cuenta.util';
import { conFotoDeUnidadAnidada } from '../common/foto-perfil';
import { contratoVinculadoDelInquilino } from '../common/contrato-vinculado-inquilino';
import { hoyEnBogota } from '../common/hoy-bogota.util';
import {
  conInquilinoDeLaCopia,
  CopiaInquilino,
  SELECT_COPIA_INQUILINO,
} from '../common/inquilino-copia';
import { fechaFinParaEstadoCuenta } from '../common/terminacion.util';
import {
  periodosPorContrato,
  recalcularEstadoPagoContrato,
} from '../common/recalcular-estado-pago';
import {
  extensionDeComprobante,
  tipoDeComprobante,
} from '../common/comprobante-tipo.util';
import { calcularHuellaPago } from '../common/huella-idempotencia.util';
import {
  IdempotenciaService,
  ParametrosClave,
} from '../idempotencia/idempotencia.service';
import { CrearPagoDto } from './dto/crear-pago.dto';
import { PeriodoCuentaPago, periodoCuentaDelPago } from './periodo-cuenta.util';
import {
  RechazarPagoDto,
  validarReglasMotivoRechazo,
} from './dto/rechazar-pago.dto';

function mismoMesUTC(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth()
  );
}

@Injectable()
export class PagoService {
  private readonly logger = new Logger(PagoService.name);
  private readonly INCLUDE_PAGO = {
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
        // Nombre, cédula y teléfono del inquilino: la copia del contrato.
        ...SELECT_COPIA_INQUILINO,
      },
    },
  } as const satisfies Prisma.PagoInclude;

  /** Arma `contrato.inquilino` con la copia del contrato (sin `inquilino_id` suelto). */
  private conInquilinoDeLaCopia<T extends { contrato: CopiaInquilino }>(
    pago: T,
  ) {
    const { inquilino_id, ...contrato } = conInquilinoDeLaCopia(pago.contrato);
    void inquilino_id;
    return { ...pago, contrato };
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly almacenamiento: AlmacenamientoService,
    private readonly idempotencia: IdempotenciaService,
  ) {}

  async crear(
    dto: CrearPagoDto,
    inquilinoId: string,
    comprobante: Express.Multer.File,
    claveIdempotencia?: string,
  ) {
    let parametrosClave: ParametrosClave | undefined;
    if (claveIdempotencia) {
      parametrosClave = {
        inquilinoId,
        endpoint: 'POST /pagos',
        clave: claveIdempotencia,
        huella: calcularHuellaPago({
          contratoId: dto.contratoId,
          monto_centavos: dto.monto_centavos,
          fecha_reportada: dto.fecha_reportada,
          periodo: dto.periodo,
          comprobante: comprobante.buffer,
        }),
      };
      const recursoId =
        await this.idempotencia.buscarRecursoExistente(parametrosClave);
      if (recursoId) {
        return this.reproducirPago(recursoId);
      }
    }

    const contrato = await this.prisma.contrato.findFirst({
      where: {
        id: dto.contratoId,
        inquilino_id: inquilinoId,
        // Un contrato sin vincular no existe para el portal del inquilino.
        vinculado_en: { not: null },
      },
      include: {
        unidad: { select: { inmueble: { select: { arrendador_id: true } } } },
        incrementos_ipc: {
          select: {
            fecha_aplicacion: true,
            canon_anterior_centavos: true,
            canon_nuevo_centavos: true,
          },
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

    // Un contrato PROGRAMADO (aún no empieza) o CANCELADO no admite pagos.
    if (
      contrato.estado === EstadoContrato.PROGRAMADO ||
      contrato.estado === EstadoContrato.CANCELADO
    ) {
      throw new ConflictException({
        codigo: 'CONTRATO_NO_ACTIVO',
        mensaje:
          contrato.estado === EstadoContrato.PROGRAMADO
            ? `Tu contrato aún no está activo (empieza el ${contrato.fecha_inicio.toISOString().slice(0, 10)}); todavía no puedes reportar pagos.`
            : 'Este contrato fue cancelado; no puedes reportar pagos.',
      });
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
        fecha_fin: fechaFinParaEstadoCuenta(contrato),
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

    let reclamoId: string | undefined;
    if (parametrosClave) {
      const reclamo = await this.idempotencia.reclamar(parametrosClave);
      if ('recursoId' in reclamo) {
        return this.reproducirPago(reclamo.recursoId);
      }
      reclamoId = reclamo.reclamoId;
    }

    const rutaDestino = `pagos/${contrato.id}/${Date.now()}-${this.nombreDeComprobante(comprobante.originalname, comprobante.mimetype)}`;
    let archivoSubido = false;
    let nuevoPago: Awaited<ReturnType<PagoService['crearRegistroPago']>>;

    try {
      await this.almacenamiento.subirArchivo(
        comprobante.buffer,
        rutaDestino,
        comprobante.mimetype,
      );
      archivoSubido = true;

      nuevoPago = await this.crearRegistroPago({
        dto,
        contratoId: contrato.id,
        arrendadorId,
        periodoElegido,
        rutaDestino,
        reclamoId,
      });
    } catch (error) {
      if (reclamoId) {
        await this.idempotencia.liberarReclamo(reclamoId);
      }
      if (archivoSubido) {
        await this.eliminarArchivoHuérfano(rutaDestino);
      }
      throw error;
    }

    // Los períodos salen del recálculo de la propia transacción: ya incluyen el pago nuevo.
    return {
      pago: await this.exponerUrlFirmada({
        ...nuevoPago.pago,
        periodo_cuenta: periodoCuentaDelPago(
          nuevoPago.periodos,
          nuevoPago.pago.periodo,
        ),
      }),
      reproducido: false,
    };
  }

  private crearRegistroPago(datos: {
    dto: CrearPagoDto;
    contratoId: string;
    arrendadorId: string;
    periodoElegido: Date;
    rutaDestino: string;
    reclamoId?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const pagoPendienteDelPeriodo = await tx.pago.findFirst({
        where: {
          contrato_id: datos.contratoId,
          estado: EstadoPago.PENDIENTE,
          periodo: datos.periodoElegido,
        },
      });

      const datosNuevoPago: Prisma.PagoUncheckedCreateInput = {
        arrendador_id: datos.arrendadorId,
        contrato_id: datos.contratoId,
        monto_centavos: datos.dto.monto_centavos,
        fecha_reportada: datos.dto.fecha_reportada,
        periodo: datos.periodoElegido,
        comprobante_ruta: datos.rutaDestino,
        estado: EstadoPago.PENDIENTE,
      };

      if (pagoPendienteDelPeriodo) {
        await tx.pago.update({
          where: { id: pagoPendienteDelPeriodo.id },
          data: { estado: EstadoPago.REEMPLAZADO },
        });
      }

      const creado = await tx.pago.create({ data: datosNuevoPago });

      if (datos.reclamoId) {
        await this.idempotencia.asociarRecurso(tx, datos.reclamoId, creado.id);
      }

      const { periodos } = await recalcularEstadoPagoContrato(
        tx,
        datos.contratoId,
      );

      return { pago: creado, periodos };
    });
  }

  private async reproducirPago(pagoId: string) {
    const pago = await this.prisma.pago.findUniqueOrThrow({
      where: { id: pagoId },
    });
    const [conPeriodo] = await this.conPeriodoCuenta([pago]);
    return {
      pago: await this.exponerUrlFirmada(conPeriodo),
      reproducido: true,
    };
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

    return this.responder(pagos);
  }

  /** Con `contratoId`, solo los pagos de ese contrato (debe ser suyo, vinculado y no cancelado). */
  async listarMios(inquilinoId: string, contratoId?: string) {
    if (contratoId) {
      await contratoVinculadoDelInquilino(
        this.prisma,
        inquilinoId,
        contratoId,
        {
          id: true,
        },
      );
    }
    const pagos = await this.prisma.pago.findMany({
      where: {
        contrato: { inquilino_id: inquilinoId, vinculado_en: { not: null } },
        ...(contratoId ? { contrato_id: contratoId } : {}),
      },
      include: this.INCLUDE_PAGO,
      orderBy: { fecha_reportada: 'desc' },
    });

    return this.responder(pagos);
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

    const [respuesta] = await this.responder([pago]);
    return respuesta;
  }

  async aprobar(id: string, arrendadorId: string) {
    const transicion = await this.ejecutarTransicionPago(
      id,
      arrendadorId,
      EstadoPago.APROBADO,
    );
    return this.responderTransicion(transicion);
  }

  /**
   * Rechaza un pago PENDIENTE. El motivo y el mensaje (opcionales) se escriben en el MISMO
   * `updateMany` condicionado a PENDIENTE: nunca se lee y luego se escribe, así dos rechazos
   * simultáneos dejan un solo ganador con su propio motivo.
   */
  async rechazar(id: string, arrendadorId: string, dto: RechazarPagoDto) {
    // Reglas entre campos: antes de tocar la base, para no escribir nada si fallan.
    validarReglasMotivoRechazo(dto);
    const transicion = await this.ejecutarTransicionPago(
      id,
      arrendadorId,
      EstadoPago.RECHAZADO,
      { motivo: dto.motivo ?? null, mensaje: dto.mensaje ?? null },
    );
    return this.responderTransicion(transicion);
  }

  private async ejecutarTransicionPago(
    id: string,
    arrendadorId: string,
    nuevoEstado: Extract<EstadoPago, 'APROBADO' | 'RECHAZADO'>,
    rechazo?: { motivo: MotivoRechazoPago | null; mensaje: string | null },
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
        data: {
          estado: nuevoEstado,
          // Solo el rechazo escribe el motivo; aprobar nunca toca estos campos.
          ...(rechazo
            ? {
                motivo_rechazo: rechazo.motivo,
                mensaje_rechazo: rechazo.mensaje,
              }
            : {}),
        },
      });

      if (resultado.count === 0) {
        throw new ConflictException({
          codigo: 'PAGO_YA_PROCESADO',
          mensaje:
            'El pago ya fue procesado y no puede aprobarse ni rechazarse nuevamente.',
        });
      }

      // El recálculo ya devuelve los períodos con el pago actualizado: de ahí sale `periodo_cuenta`
      // (mismo cálculo, sin otra lectura y sin alargar la transacción).
      const { periodos } = await recalcularEstadoPagoContrato(
        tx,
        pagoExistente.contrato_id,
      );

      const pago = await tx.pago.findUniqueOrThrow({
        where: { id },
        include: this.INCLUDE_PAGO,
      });
      return { pago, periodos };
    });
  }

  private async exponerUrlFirmada<
    T extends { id: string; comprobante_ruta: string | null },
  >(
    pago: T,
  ): Promise<
    Omit<T, 'comprobante_ruta'> & {
      comprobante_url: string | null;
      comprobante_tipo: 'IMAGEN' | 'PDF' | null;
    }
  > {
    const { comprobante_ruta, ...sinRuta } = pago;
    // La unidad del contrato trae `foto_principal_url`: siempre firmada, nunca la ruta.
    const contrato = (sinRuta as { contrato?: object }).contrato;
    const resto = contrato
      ? {
          ...sinRuta,
          contrato: await conFotoDeUnidadAnidada(
            contrato,
            this.almacenamiento,
            this.logger,
          ),
        }
      : sinRuta;
    return {
      ...resto,
      comprobante_tipo: tipoDeComprobante(comprobante_ruta),
      comprobante_url: await firmarTolerante(
        this.almacenamiento,
        comprobante_ruta,
        this.logger,
        `el comprobante del pago ${pago.id}`,
      ),
    };
  }

  /**
   * Nombre del archivo guardado: el nombre base del cliente, saneado, y una extensión que sale del
   * mimetype ya validado por el contenido real (el validador de B0.5-C comprueba los bytes antes de
   * llegar aquí), nunca de la extensión que mande el cliente.
   */
  private nombreDeComprobante(nombre: string, mimetype: string): string {
    const base = basename(nombre, extname(nombre));
    const baseLimpia = base.replace(/[^a-zA-Z0-9_-]/g, '_');
    return `${baseLimpia}${extensionDeComprobante(mimetype) ?? ''}`;
  }

  /**
   * Agrega `periodo_cuenta` a cada pago con UNA lectura para todos (contratos, sus incrementos y sus
   * pagos, por lote): el costo no crece con el número de pagos, solo con el de contratos distintos.
   */
  private async conPeriodoCuenta<
    T extends { contrato_id: string; periodo: Date },
  >(pagos: T[]): Promise<(T & { periodo_cuenta: PeriodoCuentaPago | null })[]> {
    const periodos = await periodosPorContrato(
      this.prisma,
      [...new Set(pagos.map((p) => p.contrato_id))],
      hoyEnBogota(),
    );
    return pagos.map((pago) => ({
      ...pago,
      periodo_cuenta: periodoCuentaDelPago(
        periodos.get(pago.contrato_id) ?? [],
        pago.periodo,
      ),
    }));
  }

  /** Forma final de una lista de pagos con INCLUDE_PAGO. */
  private async responder<
    T extends {
      id: string;
      contrato_id: string;
      periodo: Date;
      comprobante_ruta: string | null;
      contrato: CopiaInquilino;
    },
  >(pagos: T[]) {
    const conPeriodo = await this.conPeriodoCuenta(pagos);
    return Promise.all(
      conPeriodo.map((p) =>
        this.exponerUrlFirmada(this.conInquilinoDeLaCopia(p)),
      ),
    );
  }

  private responderTransicion<
    T extends {
      id: string;
      periodo: Date;
      comprobante_ruta: string | null;
      contrato: CopiaInquilino;
    },
  >(transicion: { pago: T; periodos: PeriodoEstadoCuenta[] }) {
    return this.exponerUrlFirmada(
      this.conInquilinoDeLaCopia({
        ...transicion.pago,
        periodo_cuenta: periodoCuentaDelPago(
          transicion.periodos,
          transicion.pago.periodo,
        ),
      }),
    );
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
