export type EstadoPeriodo =
  'PAGADO' | 'EN_REVISION' | 'PENDIENTE' | 'VENCIDO' | 'PARCIAL';

export interface DatosContratoParaEstadoCuenta {
  fecha_inicio: Date; // @db.Date de Prisma (medianoche UTC)
  fecha_fin: Date; // @db.Date de Prisma
  dia_pago: number; // 1-31
  canon_centavos: number; // canon base, antes de cualquier incremento
}

export interface DatosIncrementoParaEstadoCuenta {
  fecha_aplicacion: Date; // @db.Date de Prisma
  canon_nuevo_centavos: number;
}

export interface DatosPagoParaEstadoCuenta {
  periodo: Date; // primer día del mes que cubre (ver Pago.periodo, se agrega en B0.2-B)
  estado: 'PENDIENTE' | 'APROBADO' | 'RECHAZADO' | 'REEMPLAZADO';
  monto_centavos: number;
}

export interface PeriodoEstadoCuenta {
  periodo: Date; // primer día del mes que cubre
  fecha_limite: Date; // fecha límite de pago de ese período
  canon_vigente_centavos: number;
  monto_aprobado_centavos: number; // suma de pagos APROBADOS de ese período
  estado: EstadoPeriodo;
}

export type EstadoPagoContratoDerivado = 'AL_DIA' | 'PENDIENTE' | 'EN_MORA';

export interface RespuestaEstadoCuenta {
  estadoPago: 'al_dia' | 'en_mora' | 'pendiente';
  periodos: Array<{
    periodo: Date;
    fechaLimite: Date;
    canonVigenteCentavos: number;
    estado: EstadoPeriodo;
    montoAprobadoCentavos: number;
  }>;
}

function ultimoDiaDelMesUTC(anio: number, mesIndiceCero: number): number {
  return new Date(Date.UTC(anio, mesIndiceCero + 1, 0)).getUTCDate();
}

function fechaConDiaAjustadoUTC(
  anio: number,
  mesIndiceCero: number,
  diaDeseado: number,
): Date {
  const ultimoDia = ultimoDiaDelMesUTC(anio, mesIndiceCero);
  const diaAjustado = Math.min(diaDeseado, ultimoDia);
  return new Date(Date.UTC(anio, mesIndiceCero, diaAjustado));
}

/**
 * Primer día con día-de-mes igual a `diaPago` (ajustado si el mes es más
 * corto) que sea igual o posterior a `fechaInicioPeriodo`. El ajuste de
 * día se recalcula mes a mes: no arrastra el recorte de un mes corto al
 * mes siguiente.
 */
function calcularFechaLimitePeriodo(
  diaPago: number,
  fechaInicioPeriodo: Date,
): Date {
  const anio = fechaInicioPeriodo.getUTCFullYear();
  const mes = fechaInicioPeriodo.getUTCMonth();

  const candidatoMismoMes = fechaConDiaAjustadoUTC(anio, mes, diaPago);
  if (candidatoMismoMes.getTime() >= fechaInicioPeriodo.getTime()) {
    return candidatoMismoMes;
  }

  return fechaConDiaAjustadoUTC(anio, mes + 1, diaPago);
}

function sumarUnDiaUTC(fecha: Date): Date {
  return new Date(
    Date.UTC(
      fecha.getUTCFullYear(),
      fecha.getUTCMonth(),
      fecha.getUTCDate() + 1,
    ),
  );
}

function mismoMesCalendarioUTC(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth()
  );
}

function canonVigenteEn(
  contrato: DatosContratoParaEstadoCuenta,
  incrementos: DatosIncrementoParaEstadoCuenta[],
  fechaLimite: Date,
): number {
  const aplicables = incrementos.filter(
    (incremento) =>
      incremento.fecha_aplicacion.getTime() <= fechaLimite.getTime(),
  );
  if (aplicables.length === 0) {
    return contrato.canon_centavos;
  }
  const masReciente = aplicables.reduce((masRecienteHastaAhora, actual) =>
    actual.fecha_aplicacion.getTime() >
    masRecienteHastaAhora.fecha_aplicacion.getTime()
      ? actual
      : masRecienteHastaAhora,
  );
  return masReciente.canon_nuevo_centavos;
}

