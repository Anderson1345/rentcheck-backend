import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  EstadoContrato,
  Prisma,
  RolSolicitante,
  TipoPlantillaContrato,
  TipoProrroga,
} from '@prisma/client';
import { AlmacenamientoService } from '../almacenamiento/almacenamiento.service';
import { PrismaService } from '../prisma/prisma.service';
import { calcularCanonNuevo } from '../common/canon-incremento.util';
import {
  calcularEstadoCuenta,
  construirRespuestaEstadoCuenta,
} from '../common/estado-cuenta.util';
import { sumarDiasUTC, sumarMesesUTC } from '../common/fechas-contrato.util';
import { resumenAvisoNoRenovacion } from '../common/aviso-no-renovacion.util';
import { hoyEnBogota } from '../common/hoy-bogota.util';
import {
  conInquilinoDeLaCopia,
  conInquilinoResumido,
  OMITIR_COPIA_INQUILINO,
} from '../common/inquilino-copia';
import {
  fechaExpiracionCodigo,
  generarCodigoAcceso,
} from '../common/utils/codigo-acceso';
import { normalizarYValidarDatosInquilino } from '../common/utils/normalizar-cedula';
import { buscarTraslape } from '../common/traslape.util';
import { aplicarProrroga, mesesDelTerminoInicial } from './aplicar-prorroga';
import {
  fechaFinParaEstadoCuenta,
  resumenTerminacion,
} from '../common/terminacion.util';
import { recalcularEstadoPagoContrato } from '../common/recalcular-estado-pago';
import { AplicarIncrementoDto } from './dto/aplicar-incremento.dto';
import { CrearContratoDto } from './dto/crear-contrato.dto';
import { ProrrogarContratoDto } from './dto/prorrogar-contrato.dto';
import {
  plantillaEsperadaParaUnidad,
  plantillaValidaParaUnidad,
} from './plantilla-unidad';
import { DocumentoContratoService } from './documento-contrato.service';

const SELECT_CONTRATO_PARA_ESTADO_CUENTA = {
  estado: true,
  terminacionAnticipadaConfirmadaEn: true,
  terminacion_fecha_efectiva: true,
  fecha_inicio: true,
  fecha_fin: true,
  dia_pago: true,
  canon_centavos: true,
  incrementos_ipc: {
    select: {
      fecha_aplicacion: true,
      canon_anterior_centavos: true,
      canon_nuevo_centavos: true,
    },
  },
  pagos: { select: { periodo: true, estado: true, monto_centavos: true } },
} as const satisfies Prisma.ContratoSelect;

const SELECT_INMUEBLE_RESUMEN = {
  id: true,
  direccion: true,
  ciudad: true,
  estrato: true,
  matricula_inmobiliaria: true,
  creado_en: true,
} as const satisfies Prisma.InmuebleSelect;

@Injectable()
export class ContratoService {
  private readonly logger = new Logger(ContratoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly almacenamiento: AlmacenamientoService,
    private readonly documentos: DocumentoContratoService,
  ) {}

  private async exponerUrlFirmada<
    T extends { pdf_contrato_ruta: string | null },
  >(
    contrato: T,
  ): Promise<
    Omit<T, 'pdf_contrato_ruta'> & { pdf_contrato_url: string | null }
  > {
    const { pdf_contrato_ruta, ...resto } = contrato;
    if (!pdf_contrato_ruta) {
      return { ...resto, pdf_contrato_url: null };
    }
    return {
      ...resto,
      pdf_contrato_url:
        await this.almacenamiento.generarUrlFirmada(pdf_contrato_ruta),
    };
  }

  /** `RC-XXXX-XXXX` con `crypto.randomInt` (ver `common/utils/codigo-acceso`). */
  private generarCodigoAcceso(): string {
    return generarCodigoAcceso();
  }

  private esColisionDeCodigoAcceso(error: unknown): boolean {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      return false;
    }

