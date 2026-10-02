import { EstadoContrato, RolSolicitante } from '@prisma/client';
import {
  calcularEstadoCuenta,
  DatosIncrementoParaEstadoCuenta,
  PeriodoEstadoCuenta,
} from './estado-cuenta.util';
import { sumarDiasUTC } from './fechas-contrato.util';
import { incrementoDisponibleDesde } from './incremento-disponible.util';
import {
  DatosTerminacion,
  fechaFinParaEstadoCuenta,
  resumenTerminacion,
} from './terminacion.util';

// Panel del arrendador (B-58). TODA la regla vive aquí, en una función pura: el servicio solo lee por
// lote y la llama, y `hoy` llega inyectado (siempre `hoyEnBogota()`), nunca se lee el reloj.
//
// Definiciones (decisiones D1 a D8 del diagnóstico de B0.6-A2):
// - Un período pertenece al mes de su FECHA LÍMITE (así lo hace `calcularEstadoCuenta`).
// - Recaudo del mes: por período, esperado = canon del período; aprobado = min(aprobado, canon);
//   en revisión = (solo con el período EN_REVISION) min(pagos PENDIENTE, canon − aprobado); sin
//   reportar = lo que falta. Las tres últimas suman siempre el esperado.
// - Ingresos y tendencia: caja real, pagos APROBADOS por `fecha_reportada`, sin tope por canon.
// - Mora: períodos VENCIDO o PARCIAL de cualquier contrato con períodos (ACTIVO, VENCIDO,
//   TERMINADO_ANTICIPADAMENTE); el saldo es canon − aprobado. EN_REVISION no es mora.
// - Nunca se usa `Contrato.estado_pago` guardado ni el canon de hoy para meses pasados.

/** Cuántos contratos se listan en cada bloque de pendientes (la cantidad es siempre el total real). */
export const MAXIMO_CONTRATOS_POR_PENDIENTE = 5;
/** Ventana de "contratos por vencer": la misma de `ejecutarVencimiento`. */
export const DIAS_PARA_CONTRATO_POR_VENCER = 30;
const MESES_DE_TENDENCIA = 6;

export interface PagoParaPanel {
  /** Primer día del mes que cubre (`@db.Date`). */
  periodo: Date;
  estado: 'PENDIENTE' | 'APROBADO' | 'RECHAZADO' | 'REEMPLAZADO';
  monto_centavos: number;
  /** Día en que pagó (`@db.Date`): la base de los ingresos. */
  fecha_reportada: Date;
}

export interface ContratoParaPanel extends DatosTerminacion {
  id: string;
  unidad_id: string;
  /** Nombre de la unidad. */
  unidad: string;
  /** Dirección del inmueble. */
  inmueble: string;
  fecha_inicio: Date;
  dia_pago: number;
  canon_centavos: number;
  incrementos_ipc: DatosIncrementoParaEstadoCuenta[];
  /** Solo PENDIENTE y APROBADO: son los únicos que cuentan para períodos e ingresos. */
  pagos: PagoParaPanel[];
}

export interface EntradasPanel {
  /** Todos los contratos del arrendador, en cualquier estado. */
  contratos: ContratoParaPanel[];
  /** Total de unidades de sus inmuebles (incluida la "Unidad principal" sin completar). */
  unidades_total: number;
  comprobantes_pendientes: number;
  mantenimientos_pendientes: number;
  /** ¿Existe el IPC del año que usaría un incremento aplicado hoy? */
  ipc_configurado: boolean;
}

export interface ContratoPendiente {
  contrato_id: string;
  unidad: string;
  inmueble: string;
  fecha_fin: string;
}

export interface IncrementoDisponible {
  contrato_id: string;
  unidad: string;
  inmueble: string;
  disponible_desde: string;
  ipc_faltante: boolean;
}

export interface ListaPendiente<T> {
  cantidad: number;
  contratos: T[];
}

