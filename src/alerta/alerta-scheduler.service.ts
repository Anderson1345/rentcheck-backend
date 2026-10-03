import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
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
import { sumarDiasUTC, sumarMesesUTC } from '../common/fechas-contrato.util';
import { hoyEnBogota, inicioDelDiaBogota } from '../common/hoy-bogota.util';
import { recalcularEstadoPagoContrato } from '../common/recalcular-estado-pago';
import { fechaFinParaEstadoCuenta } from '../common/terminacion.util';
import {
  aplicarProrroga,
  mesesDelTerminoInicial,
} from '../contrato/aplicar-prorroga';
import { DocumentoContratoService } from '../contrato/documento-contrato.service';
import { alertarAlInquilinoDelContrato, crearAlerta } from './crear-alerta';
import { LimpiezaTecnicaService } from './limpieza-tecnica.service';
import { fechaDeAlerta } from './textos-alerta';

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

export interface ResultadoTarea {
  tarea: string;
  estado: 'ok' | 'error';
  duracion_ms: number;
  /** Conteos de la tarea; en un error, solo el nombre de la excepción (nunca datos). */
  detalle?: unknown;
}

/** Máximo de prórrogas automáticas por contrato y por corrida (recuperación). */
/** B-78: cada cuántos días vuelve a avisar un ajuste de IPC vencido que el arrendador ya leyó. */
const DIAS_ENTRE_AVISOS_IPC_VENCIDO = 7;

/** B-79 (D-13): la mora se repite como máximo cada 7 días por contrato, período y destinatario. */
export const DIAS_ENTRE_AVISOS_MORA = 7;

/**
 * B-79: el aviso de vencimiento sale una sola vez por fecha de fin. Cuenta cualquier aviso creado desde
 * (fecha_fin − 40 días): cubre la ventana de 30 días del aviso con margen, y una prórroga (fecha de fin
 * un período después) deja el aviso anterior fuera y permite el de la nueva fecha.
 */
const DIAS_ANTES_DEL_FIN_AVISO_VENCIMIENTO = 40;

/** B-80 (D-13): una alerta leída se borra a los 60 días de leída; las no leídas nunca. */
export const DIAS_RETENCION_LEIDAS = 60;

const DIA_MS = 24 * 60 * 60 * 1000;

/** B-77: un contrato cerrado se recalcula si su estado guardado no es AL_DIA o si cerró hace menos de esto. */
const DIAS_RECALCULO_CONTRATOS_CERRADOS = 90;

const MAX_PRORROGAS_POR_CORRIDA = 12;

function restarDiasUTC(fecha: Date, dias: number): Date {
  return sumarDiasUTC(fecha, -dias);
}

@Injectable()
export class AlertaSchedulerService {
  private readonly logger = new Logger(AlertaSchedulerService.name);

