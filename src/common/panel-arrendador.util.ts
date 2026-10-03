import {
  EstadoContrato,
  EstadoSolicitudMantenimiento,
  RolSolicitante,
  UrgenciaMantenimiento,
} from '@prisma/client';
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
//
// B0.7-B (B-82, D-14): morosos (quién me debe), año en curso frente al anterior, ingresos por inmueble,
// ocupación por unidad y solicitudes abiertas. Misma definición de mora y de ingresos que arriba.

/** Cuántos contratos se listan en cada bloque de pendientes (la cantidad es siempre el total real). */
export const MAXIMO_CONTRATOS_POR_PENDIENTE = 5;
/** Ventana de "contratos por vencer": la misma de `ejecutarVencimiento`. */
export const DIAS_PARA_CONTRATO_POR_VENCER = 30;
const MESES_DE_TENDENCIA = 6;
/** Cuántos morosos se listan (el total es `mora.contratos`). */
export const MAXIMO_MOROSOS = 10;
/** La urgencia más alta del enum (el último valor): las solicitudes "urgentes". */
const URGENCIA_MAS_ALTA = Object.values(UrgenciaMantenimiento).at(-1);
const DIA_MS = 24 * 60 * 60 * 1000;

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
  inmueble_id: string;
  /** Dirección del inmueble. */
  inmueble: string;
  /** Copia del nombre del inquilino que guarda el contrato (nunca el perfil global). */
  inquilino_nombre: string;
  fecha_inicio: Date;
  dia_pago: number;
  canon_centavos: number;
  incrementos_ipc: DatosIncrementoParaEstadoCuenta[];
  /** Solo PENDIENTE y APROBADO: son los únicos que cuentan para períodos e ingresos. */
  pagos: PagoParaPanel[];
}

export interface UnidadParaPanel {
  id: string;
  nombre: string;
  inmueble_id: string;
  inmueble_direccion: string;
}

export interface InmuebleParaPanel {
  id: string;
  direccion: string;
}

/** Cuántas solicitudes de mantenimiento ABIERTAS (PENDIENTE o EN_PROCESO) hay por estado y urgencia. */
export interface ConteoSolicitudes {
  estado: EstadoSolicitudMantenimiento;
  urgencia: UrgenciaMantenimiento;
  cantidad: number;
}

