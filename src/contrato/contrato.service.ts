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
import { randomInt } from 'crypto';
import { AlmacenamientoService } from '../almacenamiento/almacenamiento.service';
import { PrismaService } from '../prisma/prisma.service';
import { calcularCanonNuevo } from '../common/canon-incremento.util';
import {
  calcularEstadoCuenta,
  construirRespuestaEstadoCuenta,
} from '../common/estado-cuenta.util';
import {
  mesesDeTermino,
  sumarDiasUTC,
  sumarMesesUTC,
} from '../common/fechas-contrato.util';
import { hoyEnBogota } from '../common/hoy-bogota.util';
import { AplicarIncrementoDto } from './dto/aplicar-incremento.dto';
import { CrearContratoDto } from './dto/crear-contrato.dto';
import { ProrrogarContratoDto } from './dto/prorrogar-contrato.dto';
import { DocumentoContratoService } from './documento-contrato.service';

const SELECT_CONTRATO_PARA_ESTADO_CUENTA = {
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

const SELECT_INQUILINO_RESUMEN = {
  id: true,
  nombre: true,
  cedula: true,
  telefono: true,
} as const satisfies Prisma.InquilinoSelect;

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

  private generarCodigoAcceso(): string {
    const caracteres = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const aleatorio = Array.from(
      { length: 4 },
      () => caracteres[randomInt(caracteres.length)],
    ).join('');

    return `RC-${new Date().getFullYear()}-${aleatorio}`;
  }

  private esColisionDeCodigoAcceso(error: unknown): boolean {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      return false;
    }

    const target = error.meta?.target;
    return (
      (Array.isArray(target) && target.includes('codigo')) ||
      (typeof target === 'string' && target.includes('CodigoAcceso_codigo_key'))
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
        inquilino: {
          select: {
            id: true,
            nombre: true,
          },
        },
        codigo_acceso: {
          select: { codigo: true },
        },
      },
      orderBy: { fecha_inicio: 'desc' },
    });

    return Promise.all(contratos.map((c) => this.exponerUrlFirmada(c)));
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
        inquilino: { select: SELECT_INQUILINO_RESUMEN },
        incrementos_ipc: true,
        codigo_acceso: {
          select: { codigo: true },
        },
      },
    });

    return contrato ? this.exponerUrlFirmada(contrato) : null;
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
        fecha_fin: contrato.fecha_fin,
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

      return {
        contrato: await tx.contrato.findUniqueOrThrow({
          where: { id },
          omit: { pdf_contrato_ruta: true },
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

      const finOriginal =
        contrato.prorrogas[0]?.fecha_fin_anterior ?? contrato.fecha_fin;
      const meses =
        dto.meses ?? mesesDeTermino(contrato.fecha_inicio, finOriginal);
      const fechaFinNueva = sumarMesesUTC(contrato.fecha_fin, meses);

      const resultado = await tx.contrato.updateMany({
        where: {
          id,
          estado: EstadoContrato.ACTIVO,
          fecha_fin: contrato.fecha_fin,
        },
        data: { fecha_fin: fechaFinNueva },
      });
      if (resultado.count === 0) {
        throw new ConflictException({
          codigo: 'PRORROGA_YA_APLICADA',
          mensaje: 'Otra petición ya prorrogó este contrato.',
        });
      }

      const prorroga = await tx.prorroga.create({
        data: {
          contrato_id: id,
          fecha_aplicacion: hoy,
          fecha_fin_anterior: contrato.fecha_fin,
          fecha_fin_nueva: fechaFinNueva,
          meses,
          tipo: TipoProrroga.MANUAL,
        },
      });

      return {
        contrato: await tx.contrato.findUniqueOrThrow({
          where: { id },
          omit: { pdf_contrato_ruta: true },
        }),
        prorroga,
      };
    });

    await this.documentos.generarSinPropagarErrores(id);
    return resultado;
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
          data: { codigo: this.generarCodigoAcceso() },
        });
        return { codigo: codigoAcceso.codigo };
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

  async crear(dto: CrearContratoDto, arrendadorId: string) {
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

    const inquilino = await this.prisma.inquilino.findFirst({
      where: { id: dto.inquilino_id, arrendador_id: arrendadorId },
    });
    if (!inquilino) {
      throw new NotFoundException('Inquilino no encontrado');
    }

    let contratoCreado: Prisma.ContratoGetPayload<object> | undefined;

    try {
      for (let intento = 1; intento <= 5; intento += 1) {
        try {
          contratoCreado = await this.prisma.$transaction(async (tx) => {
            const contrato = await tx.contrato.create({
              data: {
                arrendador_id: arrendadorId,
                unidad_id: dto.unidad_id,
                inquilino_id: dto.inquilino_id,
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
                estado: EstadoContrato.ACTIVO,
              },
            });

            await tx.codigoAcceso.create({
              data: {
                codigo: this.generarCodigoAcceso(),
                contrato_id: contrato.id,
                unidad_id: dto.unidad_id,
                inquilino_id: dto.inquilino_id,
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

    return this.exponerUrlFirmada(
      await this.prisma.contrato.findUniqueOrThrow({
        where: { id: contratoConfirmado.id },
        include: {
          codigo_acceso: true,
          unidad: {
            include: { inmueble: { select: SELECT_INMUEBLE_RESUMEN } },
          },
          inquilino: { select: SELECT_INQUILINO_RESUMEN },
        },
      }),
    );
  }

  async solicitarTerminacionAnticipada(
    id: string,
    arrendadorId: string,
    motivo: string,
  ) {
    const contrato = await this.prisma.contrato.findFirst({
      where: {
        id,
        unidad: {
          inmueble: { arrendador_id: arrendadorId },
        },
      },
    });

    if (!contrato) {
      throw new NotFoundException('Contrato no encontrado.');
    }

    if (contrato.estado !== EstadoContrato.ACTIVO) {
      throw new ConflictException(
        'Solo un contrato activo puede solicitar terminación anticipada.',
      );
    }

    if (contrato.terminacionAnticipadaSolicitada) {
      throw new ConflictException(
        'Este contrato ya tiene una solicitud de terminación anticipada pendiente.',
      );
    }

    return this.prisma.contrato.update({
      where: { id: contrato.id },
      data: {
        terminacionAnticipadaSolicitada: true,
        terminacionAnticipadaSolicitadaPor: RolSolicitante.ARRENDADOR,
        terminacionAnticipadaSolicitadaEn: new Date(),
        terminacionAnticipadaMotivo: motivo,
      },
    });
  }

  async confirmarTerminacionAnticipada(id: string, arrendadorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const contratoExistente = await tx.contrato.findFirst({
        where: {
          id,
          unidad: {
            inmueble: { arrendador_id: arrendadorId },
          },
        },
        select: { estado: true, terminacionAnticipadaSolicitada: true },
      });

      if (!contratoExistente) {
        throw new NotFoundException('Contrato no encontrado.');
      }

      const resultado = await tx.contrato.updateMany({
        where: {
          id,
          unidad: {
            inmueble: { arrendador_id: arrendadorId },
          },
          estado: EstadoContrato.ACTIVO,
          terminacionAnticipadaSolicitada: true,
        },
        data: {
          estado: EstadoContrato.TERMINADO_ANTICIPADAMENTE,
          terminacionAnticipadaConfirmadaEn: new Date(),
        },
      });

      if (resultado.count === 0) {
        if (
          contratoExistente.estado === EstadoContrato.TERMINADO_ANTICIPADAMENTE
        ) {
          throw new ConflictException({
            codigo: 'TERMINACION_YA_CONFIRMADA',
            mensaje: 'La terminación anticipada ya fue confirmada.',
          });
        }
        if (contratoExistente.estado !== EstadoContrato.ACTIVO) {
          throw new ConflictException({
            codigo: 'CONTRATO_NO_ACTIVO',
            mensaje: 'El contrato no está activo.',
          });
        }
        if (!contratoExistente.terminacionAnticipadaSolicitada) {
          throw new ConflictException({
            codigo: 'TERMINACION_NO_SOLICITADA',
            mensaje:
              'No hay una solicitud de terminación anticipada pendiente para confirmar.',
          });
        }
        // El contrato estaba ACTIVO y con solicitud pendiente en la lectura,
        // pero otra petición ya confirmó la terminación entre la lectura y
        // esta escritura condicional.
        throw new ConflictException({
          codigo: 'TERMINACION_YA_CONFIRMADA',
          mensaje: 'La terminación anticipada ya fue confirmada.',
        });
      }

      return tx.contrato.findUniqueOrThrow({ where: { id } });
    });
  }
}