export interface PanelArrendador {
  mes: string;
  calculado_para: string;
  ingresos_mes_centavos: number;
  recaudo: {
    esperado_centavos: number;
    aprobado_centavos: number;
    en_revision_centavos: number;
    sin_reportar_centavos: number;
    contratos: number;
  };
  ocupacion: {
    unidades: number;
    ocupadas: number;
    libres: number;
    con_contrato_programado: number;
  };
  mora: { contratos: number; periodos: number; total_centavos: number };
  tendencia: { mes: string; ingresos_centavos: number }[];
  pendientes: {
    comprobantes_por_validar: number;
    mantenimientos_pendientes: number;
    contratos_por_vencer: ListaPendiente<ContratoPendiente>;
    incrementos_disponibles: ListaPendiente<IncrementoDisponible>;
    terminaciones_por_confirmar: ListaPendiente<ContratoPendiente>;
  };
}

/** "AAAA-MM" de una fecha de día (medianoche UTC). */
function claveMes(fecha: Date): string {
  const mes = String(fecha.getUTCMonth() + 1).padStart(2, '0');
  return `${fecha.getUTCFullYear()}-${mes}`;
}

function aTextoDia(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/** Los 6 meses de la tendencia, del más antiguo al de hoy, cruzando el cambio de año. */
function mesesDeTendencia(hoy: Date): string[] {
  const meses: string[] = [];
  for (let atras = MESES_DE_TENDENCIA - 1; atras >= 0; atras -= 1) {
    meses.push(
      claveMes(
        new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - atras, 1)),
      ),
    );
  }
  return meses;
}

function generaPeriodos(contrato: ContratoParaPanel): boolean {
  return (
    contrato.estado !== EstadoContrato.PROGRAMADO &&
    contrato.estado !== EstadoContrato.CANCELADO
  );
}

/**
 * Los mismos períodos que `periodosDelContrato` (única fuente de la regla): `calcularEstadoCuenta`
 * con la fecha de fin efectiva de la terminación. Los pagos RECHAZADO y REEMPLAZADO no cuentan.
 */