export interface EntradasPanel {
  /** Todos los contratos del arrendador, en cualquier estado. */
  contratos: ContratoParaPanel[];
  /** Todas las unidades de sus inmuebles (incluida la "Unidad principal" sin completar). */
  unidades: UnidadParaPanel[];
  /** Todos sus inmuebles, también los que no tienen unidades. */
  inmuebles: InmuebleParaPanel[];
  comprobantes_pendientes: number;
  solicitudes: ConteoSolicitudes[];
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

export interface MorosoPanel {
  contrato_id: string;
  unidad: { id: string; nombre: string };
  inmueble: { id: string; direccion: string };
  /** Nombre que guarda el contrato; null si está vacío. */
  inquilino: { nombre: string } | null;
  /** Períodos VENCIDO o PARCIAL. */
  periodos: number;
  /** Lo que debe: suma de (canon del período − aprobado). */
  monto_centavos: number;
  /** Días de Bogotá desde la fecha límite del período en mora más antiguo hasta hoy (≥ 1). */
  dias_mora: number;
  /** "AAAA-MM-DD" del período en mora más antiguo (primer día del mes). */
  periodo_mas_antiguo: string;
}

export interface MesAnioPanel {
  mes: string;
  actual_centavos: number;
  anterior_centavos: number;
}

export interface AnioPanel {
  anio: number;
  meses: MesAnioPanel[];
  total_actual_centavos: number;
  total_anterior_centavos: number;
  variacion_porcentual: number | null;
}

export interface InmueblePanel {
  inmueble_id: string;
  direccion: string;
  ingresos_anio_centavos: number;
  unidades: number;
  ocupadas: number;
}

export const ESTADOS_OCUPACION_UNIDAD = [
  'EN_MORA',
  'AL_DIA',
  'PROGRAMADA',
  'LIBRE',
] as const;
export type EstadoOcupacionUnidad = (typeof ESTADOS_OCUPACION_UNIDAD)[number];

export interface UnidadOcupacion {
  unidad_id: string;
  nombre: string;
  inmueble_id: string;
  inmueble_direccion: string;
  estado: EstadoOcupacionUnidad;
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
    porcentaje: number | null;
    unidades_detalle: UnidadOcupacion[];
  };
  mora: { contratos: number; periodos: number; total_centavos: number };
  morosos: MorosoPanel[];
  tendencia: { mes: string; ingresos_centavos: number }[];
  anio: AnioPanel;
  por_inmueble: InmueblePanel[];
  pendientes: {
    comprobantes_por_validar: number;
    mantenimientos_pendientes: number;
    solicitudes_abiertas: { total: number; urgentes: number };
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

/** Porcentaje entero redondeado; null si el denominador es 0. */
function porcentaje(parte: number, total: number): number | null {
  return total === 0 ? null : Math.round((parte / total) * 100);
}

const compararTexto = (a: string, b: string): number =>
  a.localeCompare(b, 'es');
const compararId = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

/**
 * Año en curso frente al anterior (caja real: pagos APROBADOS por `fecha_reportada`). Meses de enero al
 * actual; cada mes del año anterior completo. Los totales van del 1 de enero a hoy y del 1 de enero al
 * mismo día del año anterior (un 29 de febrero se compara con el 28).
 */
function construirAnio(contratos: ContratoParaPanel[], hoy: Date): AnioPanel {
  const anio = hoy.getUTCFullYear();
  const mesHoy = hoy.getUTCMonth();
  const diasDelMesAnterior = new Date(
    Date.UTC(anio - 1, mesHoy + 1, 0),
  ).getUTCDate();
  const mismoDiaAnterior = new Date(
    Date.UTC(anio - 1, mesHoy, Math.min(hoy.getUTCDate(), diasDelMesAnterior)),
  );
  const meses: MesAnioPanel[] = [];
  for (let m = 0; m <= mesHoy; m += 1) {
    meses.push({
      mes: `${anio}-${String(m + 1).padStart(2, '0')}`,
      actual_centavos: 0,
      anterior_centavos: 0,
    });
  }
  let totalActual = 0;
  let totalAnterior = 0;
  for (const contrato of contratos) {
    for (const pago of contrato.pagos) {
      if (pago.estado !== 'APROBADO') {
        continue;
      }
      const fecha = pago.fecha_reportada;
      const mes = fecha.getUTCMonth();
      if (mes > mesHoy) {
        continue;
      }
      if (fecha.getUTCFullYear() === anio) {
        meses[mes].actual_centavos += pago.monto_centavos;
        if (fecha.getTime() <= hoy.getTime()) {
          totalActual += pago.monto_centavos;
        }
      } else if (fecha.getUTCFullYear() === anio - 1) {
        meses[mes].anterior_centavos += pago.monto_centavos;
        if (fecha.getTime() <= mismoDiaAnterior.getTime()) {
          totalAnterior += pago.monto_centavos;
        }
      }
    }
  }
  return {
    anio,
    meses,
    total_actual_centavos: totalActual,
    total_anterior_centavos: totalAnterior,
    variacion_porcentual: porcentaje(
      totalActual - totalAnterior,
      totalAnterior,
    ),
  };
}

/** Ingresos del año en curso (1 de enero a hoy) de un contrato. */
function ingresosDelAnio(contrato: ContratoParaPanel, hoy: Date): number {
  const inicioAnio = Date.UTC(hoy.getUTCFullYear(), 0, 1);
  return contrato.pagos
    .filter(
      (p) =>
        p.estado === 'APROBADO' &&
        p.fecha_reportada.getTime() >= inicioAnio &&
        p.fecha_reportada.getTime() <= hoy.getTime(),
    )
    .reduce((suma, p) => suma + p.monto_centavos, 0);
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
  const morosos: MorosoPanel[] = [];
  /** Contratos con mora (para el estado de la unidad). */
  const conMora = new Set<string>();

  for (const contrato of contratos) {
    const periodos = periodosDe(contrato, hoy);
    let tienePeriodoEnElMes = false;
    let tieneMora = false;
    let periodosEnMora = 0;
    let deuda = 0;
    let masAntiguo: PeriodoEstadoCuenta | null = null;

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
        const saldo = Math.max(
          0,
          periodo.canon_vigente_centavos - periodo.monto_aprobado_centavos,
        );
        mora.periodos += 1;
        mora.total_centavos += saldo;
        periodosEnMora += 1;
        deuda += saldo;
        // Los períodos vienen en orden: el primero en mora es el más antiguo.
        masAntiguo ??= periodo;
      }
    }

    if (tienePeriodoEnElMes) {
      recaudo.contratos += 1;
    }
    if (tieneMora && masAntiguo) {
      mora.contratos += 1;
      conMora.add(contrato.id);
      const nombre = contrato.inquilino_nombre.trim();
      morosos.push({
        contrato_id: contrato.id,
        unidad: { id: contrato.unidad_id, nombre: contrato.unidad },
        inmueble: { id: contrato.inmueble_id, direccion: contrato.inmueble },
        inquilino: nombre ? { nombre } : null,
        periodos: periodosEnMora,
        monto_centavos: deuda,
        // Fechas de día (medianoche UTC): la diferencia es un número entero de días de Bogotá.
        dias_mora: Math.round(
          (hoy.getTime() - masAntiguo.fecha_limite.getTime()) / DIA_MS,
        ),
        periodo_mas_antiguo: aTextoDia(masAntiguo.periodo),
      });
    }
  }
  morosos.sort(
    (a, b) =>
      b.monto_centavos - a.monto_centavos ||
      b.dias_mora - a.dias_mora ||
      compararId(a.contrato_id, b.contrato_id),
  );

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

