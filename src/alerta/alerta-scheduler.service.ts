import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  EstadoContrato,
  EstadoPagoContrato,
  EstadoSolicitudMantenimiento,
  Prisma,
  TipoAlerta,
  TipoProrroga,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { calcularEstadoCuenta } from '../common/estado-cuenta.util';
import { sumarDiasUTC } from '../common/fechas-contrato.util';
import { hoyEnBogota } from '../common/hoy-bogota.util';
import { recalcularEstadoPagoContrato } from '../common/recalcular-estado-pago';
import { fechaFinParaEstadoCuenta } from '../common/terminacion.util';
import {
  aplicarProrroga,
  mesesDelTerminoInicial,
} from '../contrato/aplicar-prorroga';
import { DocumentoContratoService } from '../contrato/documento-contrato.service';

const SELECT_INCREMENTOS_PARA_ESTADO_CUENTA = {
  fecha_aplicacion: true,
  canon_anterior_centavos: true,
  canon_nuevo_centavos: true,
} as const;

const SELECT_PAGOS_PARA_ESTADO_CUENTA = {
  periodo: true,
  estado: true,
  monto_centavos: true,
} as const;

/** Máximo de prórrogas automáticas por contrato y por corrida (recuperación). */
const MAX_PRORROGAS_POR_CORRIDA = 12;

function restarDiasUTC(fecha: Date, dias: number): Date {
  return sumarDiasUTC(fecha, -dias);
}

@Injectable()
export class AlertaSchedulerService {
  private readonly logger = new Logger(AlertaSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly documentos: DocumentoContratoService,
  ) {}

  /**
   * Único cron de estados del contrato, a las 00:05 de Bogotá. El orden
   * importa: primero terminan las terminaciones anticipadas cuya fecha llegó,
   * luego vencen o se prorrogan los contratos cuya fecha de fin pasó y por
   * último se activan los programados, de modo que un contrato pueda terminar
   * y el siguiente activarse en la misma corrida.
   */
  @Cron('5 0 * * *', { timeZone: 'America/Bogota' })
  async ejecutarTransicionesDeEstado(hoy: Date = hoyEnBogota()): Promise<{
    terminaciones: { aplicadas: number };
    vencimientos: { vencidos: number; prorrogados: number; errores: number };
    activaciones: { activados: number; vencidos: number; pendientes: number };
  }> {
    const terminaciones = await this.ejecutarTerminacionesProgramadas(hoy);
    const vencimientos = await this.ejecutarVencimientosYProrrogas(hoy);
    const activaciones = await this.ejecutarActivacionContratosProgramados(hoy);
    return { terminaciones, vencimientos, activaciones };
  }