    // Con el adaptador de pg el error no trae `meta.target`: la restricción
    // viene en el mensaje del driver (`meta.driverAdapterError.cause`).
    const target = error.meta?.target;
    const causa = (
      error.meta?.driverAdapterError as
        { cause?: { originalMessage?: unknown } } | undefined
    )?.cause;
    const mensajeDelDriver =
      typeof causa?.originalMessage === 'string' ? causa.originalMessage : '';
    return (
      (Array.isArray(target) && target.includes('codigo')) ||
      (typeof target === 'string' &&
        target.includes('CodigoAcceso_codigo_key')) ||
      mensajeDelDriver.includes('CodigoAcceso_codigo_key')
    );
  }

  async listar(arrendadorId: string) {
    const contratos = await this.prisma.contrato.findMany({
      where: {
        unidad: {
          inmueble: { arrendador_id: arrendadorId },
        },
      },
      include: {
        unidad: {
          select: {
            id: true,
            nombre: true,
            tipo: true,
          },
        },
        codigo_acceso: {
          select: { codigo: true, expira_en: true },
        },
      },
      orderBy: { fecha_inicio: 'desc' },
    });

    return Promise.all(
      contratos.map(async (c) => ({
        ...(await this.exponerUrlFirmada(conInquilinoResumido(c))),
        vinculado: c.vinculado_en !== null,
      })),
    );
  }

  async encontrarUno(id: string, arrendadorId: string) {
    const contrato = await this.prisma.contrato.findFirst({
      where: {
        id,
        unidad: {
          inmueble: { arrendador_id: arrendadorId },
        },
      },
      include: {
        unidad: true,
        incrementos_ipc: true,
        aviso_no_renovacion: true,
        codigo_acceso: {
          select: { codigo: true, expira_en: true },
        },
      },
    });

    if (!contrato) {
      return null;
    }
    return {
      ...(await this.exponerUrlFirmada(conInquilinoDeLaCopia(contrato))),
      vinculado: contrato.vinculado_en !== null,
      aviso_no_renovacion: resumenAvisoNoRenovacion(
        contrato.aviso_no_renovacion,
        contrato,
        RolSolicitante.ARRENDADOR,
      ),
      terminacion_anticipada: resumenTerminacion(
        contrato,
        RolSolicitante.ARRENDADOR,
      ),
    };
  }

  async obtenerEstadoCuenta(id: string, arrendadorId: string) {
    const contrato = await this.prisma.contrato.findFirst({
      where: {
        id,
        unidad: {
          inmueble: { arrendador_id: arrendadorId },
        },
      },
      select: SELECT_CONTRATO_PARA_ESTADO_CUENTA,
    });

    if (!contrato) {
      return null;
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

    return construirRespuestaEstadoCuenta(periodos);
  }

  /**
   * Aplica un incremento de canon (Ley 820, art. 20): solo cada 12 meses, con
   * el IPC del año calendario anterior. No cambia `fecha_fin`. Una vez
   * confirmado, genera el otrosí de incremento (si falla, el incremento queda
   * aplicado y el documento pendiente de regeneración).
   */
  async aplicarIncremento(
    id: string,
    arrendadorId: string,
    dto: AplicarIncrementoDto,
  ) {
    const hoy = hoyEnBogota();

    const resultado = await this.prisma.$transaction(async (tx) => {
      const contrato = await tx.contrato.findFirst({
        where: { id, unidad: { inmueble: { arrendador_id: arrendadorId } } },
        select: {
          id: true,
          estado: true,
          tipo_plantilla: true,
          canon_centavos: true,
          fecha_inicio: true,
          incrementos_ipc: {
            select: { fecha_aplicacion: true },
            orderBy: { fecha_aplicacion: 'desc' },
            take: 1,
          },
        },
      });

      if (!contrato) {
        throw new NotFoundException('Contrato no encontrado.');
      }
      if (contrato.estado !== EstadoContrato.ACTIVO) {
        throw new ConflictException({
          codigo: 'CONTRATO_NO_ACTIVO',
          mensaje: 'El contrato no está activo.',
        });
      }

      const referencia =
        contrato.incrementos_ipc[0]?.fecha_aplicacion ?? contrato.fecha_inicio;
      const puedeDesde = sumarMesesUTC(referencia, 12);
      if (hoy.getTime() < puedeDesde.getTime()) {
        throw new ConflictException({
          codigo: 'INCREMENTO_ANTES_DE_12_MESES',
          mensaje:
            'Solo se puede aplicar un incremento cuando pasaron 12 meses desde el último incremento o desde el inicio del contrato.',
          detalles: {
            puede_aplicarse_desde: puedeDesde.toISOString().slice(0, 10),
          },
        });
      }

      const anioIpc = hoy.getUTCFullYear() - 1;
      const ipc = await tx.configuracionIpc.findUnique({
        where: { anio: anioIpc },
      });
      if (!ipc) {
        throw new ConflictException({
          codigo: 'IPC_NO_CONFIGURADO',
          mensaje: `No hay un IPC configurado para el año ${anioIpc}.`,
          detalles: { anio: anioIpc },
        });
      }

      const ipcPorcentaje = ipc.porcentaje.toNumber();
      const porcentaje = dto.porcentaje ?? ipcPorcentaje;
      if (
        contrato.tipo_plantilla ===
          TipoPlantillaContrato.VIVIENDA_URBANA_LEY_820 &&
        porcentaje > ipcPorcentaje
      ) {
        throw new BadRequestException({
          codigo: 'PORCENTAJE_SUPERIOR_AL_IPC',
          mensaje:
            'En vivienda urbana el incremento no puede superar el IPC del año calendario anterior (Ley 820 de 2003, art. 20).',
          detalles: { ipc_referencia_porcentaje: ipcPorcentaje },
        });
      }

      const canonNuevo = calcularCanonNuevo(
        contrato.canon_centavos,
        porcentaje,
      );

      const resultado = await tx.contrato.updateMany({
        where: {
          id,
          estado: EstadoContrato.ACTIVO,
          canon_centavos: contrato.canon_centavos,
        },
        data: { canon_centavos: canonNuevo },
      });
      if (resultado.count === 0) {
        throw new ConflictException({
          codigo: 'INCREMENTO_YA_APLICADO',
          mensaje: 'Otra petición ya aplicó un incremento a este contrato.',
        });
      }

      const incremento = await tx.incrementoIPC.create({
        data: {
          contrato_id: id,
          fecha_aplicacion: hoy,
          canon_anterior_centavos: contrato.canon_centavos,
          canon_nuevo_centavos: canonNuevo,
          porcentaje_ipc_aplicado: porcentaje,
          ipc_referencia_anio: anioIpc,
          ipc_referencia_porcentaje: ipc.porcentaje,
        },
      });

      // B-50: el estado de pago se recalcula con el canon nuevo, en la misma
      // transacción y antes de leer el contrato para la respuesta.
      await recalcularEstadoPagoContrato(tx, id, hoy);

      return {
        contrato: await tx.contrato.findUniqueOrThrow({
          where: { id },
          omit: { pdf_contrato_ruta: true, ...OMITIR_COPIA_INQUILINO },
        }),
        incremento_ipc: incremento,
      };
    });

    await this.documentos.generarSinPropagarErrores(id);
    return resultado;
  }

  /**
   * Prórroga manual (Ley 820, art. 6): solo dentro de los 90 días previos al
   * vencimiento. Alarga `fecha_fin` y no cambia el canon. Una vez confirmada,
   * genera el otrosí de prórroga (si falla, la prórroga queda aplicada y el
   * documento pendiente de regeneración).
   */
  async prorrogar(id: string, arrendadorId: string, dto: ProrrogarContratoDto) {
    const hoy = hoyEnBogota();

    const resultado = await this.prisma.$transaction(async (tx) => {
      const contrato = await tx.contrato.findFirst({
        where: { id, unidad: { inmueble: { arrendador_id: arrendadorId } } },
        select: {
          id: true,
          estado: true,
          fecha_inicio: true,
          fecha_fin: true,
          prorrogas: {
            select: { fecha_fin_anterior: true },
            orderBy: [{ fecha_aplicacion: 'asc' }, { creado_en: 'asc' }],
            take: 1,
          },
        },
      });

      if (!contrato) {
        throw new NotFoundException('Contrato no encontrado.');
      }
      if (contrato.estado !== EstadoContrato.ACTIVO) {
        throw new ConflictException({
          codigo: 'CONTRATO_NO_ACTIVO',
          mensaje: 'El contrato no está activo.',
        });
      }

      const ventanaDesde = sumarDiasUTC(contrato.fecha_fin, -90);
      if (
        hoy.getTime() < ventanaDesde.getTime() ||
        hoy.getTime() > contrato.fecha_fin.getTime()
      ) {
        throw new ConflictException({
          codigo: 'PRORROGA_FUERA_DE_VENTANA',
          mensaje:
            'La prórroga solo se puede hacer dentro de los 90 días previos al vencimiento del contrato.',
          detalles: {
            puede_prorrogarse_desde: ventanaDesde.toISOString().slice(0, 10),
            puede_prorrogarse_hasta: contrato.fecha_fin
              .toISOString()
              .slice(0, 10),
          },
        });
      }

      const meses =
        dto.meses ??
        mesesDelTerminoInicial(
          contrato.fecha_inicio,
          contrato.fecha_fin,
          contrato.prorrogas[0]?.fecha_fin_anterior ?? null,
        );

      // Escritura condicional, fila Prorroga y recálculo de estado_pago (B-50)
      // en la misma transacción, antes de leer el contrato para la respuesta.
      const prorroga = await aplicarProrroga(tx, id, {
        fechaFinActual: contrato.fecha_fin,
        meses,
        tipo: TipoProrroga.MANUAL,
        fechaAplicacion: hoy,
        hoy,
      });
      if (!prorroga) {
        throw new ConflictException({
          codigo: 'PRORROGA_YA_APLICADA',
          mensaje: 'Otra petición ya prorrogó este contrato.',
        });
      }

      return {
        contrato: await tx.contrato.findUniqueOrThrow({
          where: { id },
          omit: { pdf_contrato_ruta: true, ...OMITIR_COPIA_INQUILINO },
        }),
        prorroga,
      };
    });

    await this.documentos.generarSinPropagarErrores(id);
    return resultado;
  }

  /**
   * Cancela un contrato PROGRAMADO (creado por error) sin borrar nada: el
   * contrato, su código de acceso y sus documentos se conservan. Un contrato
   * CANCELADO no cuenta para el traslape ni se activa.
   */
  async cancelarProgramado(id: string, arrendadorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const existente = await tx.contrato.findFirst({
        where: { id, unidad: { inmueble: { arrendador_id: arrendadorId } } },
        select: { id: true },
      });
      if (!existente) {
        throw new NotFoundException('Contrato no encontrado.');
      }

      const resultado = await tx.contrato.updateMany({
        where: { id, estado: EstadoContrato.PROGRAMADO },
        data: { estado: EstadoContrato.CANCELADO, cancelado_en: new Date() },
      });
      if (resultado.count === 0) {
        const actual = await tx.contrato.findUniqueOrThrow({
          where: { id },
          select: { estado: true },
        });
        throw new ConflictException({
          codigo: 'CONTRATO_NO_PROGRAMADO',
          mensaje:
            actual.estado === EstadoContrato.CANCELADO
              ? 'El contrato ya está cancelado.'
              : 'Solo un contrato programado se puede cancelar por aquí; un contrato activo termina por terminación anticipada o al vencer.',
        });
      }

      return tx.contrato.findUniqueOrThrow({
        where: { id },
        omit: { pdf_contrato_ruta: true, ...OMITIR_COPIA_INQUILINO },
      });
    });
  }

  async regenerarCodigo(id: string, arrendadorId: string) {
    const contrato = await this.prisma.contrato.findFirst({
      where: {
        id,
        unidad: {
          inmueble: { arrendador_id: arrendadorId },
        },
      },
      include: { codigo_acceso: true },
    });

    if (!contrato) {
      throw new NotFoundException('Contrato no encontrado.');
    }
    if (!contrato.codigo_acceso) {
      throw new NotFoundException(
        'El contrato no tiene un código de acceso asociado.',
      );
    }

    for (let intento = 1; intento <= 5; intento += 1) {
      try {
        const codigoAcceso = await this.prisma.codigoAcceso.update({
          where: { id: contrato.codigo_acceso.id },
          // El código nuevo invalida el anterior y vive 7 días desde ahora.
          data: {
            codigo: this.generarCodigoAcceso(),
            expira_en: fechaExpiracionCodigo(),
          },
        });
        return {
          codigo: codigoAcceso.codigo,
          expira_en: codigoAcceso.expira_en,
        };
      } catch (error) {
        if (this.esColisionDeCodigoAcceso(error) && intento < 5) {
          continue;
        }
        if (this.esColisionDeCodigoAcceso(error)) {
          throw new InternalServerErrorException(
            'No fue posible generar un código de acceso único.',
          );
        }
        throw error;
      }
    }

    throw new InternalServerErrorException(
      'No fue posible generar un código de acceso único.',
    );
  }

  /**
   * Datos del inquilino que el arrendador escribió para `inquilino_id`: la
   * copia de su contrato más reciente con esa persona o, si solo hay una ficha
   * legada de `POST /inquilinos` (`arrendador_id` = él), los de la ficha.
   * Cualquier otro caso es "no encontrado" (igual que un id inexistente).
   */
  private async resolverInquilinoPorId(
    inquilinoId: string,
    arrendadorId: string,
  ) {
    const anterior = await this.prisma.contrato.findFirst({
      where: { arrendador_id: arrendadorId, inquilino_id: inquilinoId },
      orderBy: { creado_en: 'desc' },
      select: {
        inquilino_nombre: true,
        inquilino_cedula: true,
        inquilino_telefono: true,
      },
    });
    if (anterior) {
      return {
        nombre: anterior.inquilino_nombre,
        cedula: anterior.inquilino_cedula,
        telefono: anterior.inquilino_telefono,
      };
    }
    const ficha = await this.prisma.inquilino.findFirst({
      where: { id: inquilinoId, arrendador_id: arrendadorId },
      select: { nombre: true, cedula: true, telefono: true },
    });
    if (!ficha) {
      throw new NotFoundException('Inquilino no encontrado');
    }
    return ficha;
  }

  async crear(dto: CrearContratoDto, arrendadorId: string) {
    if (dto.inquilino_id && dto.inquilino_nuevo) {
      throw new BadRequestException({
        codigo: 'INQUILINO_AMBIGUO',
        mensaje: 'Envía inquilino_id o inquilino_nuevo, no los dos.',
      });
    }
    if (!dto.inquilino_id && !dto.inquilino_nuevo) {
      throw new BadRequestException({
        codigo: 'INQUILINO_REQUERIDO',
        mensaje: 'Debes indicar inquilino_id o inquilino_nuevo.',
      });
    }
    const depositoCentavos = dto.deposito_centavos || null;
    if (
      dto.tipo_plantilla === TipoPlantillaContrato.VIVIENDA_URBANA_LEY_820 &&
      depositoCentavos !== null
    ) {
      throw new BadRequestException({
        codigo: 'DEPOSITO_NO_PERMITIDO_VIVIENDA',
        mensaje:
          'La Ley 820 de 2003, art. 16, no permite depósitos en dinero en arriendos de vivienda urbana. Se pueden pactar garantías como fiador, codeudor o póliza.',
      });
    }

    const arrendador = await this.prisma.arrendador.findUnique({
      where: { id: arrendadorId },
      select: { cedula: true },
    });
    if (!arrendador?.cedula?.trim()) {
      throw new ConflictException({
        codigo: 'CEDULA_ARRENDADOR_REQUERIDA',
        mensaje:
          'Debes registrar tu cédula en tu perfil (PATCH /arrendadores/perfil) antes de crear un contrato.',
      });
    }

    const unidad = await this.prisma.unidad.findFirst({
      where: {
        id: dto.unidad_id,
        inmueble: { arrendador_id: arrendadorId },
      },
    });
    if (!unidad) {
      throw new NotFoundException('Unidad no encontrada');
    }

    // B-47: la plantilla debe corresponder al tipo y uso de la unidad.
    if (
      !plantillaValidaParaUnidad(
        dto.tipo_plantilla,
        unidad.tipo,
        unidad.uso_permitido,
      )
    ) {
      const esperada = plantillaEsperadaParaUnidad(
        unidad.tipo,
        unidad.uso_permitido,
      );
      throw new BadRequestException({
        codigo: 'PLANTILLA_NO_CORRESPONDE_A_UNIDAD',
        mensaje: `La plantilla ${dto.tipo_plantilla} no corresponde a esta unidad (tipo ${unidad.tipo}, uso ${unidad.uso_permitido}); corresponde la plantilla ${esperada}.`,
      });
    }

    // Datos que escribió el arrendador: se guardan como copia en el contrato.
    let datosInquilino: { nombre: string; cedula: string; telefono: string };
    let cedulaNueva: string | null = null;
    if (dto.inquilino_nuevo) {
      datosInquilino = normalizarYValidarDatosInquilino(dto.inquilino_nuevo);
      cedulaNueva = datosInquilino.cedula;
    } else {
      datosInquilino = await this.resolverInquilinoPorId(
        dto.inquilino_id ?? '',
        arrendadorId,
      );
    }

    // B-41: con fecha de inicio futura el contrato nace PROGRAMADO y no
    // bloquea la unidad; el cron diario lo activa cuando llega su fecha.
    const estadoInicial =
      dto.fecha_inicio.getTime() > hoyEnBogota().getTime()
        ? EstadoContrato.PROGRAMADO
        : EstadoContrato.ACTIVO;

    let contratoCreado: Prisma.ContratoGetPayload<object> | undefined;

    try {
      for (let intento = 1; intento <= 5; intento += 1) {
        try {
          contratoCreado = await this.prisma.$transaction(async (tx) => {
            // Bloquea la fila de la unidad: el índice único solo cubre los
            // ACTIVO, así que dos creaciones simultáneas de contratos
            // PROGRAMADO traslapados se serializan aquí.
            await tx.$queryRaw`SELECT id FROM "Unidad" WHERE id = ${dto.unidad_id}::uuid FOR UPDATE`;
            const existentes = await tx.contrato.findMany({
              where: {
                unidad_id: dto.unidad_id,
                estado: {
                  in: [EstadoContrato.ACTIVO, EstadoContrato.PROGRAMADO],
                },
              },
              select: {
                estado: true,
                fecha_inicio: true,
                fecha_fin: true,
                terminacion_fecha_efectiva: true,
                terminacionAnticipadaConfirmadaEn: true,
              },
            });
            const choque = buscarTraslape(
              { inicio: dto.fecha_inicio, fin: dto.fecha_fin },
              existentes.map((existente) => ({
                estado: existente.estado,
                inicio: existente.fecha_inicio,
                fin: existente.fecha_fin,
                terminacion_fecha_efectiva:
                  existente.terminacion_fecha_efectiva,
                confirmada:
                  existente.terminacionAnticipadaConfirmadaEn !== null,
              })),
            );
            if (choque) {
              // Compatibilidad: un contrato nuevo ACTIVO sobre uno ACTIVO
              // conserva el error de siempre.
              if (
                estadoInicial === EstadoContrato.ACTIVO &&
                choque.estado === EstadoContrato.ACTIVO
              ) {
                throw new ConflictException(
                  'Esta unidad ya tiene un contrato activo',
                );
              }
              throw new ConflictException({
                codigo: 'TRASLAPE_DE_CONTRATOS',
                mensaje:
                  'Las fechas se traslapan con otro contrato de esta unidad. El siguiente contrato debe empezar después del último día del anterior.',
                detalles: {
                  fecha_inicio: choque.inicio.toISOString().slice(0, 10),
                  fecha_fin: choque.fin.toISOString().slice(0, 10),
                },
              });
            }

            // Identidad global de la persona: con inquilino_nuevo se busca por
            // cédula normalizada y, si no existe, se crea con skipDuplicates
            // (un create directo con P2002 dejaría inservible la transacción).
            // Si existe se reutiliza SIN modificar su nombre ni su teléfono.
            let inquilinoId = dto.inquilino_id ?? '';
            if (cedulaNueva !== null) {
              await tx.inquilino.createMany({
                data: [
                  {
                    nombre: datosInquilino.nombre,
                    cedula: cedulaNueva,
                    telefono: datosInquilino.telefono,
                    arrendador_id: null,
                  },
                ],
                skipDuplicates: true,
              });
              inquilinoId = (
                await tx.inquilino.findUniqueOrThrow({
                  where: { cedula: cedulaNueva },
                  select: { id: true },
                })
              ).id;
            }

            const contrato = await tx.contrato.create({
              data: {
                arrendador_id: arrendadorId,
                unidad_id: dto.unidad_id,
                inquilino_id: inquilinoId,
                inquilino_nombre: datosInquilino.nombre,
                inquilino_cedula: datosInquilino.cedula,
                inquilino_telefono: datosInquilino.telefono,
                tipo_plantilla: dto.tipo_plantilla,
                canon_centavos: dto.canon_centavos,
                dia_pago: dto.dia_pago,
                forma_pago: dto.forma_pago,
                deposito_centavos: depositoCentavos,
                datos_recaudo: dto.datos_recaudo,
                datos_fiador_o_poliza: dto.datos_fiador_o_poliza,
                condicionesParticularesTexto: dto.condicionesParticularesTexto,
                fecha_inicio: dto.fecha_inicio,
                fecha_fin: dto.fecha_fin,
                estado: estadoInicial,
              },
            });

            await tx.codigoAcceso.create({
              data: {
                codigo: this.generarCodigoAcceso(),
                expira_en: fechaExpiracionCodigo(),
                contrato_id: contrato.id,
                unidad_id: dto.unidad_id,
                inquilino_id: inquilinoId,
              },
            });

            return contrato;
          });
          break;
        } catch (error) {
          if (this.esColisionDeCodigoAcceso(error)) {
            if (intento === 5) {
              throw new InternalServerErrorException(
                'No fue posible generar el código de acceso',
              );
            }
            continue;
          }
          throw error;
        }
      }

      if (!contratoCreado) {
        throw new InternalServerErrorException(
          'No fue posible generar el código de acceso',
        );
      }
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Esta unidad ya tiene un contrato activo');
      }
      throw error;
    }

    const contratoConfirmado = contratoCreado;
    if (!contratoConfirmado) {
      throw new InternalServerErrorException(
        'No fue posible crear el contrato',
      );
    }

    // El contrato ya está confirmado: si el PDF falla no se pierde el contrato
    // y el original se puede generar luego con POST /contratos/:id/documentos/regenerar.
    await this.documentos.generarSinPropagarErrores(contratoConfirmado.id);

    const creado = await this.prisma.contrato.findUniqueOrThrow({
      where: { id: contratoConfirmado.id },
      include: {
        codigo_acceso: true,
        unidad: {
          include: { inmueble: { select: SELECT_INMUEBLE_RESUMEN } },
        },
      },
    });
    return {
      ...(await this.exponerUrlFirmada(conInquilinoDeLaCopia(creado))),
      vinculado: creado.vinculado_en !== null,
    };
  }
}