  /**
   * Hay una corrida en curso. La exclusión es por proceso: asume UNA sola
   * instancia del backend (Render, un servicio). Con varias instancias haría
   * falta un bloqueo en la base de datos.
   */
  private corridaEnCurso = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly documentos: DocumentoContratoService,
    private readonly limpieza: LimpiezaTecnicaService,
  ) {}

  tareasEnCurso(): boolean {
    return this.corridaEnCurso;
  }

  /**
   * ÚNICO @Cron de la aplicación: respaldo de las tareas diarias a las 00:05
   * de Bogotá. El disparo principal es el cron externo, que llama a
   * `POST /interno/tareas-diarias`; las dos vías comparten este punto de
   * entrada y pueden correr el mismo día sin duplicar nada.
   */
  @Cron('5 0 * * *', { timeZone: 'America/Bogota' })
  async cronTareasDiarias(): Promise<void> {
    const resultado = await this.ejecutarTareasDiarias();
    if (!Array.isArray(resultado)) {
      this.logger.warn(
        'Tareas diarias: el cron de respaldo no corrió porque ya había una corrida en curso.',
      );
    }
  }

  /**
   * Punto de entrada único de las tareas diarias, con el "hoy" de Bogotá. Orden
   * fijo: terminaciones anticipadas → vencimientos y prórrogas → activación de
   * programados (un contrato puede terminar y el siguiente activarse en la
   * misma corrida), luego las alertas y al final la limpieza. Cada tarea va en
   * su propio try/catch: una que falle no detiene a las demás. Si ya hay una
   * corrida en curso devuelve `{ estado: 'en_curso' }` sin arrancar otra.
   */
  async ejecutarTareasDiarias(
    ahora: Date = new Date(),
  ): Promise<ResultadoTarea[] | { estado: 'en_curso' }> {
    // El indicador se fija de forma síncrona: dos llamadas en el mismo tick
    // no pueden arrancar dos corridas.
    if (this.corridaEnCurso) {
      return { estado: 'en_curso' };
    }
    this.corridaEnCurso = true;
    try {
      const hoy = hoyEnBogota(ahora);
      const tareas: Array<[string, () => Promise<unknown>]> = [
        [
          'terminaciones_programadas',
          () => this.ejecutarTerminacionesProgramadas(hoy),
        ],
        [
          'vencimientos_y_prorrogas',
          () => this.ejecutarVencimientosYProrrogas(hoy),
        ],
        [
          'activacion_contratos_programados',
          () => this.ejecutarActivacionContratosProgramados(hoy),
        ],
        ['aviso_contrato_por_vencer', () => this.ejecutarVencimiento(ahora)],
        ['recordatorio_pago', () => this.ejecutarRecordatorioPago(hoy)],
        ['inquilino_en_mora', () => this.ejecutarInquilinoEnMora(ahora)],
        [
          'mantenimiento_sin_atender',
          () => this.ejecutarMantenimientoSinAtender(ahora),
        ],
        ['ajuste_ipc_pendiente', () => this.ejecutarAjusteIpcPendiente(ahora)],
        ['purga_alertas_leidas', () => this.purgarAlertasLeidas(ahora)],
        ['limpieza', () => this.limpieza.limpiar(ahora)],
      ];

      const resultados: ResultadoTarea[] = [];
      for (const [tarea, accion] of tareas) {
        const inicio = Date.now();
        try {
          const detalle = await accion();
          // Algunas tareas siguen cuando un elemento falla y lo cuentan.
          const conErrores =
            typeof detalle === 'object' &&
            detalle !== null &&
            'errores' in detalle &&
            typeof detalle.errores === 'number' &&
            detalle.errores > 0;
          resultados.push({
            tarea,
            estado: conErrores ? 'error' : 'ok',
            duracion_ms: Date.now() - inicio,
            detalle,
          });
        } catch (error) {
          this.logger.error(
            `Tareas diarias: falló la tarea ${tarea}`,
            error instanceof Error ? error.stack : String(error),
          );
          resultados.push({
            tarea,
            estado: 'error',
            duracion_ms: Date.now() - inicio,
            detalle: { error: error instanceof Error ? error.name : 'Error' },
          });
        }
      }

      const errores = resultados.filter((r) => r.estado === 'error');
      this.logger.log(
        `Tareas diarias (${hoy.toISOString().slice(0, 10)}): ${resultados.length - errores.length} ok, ${errores.length} con error${errores.length ? ` [${errores.map((r) => r.tarea).join(', ')}]` : ''}. ` +
          resultados
            .map((r) => `${r.tarea}=${r.estado}/${r.duracion_ms}ms`)
            .join(' '),
      );
      return resultados;
    } finally {
      this.corridaEnCurso = false;
    }
  }

  /**
   * ¿Ya hay una alerta de ese evento? Sí si existe una sin leer o si ya se
   * creó una durante el día calendario actual de Bogotá, aunque esté leída
   * (regla 20: dos corridas el mismo día no duplican nada).
   */
  private async yaHayAlerta(
    evento: Prisma.AlertaWhereInput,
    inicioDia: Date,
    diasRecientes = 0,
  ): Promise<boolean> {
    // Con `diasRecientes`, una alerta ya leída también cuenta mientras tenga menos de esos días.
    const desde = new Date(inicioDia.getTime() - diasRecientes * 86_400_000);
    const existente = await this.prisma.alerta.findFirst({
      where: {
        ...evento,
        OR: [{ leida: false }, { creado_en: { gte: desde } }],
      },
      select: { id: true },
    });
    return existente !== null;
  }

  /**
   * ¿Ya hay una alerta de ese evento creada desde `desde`, leída o no? (B-79: mora y vencimiento). A
   * diferencia de `yaHayAlerta`, una alerta sin leer más antigua NO cuenta: lo único que importa es
   * cuándo se creó la última.
   */
  private async yaHayAlertaDesde(
    evento: Prisma.AlertaWhereInput,
    desde: Date,
  ): Promise<boolean> {
    const existente = await this.prisma.alerta.findFirst({
      where: { ...evento, creado_en: { gte: desde } },
      select: { id: true },
    });
    return existente !== null;
  }

  /**
   * B-80 (D-13): borra las alertas LEÍDAS hace más de `DIAS_RETENCION_LEIDAS` días. Las no leídas nunca
   * se borran (una leída sin `leida_en` tampoco). Las alertas no tienen valor legal.
   */
  async purgarAlertasLeidas(
    ahora: Date = new Date(),
  ): Promise<{ alertasPurgadas: number }> {
    const limite = new Date(ahora.getTime() - DIAS_RETENCION_LEIDAS * DIA_MS);
    const { count } = await this.prisma.alerta.deleteMany({
      where: { leida: true, leida_en: { lt: limite } },
    });
    this.logger.log(
      `Purga de alertas: ${count} alerta(s) leída(s) hace más de ${DIAS_RETENCION_LEIDAS} días borrada(s).`,
    );
    return { alertasPurgadas: count };
  }

  /**
   * Alerta de cron para un contrato, una fila por destinatario: el arrendador siempre y el inquilino
   * solo si ya vinculó su cuenta (sin cuenta no hay a quién). Cada destinatario tiene su propia
   * deduplicación (B-79: no se crea si ESE destinatario ya tiene una del evento creada desde
   * `repetirDesde`, leída o no), así que leer una no afecta a la otra. Con `porPeriodo`, el evento es
   * también el período (mora). Devuelve cuántas filas creó.
   */
  private async alertarContratoAmbosRoles(
    contrato: {
      id: string;
      inquilino_id: string;
      vinculado_en: Date | null;
      unidad: { inmueble: { arrendador_id: string } };
    },
    datos: {
      tipo: TipoAlerta;
      repetirDesde: Date;
      porPeriodo?: boolean;
      creadoEn: Date;
      periodo?: Date | null;
      mensajeArrendador: string;
      mensajeInquilino: string;
    },
  ): Promise<number> {
    const evento: Prisma.AlertaWhereInput = {
      tipo: datos.tipo,
      contrato_id: contrato.id,
      ...(datos.porPeriodo ? { periodo: datos.periodo ?? null } : {}),
    };
    const destinatarios: Array<{
      destino: { arrendador_id: string } | { inquilino_id: string };
      mensaje: string;
    }> = [
      {
        destino: { arrendador_id: contrato.unidad.inmueble.arrendador_id },
        mensaje: datos.mensajeArrendador,
      },
      ...(contrato.vinculado_en !== null
        ? [
            {
              destino: { inquilino_id: contrato.inquilino_id },
              mensaje: datos.mensajeInquilino,
            },
          ]
        : []),
    ];

    let creadas = 0;
    for (const { destino, mensaje } of destinatarios) {
      if (
        await this.yaHayAlertaDesde(
          { ...evento, ...destino },
          datos.repetirDesde,
        )
      ) {
        continue;
      }
      await crearAlerta(this.prisma, {
        ...destino,
        tipo: datos.tipo,
        contrato_id: contrato.id,
        periodo: datos.periodo ?? null,
        mensaje,
        creado_en: datos.creadoEn,
      });
      creadas += 1;
    }
    return creadas;
  }

  /**
   * Transiciones de estado del contrato. El orden importa: primero terminan
   * las terminaciones anticipadas cuya fecha llegó, luego vencen o se
   * prorrogan los contratos cuya fecha de fin pasó y por último se activan los
   * programados. `ejecutarTareasDiarias` corre las tres por separado (cada una
   * con su try/catch); este método las encadena para quien las necesite juntas.
   */
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

      const hastaElDia = fechaDeAlerta(fechaFin);
      await crearAlerta(tx, {
        arrendador_id: contrato.arrendador_id,
        tipo: TipoAlerta.CONTRATO_PRORROGADO_AUTOMATICAMENTE,
        contrato_id: id,
        mensaje: `El contrato de la unidad ${contrato.unidad.nombre} se prorrogó automáticamente hasta el ${hastaElDia} (no hubo aviso de no renovación).`,
      });
      // Copia para el inquilino (otra fila; omitida si aún no vinculó su cuenta).
      await alertarAlInquilinoDelContrato(tx, id, {
        tipo: TipoAlerta.CONTRATO_PRORROGADO_AUTOMATICAMENTE,
        mensaje: `Tu contrato de la unidad {unidad} se prorrogó automáticamente hasta el ${hastaElDia} (no hubo aviso de no renovación).`,
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

  async ejecutarVencimiento(
    ahora: Date = new Date(),
  ): Promise<{ creadas: number }> {
    const hoy = hoyEnBogota(ahora);
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
      const fechaVencimiento = fechaDeAlerta(contrato.fecha_fin);
      creadas += await this.alertarContratoAmbosRoles(contrato, {
        tipo: TipoAlerta.CONTRATO_PROXIMO_A_VENCER,
        // B-79: una sola vez por fecha de fin, aunque se lea (una prórroga mueve la fecha y vuelve a avisar).
        repetirDesde: inicioDelDiaBogota(
          sumarDiasUTC(
            contrato.fecha_fin,
            -DIAS_ANTES_DEL_FIN_AVISO_VENCIMIENTO,
          ),
        ),
        creadoEn: ahora,
        mensajeArrendador: `El contrato de la unidad ${contrato.unidad.nombre} vence el ${fechaVencimiento}.`,
        mensajeInquilino: `Tu contrato de la unidad ${contrato.unidad.nombre} vence el ${fechaVencimiento}.`,
      });
    }

    this.logger.log(
      `Cron de vencimiento de contratos: ${contratos.length} contrato(s) por vencer, ${creadas} alerta(s) nueva(s) creada(s).`,
    );

    return { creadas };
  }

  async ejecutarRecordatorioPago(hoy: Date = hoyEnBogota()): Promise<{
    revisados: number;
    creadas: number;
  }> {
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
      // El recordatorio es para el inquilino: sin cuenta vinculada no hay a quién avisar.
      if (contrato.vinculado_en === null) {
        continue;
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

      // Deduplicación por el INQUILINO: una alerta de recordatorio que antes se mandó al arrendador no
      // cuenta, así que quien nunca recibió el aviso lo recibe.
      const yaExiste = await this.prisma.alerta.findFirst({
        where: {
          tipo: TipoAlerta.RECORDATORIO_PAGO_PROXIMO,
          contrato_id: contrato.id,
          inquilino_id: contrato.inquilino_id,
          creado_en: { gte: limiteReciente },
        },
        select: { id: true },
      });
      if (yaExiste) {
        continue;
      }

      const fechaPago = fechaDeAlerta(periodoProximo.fecha_limite);

      await crearAlerta(this.prisma, {
        inquilino_id: contrato.inquilino_id,
        tipo: TipoAlerta.RECORDATORIO_PAGO_PROXIMO,
        contrato_id: contrato.id,
        periodo: periodoProximo.periodo,
        mensaje: `Recuerda que tu pago de la unidad ${contrato.unidad.nombre} vence el ${fechaPago}.`,
        // Desde el día que se calcula (no del reloj de la base): la ventana de 20 días y las pruebas con
        // reloj simulado usan la misma fecha.
        creado_en: inicioDelDiaBogota(hoy),
      });
      creadas += 1;
    }

    this.logger.log(
      `Cron de recordatorio de pago: ${contratos.length} contrato(s) revisado(s), ${creadas} alerta(s) nueva(s) creada(s).`,
    );

    return { revisados: contratos.length, creadas };
  }

  async ejecutarMantenimientoSinAtender(ahora: Date = new Date()): Promise<{
    revisadas: number;
    creadas: number;
  }> {
    const hoy = hoyEnBogota(ahora);
    const inicioDia = inicioDelDiaBogota(hoy);
    // Solicitudes creadas antes de la medianoche de Bogotá de hace 5 días.
    const limite = inicioDelDiaBogota(sumarDiasUTC(hoy, -5));

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
      if (
        await this.yaHayAlerta(
          {
            tipo: TipoAlerta.SOLICITUD_MANTENIMIENTO_SIN_ATENDER,
            solicitud_mantenimiento_id: solicitud.id,
          },
          inicioDia,
        )
      ) {
        continue;
      }

      const arrendadorId = solicitud.unidad.inmueble.arrendador_id;
      const diasSinAtender = Math.floor(
        (inicioDia.getTime() - solicitud.creado_en.getTime()) /
          (1000 * 60 * 60 * 24),
      );

      await crearAlerta(this.prisma, {
        arrendador_id: arrendadorId,
        tipo: TipoAlerta.SOLICITUD_MANTENIMIENTO_SIN_ATENDER,
        solicitud_mantenimiento_id: solicitud.id,
        mensaje: `La solicitud de mantenimiento de la unidad ${solicitud.unidad.nombre} lleva ${diasSinAtender} día(s) sin atenderse.`,
        creado_en: ahora,
      });
      creadas += 1;
    }

    this.logger.log(
      `Cron de mantenimiento sin atender: ${solicitudes.length} solicitud(es) revisada(s), ${creadas} alerta(s) nueva(s) creada(s).`,
    );

    return { revisadas: solicitudes.length, creadas };
  }

  async ejecutarAjusteIpcPendiente(ahora: Date = new Date()): Promise<{
    revisados: number;
    creadas: number;
  }> {
    const hoy = hoyEnBogota(ahora);
    const inicioDia = inicioDelDiaBogota(hoy);
    const limite = sumarDiasUTC(hoy, 30);

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

      const proximoAjuste = sumarMesesUTC(referencia, 12);

      // B-78: un ajuste cuya fecha ya pasó TAMBIÉN avisa (antes se saltaba y un incremento vencido
      // nunca avisaba). Solo se descarta el que aún está a más de 30 días.
      if (proximoAjuste.getTime() > limite.getTime()) {
        continue;
      }
      const vencido = proximoAjuste.getTime() < hoy.getTime();

      // Dos formas de no repetir: una alerta sin leer, o una creada hoy (como las demás del cron). Un
      // ajuste VENCIDO seguiría avisando a diario hasta que se aplique, así que además cuenta una ya leída
      // de los últimos ${DIAS_ENTRE_AVISOS_IPC_VENCIDO} días: avisa a lo sumo una vez por semana.
      if (
        await this.yaHayAlerta(
          {
            tipo: TipoAlerta.AJUSTE_IPC_PENDIENTE,
            contrato_id: contrato.id,
            arrendador_id: contrato.unidad.inmueble.arrendador_id,
          },
          inicioDia,
          vencido ? DIAS_ENTRE_AVISOS_IPC_VENCIDO : 0,
        )
      ) {
        continue;
      }

      const arrendadorId = contrato.unidad.inmueble.arrendador_id;
      const fechaAjuste = fechaDeAlerta(proximoAjuste);

      await crearAlerta(this.prisma, {
        arrendador_id: arrendadorId,
        tipo: TipoAlerta.AJUSTE_IPC_PENDIENTE,
        contrato_id: contrato.id,
        mensaje: vencido
          ? `El ajuste de IPC de la unidad ${contrato.unidad.nombre} debía realizarse el ${fechaAjuste} y aún no se aplica.`
          : `El ajuste de IPC de la unidad ${contrato.unidad.nombre} debe realizarse el ${fechaAjuste}.`,
        creado_en: ahora,
      });
      creadas += 1;
    }

    this.logger.log(
      `Cron de ajuste de IPC: ${contratos.length} contrato(s) revisado(s), ${creadas} alerta(s) nueva(s) creada(s).`,
    );

    return { revisados: contratos.length, creadas };
  }

  async ejecutarInquilinoEnMora(ahora: Date = new Date()): Promise<{
    revisados: number;
    enMora: number;
    creadas: number;
    cerradosRecalculados: number;
    errores: number;
  }> {
    const hoy = hoyEnBogota(ahora);

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

      const fechaVencimientoStr = fechaDeAlerta(
        periodoEnMoraMasAntiguo.fecha_limite,
      );

      creadas += await this.alertarContratoAmbosRoles(contrato, {
        tipo: TipoAlerta.INQUILINO_EN_MORA,
        // B-79: como máximo cada 7 días por contrato, período y destinatario, leída o no: cuenta una
        // creada hoy o en los 6 días anteriores (día de Bogotá); a los 7 días se repite.
        repetirDesde: inicioDelDiaBogota(
          sumarDiasUTC(hoy, -(DIAS_ENTRE_AVISOS_MORA - 1)),
        ),
        porPeriodo: true,
        creadoEn: ahora,
        periodo: periodoEnMoraMasAntiguo.periodo,
        mensajeArrendador: `El pago de la unidad ${contrato.unidad.nombre} correspondiente a ${fechaVencimientoStr} está vencido.`,
        mensajeInquilino: `Tu pago de la unidad ${contrato.unidad.nombre} correspondiente a ${fechaVencimientoStr} está vencido.`,
      });
    }

    // B-77: el estado de pago de los contratos CERRADOS también se recalcula (el cron solo miraba los
    // ACTIVO), sin alertas de mora: la mora de un contrato cerrado se ve en el Panel. Solo los que pueden
    // haber cambiado: con estado guardado distinto de AL_DIA o cerrados hace poco. Es una lectura de
    // contratos y un recálculo por contrato (N+1, acotado por ese filtro).
    const cerrados = await this.prisma.contrato.findMany({
      where: {
        estado: {
          in: [
            EstadoContrato.VENCIDO,
            EstadoContrato.TERMINADO_ANTICIPADAMENTE,
          ],
        },
        OR: [
          { estado_pago: { not: EstadoPagoContrato.AL_DIA } },
          {
            fecha_fin: {
              gte: sumarDiasUTC(hoy, -DIAS_RECALCULO_CONTRATOS_CERRADOS),
            },
          },
        ],
      },
      select: { id: true },
    });
    let cerradosRecalculados = 0;
    let errores = 0;
    for (const cerrado of cerrados) {
      try {
        await recalcularEstadoPagoContrato(this.prisma, cerrado.id, hoy);
        cerradosRecalculados += 1;
      } catch (error) {
        errores += 1;
        this.logger.warn(
          `No se pudo recalcular el estado de pago del contrato cerrado ${cerrado.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    this.logger.log(
      `Cron de mora: ${contratos.length} contrato(s) revisado(s), ${enMora} en mora, ${creadas} alerta(s) nueva(s) creada(s); ${cerradosRecalculados} contrato(s) cerrado(s) recalculado(s)${errores ? `, ${errores} con error` : ''}.`,
    );

    return {
      revisados: contratos.length,
      enMora,
      creadas,
      cerradosRecalculados,
      errores,
    };
  }
}