  /**
   * Contratos ACTIVO cuya fecha de fin ya pasó (D-1): con aviso de no
   * renovación vigente pasan a VENCIDO; sin aviso se prorrogan
   * automáticamente por el término inicial. Si la unidad ya tiene un contrato
   * PROGRAMADO posterior, el contrato vence (prorrogarlo lo traslaparía). Una
   * falla en un contrato se registra y no detiene a los demás.
   */
  async ejecutarVencimientosYProrrogas(
    hoy: Date = hoyEnBogota(),
  ): Promise<{ vencidos: number; prorrogados: number; errores: number }> {
    const candidatos = await this.prisma.contrato.findMany({
      where: { estado: EstadoContrato.ACTIVO, fecha_fin: { lt: hoy } },
      select: {
        id: true,
        unidad_id: true,
        fecha_fin: true,
        aviso_no_renovacion: { select: { cancelado_en: true } },
      },
      orderBy: { fecha_fin: 'asc' },
    });

    let vencidos = 0;
    let prorrogados = 0;
    let errores = 0;
    for (const candidato of candidatos) {
      try {
        const conAviso =
          candidato.aviso_no_renovacion !== null &&
          candidato.aviso_no_renovacion.cancelado_en === null;
        const haySucesor =
          (await this.prisma.contrato.findFirst({
            where: {
              unidad_id: candidato.unidad_id,
              estado: EstadoContrato.PROGRAMADO,
              fecha_inicio: { gt: candidato.fecha_fin },
            },
            select: { id: true },
          })) !== null;

        if (conAviso || haySucesor) {
          const resultado = await this.prisma.contrato.updateMany({
            where: {
              id: candidato.id,
              estado: EstadoContrato.ACTIVO,
              fecha_fin: { lt: hoy },
              ...(conAviso
                ? { aviso_no_renovacion: { is: { cancelado_en: null } } }
                : {}),
            },
            data: { estado: EstadoContrato.VENCIDO },
          });
          vencidos += resultado.count;
        } else if (await this.prorrogarAutomaticamente(candidato.id, hoy)) {
          prorrogados += 1;
        }
      } catch (error) {
        errores += 1;
        this.logger.error(
          `No fue posible procesar el vencimiento del contrato ${candidato.id}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    this.logger.log(
      `Cron de vencimientos: ${vencidos} contrato(s) vencido(s), ${prorrogados} prorrogado(s) automáticamente, ${errores} error(es).`,
    );
    return { vencidos, prorrogados, errores };
  }

  /**
   * Prórroga automática (D-1) de un contrato ACTIVO sin aviso vigente, en una
   * sola transacción: por el término inicial, con `fecha_aplicacion` el día
   * siguiente a la fecha de fin anterior. Si el cron perdió días repite hasta
   * que `fecha_fin >= hoy` (máximo 12 por corrida). El otrosí de cada una se
   * genera fuera de la transacción. Devuelve false si no había nada que hacer
   * o si otra corrida ya lo prorrogó.
   */
  async prorrogarAutomaticamente(id: string, hoy: Date): Promise<boolean> {
    const aplicadas = await this.prisma.$transaction(async (tx) => {
      const contrato = await tx.contrato.findUnique({
        where: { id },
        select: {
          estado: true,
          arrendador_id: true,
          fecha_inicio: true,
          fecha_fin: true,
          unidad: { select: { nombre: true } },
          prorrogas: {
            select: { fecha_fin_anterior: true },
            orderBy: [{ fecha_aplicacion: 'asc' }, { creado_en: 'asc' }],
            take: 1,
          },
          aviso_no_renovacion: { select: { cancelado_en: true } },
        },
      });
      if (
        !contrato ||
        contrato.estado !== EstadoContrato.ACTIVO ||
        contrato.fecha_fin.getTime() >= hoy.getTime() ||
        (contrato.aviso_no_renovacion !== null &&
          contrato.aviso_no_renovacion.cancelado_en === null)
      ) {
        return 0;
      }

      const meses = mesesDelTerminoInicial(
        contrato.fecha_inicio,
        contrato.fecha_fin,
        contrato.prorrogas[0]?.fecha_fin_anterior ?? null,
      );
      let fechaFin = contrato.fecha_fin;
      let aplicadas = 0;
      while (
        fechaFin.getTime() < hoy.getTime() &&
        aplicadas < MAX_PRORROGAS_POR_CORRIDA
      ) {
        const prorroga = await aplicarProrroga(tx, id, {
          fechaFinActual: fechaFin,
          meses,
          tipo: TipoProrroga.AUTOMATICA,
          fechaAplicacion: sumarDiasUTC(fechaFin, 1),
          hoy,
        });
        if (!prorroga) {
          if (aplicadas === 0) {
            return 0; // Otra corrida ya lo prorrogó.
          }
          throw new Error(
            `El contrato ${id} cambió durante su prórroga automática; se revierte.`,
          );
        }
        fechaFin = prorroga.fecha_fin_nueva;
        aplicadas += 1;
      }
      if (fechaFin.getTime() < hoy.getTime()) {
        this.logger.warn(
          `El contrato ${id} llegó al máximo de ${MAX_PRORROGAS_POR_CORRIDA} prórrogas automáticas en una corrida y su fecha de fin sigue vencida; continúa en la próxima.`,
        );
      }

      await tx.alerta.create({
        data: {
          arrendador_id: contrato.arrendador_id,
          tipo: TipoAlerta.CONTRATO_PRORROGADO_AUTOMATICAMENTE,
          contrato_id: id,
          mensaje: `El contrato de la unidad ${contrato.unidad.nombre} se prorrogó automáticamente hasta el ${fechaFin.toISOString().slice(0, 10)} (no hubo aviso de no renovación).`,
        },
      });
      return aplicadas;
    });

    if (aplicadas === 0) {
      return false;
    }
    await this.documentos.generarSinPropagarErrores(id);
    return true;
  }

  /**
   * Aplica las terminaciones anticipadas ya confirmadas cuya fecha efectiva
   * llegó: el contrato pasa a TERMINADO_ANTICIPADAMENTE y se recalcula su
   * estado de pago. Idempotente: la escritura es condicional al estado ACTIVO.
   */
  async ejecutarTerminacionesProgramadas(
    hoy: Date = hoyEnBogota(),
  ): Promise<{ aplicadas: number }> {
    const candidatos = await this.prisma.contrato.findMany({
      where: {
        estado: EstadoContrato.ACTIVO,
        terminacionAnticipadaConfirmadaEn: { not: null },
        terminacion_fecha_efectiva: { lte: hoy },
      },
      select: { id: true },
    });

    let aplicadas = 0;
    for (const { id } of candidatos) {
      const aplicada = await this.prisma.$transaction(async (tx) => {
        const resultado = await tx.contrato.updateMany({
          where: {
            id,
            estado: EstadoContrato.ACTIVO,
            terminacionAnticipadaConfirmadaEn: { not: null },
            terminacion_fecha_efectiva: { lte: hoy },
          },
          data: { estado: EstadoContrato.TERMINADO_ANTICIPADAMENTE },
        });
        if (resultado.count === 0) {
          return false;
        }
        await recalcularEstadoPagoContrato(tx, id, hoy);
        return true;
      });
      if (aplicada) {
        aplicadas += 1;
      }
    }

    this.logger.log(
      `Cron de terminaciones programadas: ${aplicadas} contrato(s) pasado(s) a TERMINADO_ANTICIPADAMENTE.`,
    );
    return { aplicadas };
  }

  /**
   * Activa los contratos PROGRAMADO cuya fecha de inicio llegó (escritura
   * condicional al estado PROGRAMADO y recálculo del estado de pago). Si el
   * contrato anterior de la unidad sigue ACTIVO el índice único lo impide: no
   * falla, queda PROGRAMADO y se reintenta en la próxima corrida. Uno cuya
   * fecha de fin ya pasó sin haberse activado pasa a VENCIDO. Idempotente.
   */
  async ejecutarActivacionContratosProgramados(
    hoy: Date = hoyEnBogota(),
  ): Promise<{ activados: number; vencidos: number; pendientes: number }> {
    const candidatos = await this.prisma.contrato.findMany({
      where: {
        estado: EstadoContrato.PROGRAMADO,
        fecha_inicio: { lte: hoy },
      },
      select: { id: true, fecha_fin: true },
      orderBy: { fecha_inicio: 'asc' },
    });

    let activados = 0;
    let vencidos = 0;
    let pendientes = 0;
    for (const { id, fecha_fin } of candidatos) {
      if (fecha_fin.getTime() < hoy.getTime()) {
        const vencido = await this.prisma.contrato.updateMany({
          where: {
            id,
            estado: EstadoContrato.PROGRAMADO,
            fecha_fin: { lt: hoy },
          },
          data: { estado: EstadoContrato.VENCIDO },
        });
        vencidos += vencido.count;
        continue;
      }

      try {
        const activado = await this.prisma.$transaction(async (tx) => {
          const resultado = await tx.contrato.updateMany({
            where: {
              id,
              estado: EstadoContrato.PROGRAMADO,
              fecha_inicio: { lte: hoy },
              fecha_fin: { gte: hoy },
            },
            data: { estado: EstadoContrato.ACTIVO },
          });
          if (resultado.count === 0) {
            return false;
          }
          await recalcularEstadoPagoContrato(tx, id, hoy);
          return true;
        });
        if (activado) {
          activados += 1;
        }
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          pendientes += 1;
          this.logger.warn(
            `El contrato programado ${id} no se activó: la unidad aún tiene un contrato ACTIVO. Se reintenta en la próxima corrida.`,
          );
          continue;
        }
        throw error;
      }
    }

    this.logger.log(
      `Cron de activación: ${activados} contrato(s) activado(s), ${vencidos} vencido(s) sin activarse, ${pendientes} pendiente(s).`,
    );
    return { activados, vencidos, pendientes };
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async ejecutarVencimiento(): Promise<{ creadas: number }> {
    const hoy = hoyEnBogota();
    const limite = sumarDiasUTC(hoy, 30);

    const contratos = await this.prisma.contrato.findMany({
      where: {
        estado: EstadoContrato.ACTIVO,
        fecha_fin: { gte: hoy, lte: limite },
      },
      include: {
        unidad: {
          select: {
            nombre: true,
            inmueble: { select: { arrendador_id: true } },
          },
        },
      },
    });

    let creadas = 0;
    for (const contrato of contratos) {
      const yaExiste = await this.prisma.alerta.findFirst({
        where: {
          tipo: TipoAlerta.CONTRATO_PROXIMO_A_VENCER,
          contrato_id: contrato.id,
          leida: false,
        },
      });
      if (yaExiste) {
        continue;
      }

      const arrendadorId = contrato.unidad.inmueble.arrendador_id;
      const fechaVencimiento = contrato.fecha_fin.toLocaleDateString('es-CO', {
        timeZone: 'UTC',
      });

      await this.prisma.alerta.create({
        data: {
          arrendador_id: arrendadorId,
          tipo: TipoAlerta.CONTRATO_PROXIMO_A_VENCER,
          contrato_id: contrato.id,
          mensaje: `El contrato de la unidad ${contrato.unidad.nombre} vence el ${fechaVencimiento}.`,
        },
      });
      creadas += 1;
    }

    this.logger.log(
      `Cron de vencimiento de contratos: ${contratos.length} contrato(s) por vencer, ${creadas} alerta(s) nueva(s) creada(s).`,
    );

    return { creadas };
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async ejecutarRecordatorioPago(): Promise<{
    revisados: number;
    creadas: number;
  }> {
    const hoy = hoyEnBogota();

    const contratos = await this.prisma.contrato.findMany({
      where: {
        estado: EstadoContrato.ACTIVO,
      },
      include: {
        unidad: {
          select: {
            nombre: true,
            inmueble: { select: { arrendador_id: true } },
          },
        },
        incrementos_ipc: { select: SELECT_INCREMENTOS_PARA_ESTADO_CUENTA },
        pagos: { select: SELECT_PAGOS_PARA_ESTADO_CUENTA },
      },
    });

    const limiteReciente = restarDiasUTC(hoy, 20);

    let creadas = 0;
    for (const contrato of contratos) {
      const periodos = calcularEstadoCuenta(
        {
          fecha_inicio: contrato.fecha_inicio,
          fecha_fin: fechaFinParaEstadoCuenta(contrato),
          dia_pago: contrato.dia_pago,
          canon_centavos: contrato.canon_centavos,
        },
        contrato.incrementos_ipc,
        contrato.pagos,
        hoy,
      );

      const periodoProximo = periodos.find((periodo) => {
        if (periodo.estado !== 'PENDIENTE') {
          return false;
        }
        const diferenciaDias = Math.round(
          (periodo.fecha_limite.getTime() - hoy.getTime()) /
            (1000 * 60 * 60 * 24),
        );
        return diferenciaDias >= 0 && diferenciaDias <= 3;
      });

      if (!periodoProximo) {
        continue;
      }

      const yaExiste = await this.prisma.alerta.findFirst({
        where: {
          tipo: TipoAlerta.RECORDATORIO_PAGO_PROXIMO,
          contrato_id: contrato.id,
          creado_en: { gte: limiteReciente },
        },
      });
      if (yaExiste) {
        continue;
      }

      const arrendadorId = contrato.unidad.inmueble.arrendador_id;
      const fechaPago = periodoProximo.fecha_limite.toLocaleDateString('es-CO');

      await this.prisma.alerta.create({
        data: {
          arrendador_id: arrendadorId,
          tipo: TipoAlerta.RECORDATORIO_PAGO_PROXIMO,
          contrato_id: contrato.id,
          mensaje: `Recuerda que el pago de la unidad ${contrato.unidad.nombre} vence el ${fechaPago}.`,
        },
      });
      creadas += 1;
    }

    this.logger.log(
      `Cron de recordatorio de pago: ${contratos.length} contrato(s) revisado(s), ${creadas} alerta(s) nueva(s) creada(s).`,
    );

    return { revisados: contratos.length, creadas };
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async ejecutarMantenimientoSinAtender(): Promise<{
    revisadas: number;
    creadas: number;
  }> {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const limite = new Date(hoy);
    limite.setDate(limite.getDate() - 5);

    const solicitudes = await this.prisma.solicitudMantenimiento.findMany({
      where: {
        estado: EstadoSolicitudMantenimiento.PENDIENTE,
        creado_en: { lte: limite },
      },
      include: {
        unidad: {
          select: {
            nombre: true,
            inmueble: { select: { arrendador_id: true } },
          },
        },
      },
    });

    let creadas = 0;
    for (const solicitud of solicitudes) {
      const yaExiste = await this.prisma.alerta.findFirst({
        where: {
          tipo: TipoAlerta.SOLICITUD_MANTENIMIENTO_SIN_ATENDER,
          solicitud_mantenimiento_id: solicitud.id,
          leida: false,
        },
      });
      if (yaExiste) {
        continue;
      }

      const arrendadorId = solicitud.unidad.inmueble.arrendador_id;
      const diasSinAtender = Math.floor(
        (hoy.getTime() - solicitud.creado_en.getTime()) / (1000 * 60 * 60 * 24),
      );

      await this.prisma.alerta.create({
        data: {
          arrendador_id: arrendadorId,
          tipo: TipoAlerta.SOLICITUD_MANTENIMIENTO_SIN_ATENDER,
          solicitud_mantenimiento_id: solicitud.id,
          mensaje: `La solicitud de mantenimiento de la unidad ${solicitud.unidad.nombre} lleva ${diasSinAtender} día(s) sin atenderse.`,
        },
      });
      creadas += 1;
    }

    this.logger.log(
      `Cron de mantenimiento sin atender: ${solicitudes.length} solicitud(es) revisada(s), ${creadas} alerta(s) nueva(s) creada(s).`,
    );

    return { revisadas: solicitudes.length, creadas };
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async ejecutarAjusteIpcPendiente(): Promise<{
    revisados: number;
    creadas: number;
  }> {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const limite = new Date(hoy);
    limite.setDate(limite.getDate() + 30);
    limite.setHours(23, 59, 59, 999);

    const contratos = await this.prisma.contrato.findMany({
      where: {
        estado: EstadoContrato.ACTIVO,
      },
      include: {
        unidad: {
          select: {
            nombre: true,
            inmueble: { select: { arrendador_id: true } },
          },
        },
        incrementos_ipc: true,
      },
    });

    let creadas = 0;
    for (const contrato of contratos) {
      const referencia = contrato.incrementos_ipc.length
        ? contrato.incrementos_ipc.reduce((a, b) =>
            b.fecha_aplicacion.getTime() > a.fecha_aplicacion.getTime() ? b : a,
          ).fecha_aplicacion
        : contrato.fecha_inicio;

      const proximoAjuste = new Date(referencia);
      proximoAjuste.setFullYear(proximoAjuste.getFullYear() + 1);

      if (proximoAjuste < hoy || proximoAjuste > limite) {
        continue;
      }

      const yaExiste = await this.prisma.alerta.findFirst({
        where: {
          tipo: TipoAlerta.AJUSTE_IPC_PENDIENTE,
          contrato_id: contrato.id,
          leida: false,
        },
      });
      if (yaExiste) {
        continue;
      }

      const arrendadorId = contrato.unidad.inmueble.arrendador_id;
      const fechaAjuste = proximoAjuste.toLocaleDateString('es-CO');

      await this.prisma.alerta.create({
        data: {
          arrendador_id: arrendadorId,
          tipo: TipoAlerta.AJUSTE_IPC_PENDIENTE,
          contrato_id: contrato.id,
          mensaje: `El ajuste de IPC de la unidad ${contrato.unidad.nombre} debe realizarse el ${fechaAjuste}.`,
        },
      });
      creadas += 1;
    }

    this.logger.log(
      `Cron de ajuste de IPC: ${contratos.length} contrato(s) revisado(s), ${creadas} alerta(s) nueva(s) creada(s).`,
    );

    return { revisados: contratos.length, creadas };
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async ejecutarInquilinoEnMora(): Promise<{
    revisados: number;
    enMora: number;
    creadas: number;
  }> {
    const hoy = hoyEnBogota();

    const contratos = await this.prisma.contrato.findMany({
      where: {
        estado: EstadoContrato.ACTIVO,
      },
      include: {
        unidad: {
          select: {
            nombre: true,
            inmueble: { select: { arrendador_id: true } },
          },
        },
      },
    });

    let enMora = 0;
    let creadas = 0;
    for (const contrato of contratos) {
      // Entra y sale de mora en ambos sentidos: el recálculo guarda siempre
      // que el estado derivado difiera del guardado, no solo al entrar en mora.
      const { estadoPago: estadoDerivado, periodos } =
        await recalcularEstadoPagoContrato(this.prisma, contrato.id, hoy);

      if (estadoDerivado !== EstadoPagoContrato.EN_MORA) {
        continue;
      }
      enMora += 1;

      const periodoEnMoraMasAntiguo = periodos.find(
        (periodo) =>
          periodo.estado === 'VENCIDO' || periodo.estado === 'PARCIAL',
      );
      if (!periodoEnMoraMasAntiguo) {
        continue;
      }

      const yaExiste = await this.prisma.alerta.findFirst({
        where: {
          tipo: TipoAlerta.INQUILINO_EN_MORA,
          contrato_id: contrato.id,
          leida: false,
        },
      });
      if (yaExiste) {
        continue;
      }

      const arrendadorId = contrato.unidad.inmueble.arrendador_id;
      const fechaVencimientoStr =
        periodoEnMoraMasAntiguo.fecha_limite.toLocaleDateString('es-CO');

      await this.prisma.alerta.create({
        data: {
          arrendador_id: arrendadorId,
          tipo: TipoAlerta.INQUILINO_EN_MORA,
          contrato_id: contrato.id,
          mensaje: `El pago de la unidad ${contrato.unidad.nombre} correspondiente a ${fechaVencimientoStr} está vencido.`,
        },
      });
      creadas += 1;
    }

    this.logger.log(
      `Cron de mora: ${contratos.length} contrato(s) revisado(s), ${enMora} en mora, ${creadas} alerta(s) nueva(s) creada(s).`,
    );

    return { revisados: contratos.length, enMora, creadas };
  }
}