function periodosDe(
  contrato: ContratoParaPanel,
  hoy: Date,
): PeriodoEstadoCuenta[] {
  if (!generaPeriodos(contrato)) {
    return [];
  }
  return calcularEstadoCuenta(
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
}

function ordenarPorFecha<T extends { id: string; fecha: Date }>(
  items: T[],
): T[] {
  return [...items].sort(
    (a, b) => a.fecha.getTime() - b.fecha.getTime() || a.id.localeCompare(b.id),
  );
}

export function construirPanel(
  entradas: EntradasPanel,
  hoy: Date,
): PanelArrendador {
  const mes = claveMes(hoy);
  const { contratos } = entradas;

  // ---- Recaudo del mes y mora (por períodos) ----
  const recaudo = {
    esperado_centavos: 0,
    aprobado_centavos: 0,
    en_revision_centavos: 0,
    sin_reportar_centavos: 0,
    contratos: 0,
  };
  const mora = { contratos: 0, periodos: 0, total_centavos: 0 };

  for (const contrato of contratos) {
    const periodos = periodosDe(contrato, hoy);
    let tienePeriodoEnElMes = false;
    let tieneMora = false;

    for (const periodo of periodos) {
      if (claveMes(periodo.periodo) === mes) {
        tienePeriodoEnElMes = true;
        const canon = periodo.canon_vigente_centavos;
        const aprobado = Math.min(periodo.monto_aprobado_centavos, canon);
        const pendiente =
          periodo.estado === 'EN_REVISION'
            ? contrato.pagos
                .filter(
                  (pago) =>
                    pago.estado === 'PENDIENTE' &&
                    claveMes(pago.periodo) === claveMes(periodo.periodo),
                )
                .reduce((suma, pago) => suma + pago.monto_centavos, 0)
            : 0;
        const enRevision = Math.max(0, Math.min(pendiente, canon - aprobado));
        recaudo.esperado_centavos += canon;
        recaudo.aprobado_centavos += aprobado;
        recaudo.en_revision_centavos += enRevision;
        recaudo.sin_reportar_centavos += Math.max(
          0,
          canon - aprobado - enRevision,
        );
      }

      if (periodo.estado === 'VENCIDO' || periodo.estado === 'PARCIAL') {
        tieneMora = true;
        mora.periodos += 1;
        mora.total_centavos += Math.max(
          0,
          periodo.canon_vigente_centavos - periodo.monto_aprobado_centavos,
        );
      }
    }

    if (tienePeriodoEnElMes) {
      recaudo.contratos += 1;
    }
    if (tieneMora) {
      mora.contratos += 1;
    }
  }

  // ---- Ingresos del mes y tendencia (caja real por fecha_reportada) ----
  const ingresosPorMes = new Map(
    mesesDeTendencia(hoy).map((clave) => [clave, 0]),
  );
  for (const contrato of contratos) {
    for (const pago of contrato.pagos) {
      if (pago.estado !== 'APROBADO') {
        continue;
      }
      const clave = claveMes(pago.fecha_reportada);
      const actual = ingresosPorMes.get(clave);
      if (actual !== undefined) {
        ingresosPorMes.set(clave, actual + pago.monto_centavos);
      }
    }
  }
  const tendencia = [...ingresosPorMes].map(([clave, ingresos]) => ({
    mes: clave,
    ingresos_centavos: ingresos,
  }));

  // ---- Ocupación ----
  const ocupadas = new Set(
    contratos
      .filter((c) => c.estado === EstadoContrato.ACTIVO)
      .map((c) => c.unidad_id),
  );
  const conProgramado = new Set(
    contratos
      .filter(
        (c) =>
          c.estado === EstadoContrato.PROGRAMADO && !ocupadas.has(c.unidad_id),
      )
      .map((c) => c.unidad_id),
  );

  // ---- Pendientes ----
  const activos = contratos.filter((c) => c.estado === EstadoContrato.ACTIVO);
  const limiteVencer = sumarDiasUTC(hoy, DIAS_PARA_CONTRATO_POR_VENCER);

  const porVencer = ordenarPorFecha(
    activos
      .filter(
        (c) =>
          c.fecha_fin.getTime() >= hoy.getTime() &&
          c.fecha_fin.getTime() <= limiteVencer.getTime(),
      )
      .map((c) => ({ id: c.id, fecha: c.fecha_fin, contrato: c })),
  );

  const incrementos = ordenarPorFecha(
    activos
      .map((c) => ({
        id: c.id,
        fecha: incrementoDisponibleDesde(
          c.fecha_inicio,
          c.incrementos_ipc.reduce<Date | null>(
            (ultima, i) =>
              ultima === null || i.fecha_aplicacion.getTime() > ultima.getTime()
                ? i.fecha_aplicacion
                : ultima,
            null,
          ),
        ),
        contrato: c,
      }))
      .filter((c) => c.fecha.getTime() <= hoy.getTime()),
  );

  const terminaciones = ordenarPorFecha(
    contratos
      .filter(
        (c) => resumenTerminacion(c, RolSolicitante.ARRENDADOR).puede_confirmar,
      )
      .map((c) => ({ id: c.id, fecha: c.fecha_fin, contrato: c })),
  );

  const pendiente = (c: ContratoParaPanel): ContratoPendiente => ({
    contrato_id: c.id,
    unidad: c.unidad,
    inmueble: c.inmueble,
    fecha_fin: aTextoDia(c.fecha_fin),
  });

  return {
    mes,
    calculado_para: aTextoDia(hoy),
    ingresos_mes_centavos: ingresosPorMes.get(mes) ?? 0,
    recaudo,
    ocupacion: {
      unidades: entradas.unidades_total,
      ocupadas: ocupadas.size,
      libres: Math.max(0, entradas.unidades_total - ocupadas.size),
      con_contrato_programado: conProgramado.size,
    },
    mora,
    tendencia,
    pendientes: {
      comprobantes_por_validar: entradas.comprobantes_pendientes,
      mantenimientos_pendientes: entradas.mantenimientos_pendientes,
      contratos_por_vencer: {
        cantidad: porVencer.length,
        contratos: porVencer
          .slice(0, MAXIMO_CONTRATOS_POR_PENDIENTE)
          .map((i) => pendiente(i.contrato)),
      },
      incrementos_disponibles: {
        cantidad: incrementos.length,
        contratos: incrementos
          .slice(0, MAXIMO_CONTRATOS_POR_PENDIENTE)
          .map((i) => ({
            contrato_id: i.contrato.id,
            unidad: i.contrato.unidad,
            inmueble: i.contrato.inmueble,
            disponible_desde: aTextoDia(i.fecha),
            ipc_faltante: !entradas.ipc_configurado,
          })),
      },
      terminaciones_por_confirmar: {
        cantidad: terminaciones.length,
        contratos: terminaciones
          .slice(0, MAXIMO_CONTRATOS_POR_PENDIENTE)
          .map((i) => pendiente(i.contrato)),
      },
    },
  };
}