  // Estado de cada unidad: con contrato ACTIVO, en mora o al día; si no, programada o libre.
  const activoDeUnidad = new Map(
    contratos
      .filter((c) => c.estado === EstadoContrato.ACTIVO)
      .map((c) => [c.unidad_id, c]),
  );
  const estadoDeUnidad = (unidadId: string): EstadoOcupacionUnidad => {
    const activo = activoDeUnidad.get(unidadId);
    if (activo) {
      return conMora.has(activo.id) ? 'EN_MORA' : 'AL_DIA';
    }
    return conProgramado.has(unidadId) ? 'PROGRAMADA' : 'LIBRE';
  };
  const unidadesDetalle: UnidadOcupacion[] = entradas.unidades
    .map((u) => ({
      unidad_id: u.id,
      nombre: u.nombre,
      inmueble_id: u.inmueble_id,
      inmueble_direccion: u.inmueble_direccion,
      estado: estadoDeUnidad(u.id),
    }))
    .sort(
      (a, b) =>
        compararTexto(a.inmueble_direccion, b.inmueble_direccion) ||
        compararTexto(a.nombre, b.nombre) ||
        compararId(a.unidad_id, b.unidad_id),
    );

  // ---- Año en curso y por inmueble ----
  const anio = construirAnio(contratos, hoy);
  const ingresosPorInmueble = new Map<string, number>();
  for (const contrato of contratos) {
    ingresosPorInmueble.set(
      contrato.inmueble_id,
      (ingresosPorInmueble.get(contrato.inmueble_id) ?? 0) +
        ingresosDelAnio(contrato, hoy),
    );
  }
  const porInmueble: InmueblePanel[] = entradas.inmuebles
    .map((i) => {
      const suyas = entradas.unidades.filter((u) => u.inmueble_id === i.id);
      return {
        inmueble_id: i.id,
        direccion: i.direccion,
        ingresos_anio_centavos: ingresosPorInmueble.get(i.id) ?? 0,
        unidades: suyas.length,
        ocupadas: suyas.filter((u) => ocupadas.has(u.id)).length,
      };
    })
    .sort(
      (a, b) =>
        b.ingresos_anio_centavos - a.ingresos_anio_centavos ||
        compararTexto(a.direccion, b.direccion) ||
        compararId(a.inmueble_id, b.inmueble_id),
    );

  // ---- Solicitudes de mantenimiento ----
  let solicitudesAbiertas = 0;
  let solicitudesUrgentes = 0;
  let mantenimientosPendientes = 0;
  for (const fila of entradas.solicitudes) {
    if (
      fila.estado !== EstadoSolicitudMantenimiento.PENDIENTE &&
      fila.estado !== EstadoSolicitudMantenimiento.EN_PROCESO
    ) {
      continue;
    }
    solicitudesAbiertas += fila.cantidad;
    if (fila.urgencia === URGENCIA_MAS_ALTA) {
      solicitudesUrgentes += fila.cantidad;
    }
    if (fila.estado === EstadoSolicitudMantenimiento.PENDIENTE) {
      mantenimientosPendientes += fila.cantidad;
    }
  }

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
      unidades: entradas.unidades.length,
      ocupadas: ocupadas.size,
      libres: Math.max(0, entradas.unidades.length - ocupadas.size),
      con_contrato_programado: conProgramado.size,
      porcentaje: porcentaje(ocupadas.size, entradas.unidades.length),
      unidades_detalle: unidadesDetalle,
    },
    mora,
    morosos: morosos.slice(0, MAXIMO_MOROSOS),
    tendencia,
    anio,
    por_inmueble: porInmueble,
    pendientes: {
      comprobantes_por_validar: entradas.comprobantes_pendientes,
      mantenimientos_pendientes: mantenimientosPendientes,
      solicitudes_abiertas: {
        total: solicitudesAbiertas,
        urgentes: solicitudesUrgentes,
      },
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