export function calcularEstadoCuenta(
  contrato: DatosContratoParaEstadoCuenta,
  incrementos: DatosIncrementoParaEstadoCuenta[],
  pagos: DatosPagoParaEstadoCuenta[],
  hoy: Date,
): PeriodoEstadoCuenta[] {
  const periodos: PeriodoEstadoCuenta[] = [];
  let inicioPeriodo = contrato.fecha_inicio;

  while (
    inicioPeriodo.getTime() <= hoy.getTime() &&
    inicioPeriodo.getTime() <= contrato.fecha_fin.getTime()
  ) {
    const fechaLimiteCalculada = calcularFechaLimitePeriodo(
      contrato.dia_pago,
      inicioPeriodo,
    );

    // La clave de mes se calcula sobre la fecha límite SIN el tope de
    // fecha_fin: el recorte del último período no debe cambiar a qué mes
    // calendario pertenece.
    const clavePeriodo = new Date(
      Date.UTC(
        fechaLimiteCalculada.getUTCFullYear(),
        fechaLimiteCalculada.getUTCMonth(),
        1,
      ),
    );

    const fechaLimite =
      fechaLimiteCalculada.getTime() > contrato.fecha_fin.getTime()
        ? contrato.fecha_fin
        : fechaLimiteCalculada;

    const canonVigente = canonVigenteEn(contrato, incrementos, fechaLimite);

    const pagosDelPeriodo = pagos.filter((pago) =>
      mismoMesCalendarioUTC(pago.periodo, clavePeriodo),
    );
    const montoAprobado = pagosDelPeriodo
      .filter((pago) => pago.estado === 'APROBADO')
      .reduce((suma, pago) => suma + pago.monto_centavos, 0);
    const hayPagoEnRevision = pagosDelPeriodo.some(
      (pago) => pago.estado === 'PENDIENTE',
    );

    let estado: EstadoPeriodo;
    if (montoAprobado >= canonVigente) {
      estado = 'PAGADO';
    } else if (hayPagoEnRevision) {
      estado = 'EN_REVISION';
    } else if (hoy.getTime() <= fechaLimite.getTime()) {
      estado = 'PENDIENTE';
    } else if (montoAprobado > 0) {
      estado = 'PARCIAL';
    } else {
      estado = 'VENCIDO';
    }

    periodos.push({
      periodo: clavePeriodo,
      fecha_limite: fechaLimite,
      canon_vigente_centavos: canonVigente,
      monto_aprobado_centavos: montoAprobado,
      estado,
    });

    inicioPeriodo = sumarUnDiaUTC(fechaLimiteCalculada);
  }

  return periodos;
}

/**
 * Deriva el estado de pago del contrato a partir de sus períodos:
 * `PENDIENTE` si todavía no hay ningún período generado, `EN_MORA` si algún
 * período quedó `VENCIDO` o `PARCIAL`, `AL_DIA` en cualquier otro caso.
 */
export function derivarEstadoPagoContrato(
  periodos: PeriodoEstadoCuenta[],
): EstadoPagoContratoDerivado {
  if (periodos.length === 0) {
    return 'PENDIENTE';
  }
  const hayPeriodoEnMora = periodos.some(
    (periodo) => periodo.estado === 'VENCIDO' || periodo.estado === 'PARCIAL',
  );
  return hayPeriodoEnMora ? 'EN_MORA' : 'AL_DIA';
}

/**
 * Da forma a la respuesta pública de los endpoints de estado de cuenta
 * (`GET /contratos/:id/estado-cuenta` y `GET /inquilino/mi-contrato/estado-cuenta`).
 */
export function construirRespuestaEstadoCuenta(
  periodos: PeriodoEstadoCuenta[],
): RespuestaEstadoCuenta {
  const estadoDerivado = derivarEstadoPagoContrato(periodos);
  const estadoPago =
    estadoDerivado === 'AL_DIA'
      ? 'al_dia'
      : estadoDerivado === 'EN_MORA'
        ? 'en_mora'
        : 'pendiente';

  return {
    estadoPago,
    periodos: periodos.map((periodo) => ({
      periodo: periodo.periodo,
      fechaLimite: periodo.fecha_limite,
      canonVigenteCentavos: periodo.canon_vigente_centavos,
      estado: periodo.estado,
      montoAprobadoCentavos: periodo.monto_aprobado_centavos,
    })),
  };
}
