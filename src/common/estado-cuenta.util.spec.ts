import {
  calcularEstadoCuenta,
  DatosContratoParaEstadoCuenta,
  DatosIncrementoParaEstadoCuenta,
  DatosPagoParaEstadoCuenta,
  derivarEstadoPagoContrato,
  PeriodoEstadoCuenta,
} from './estado-cuenta.util';

describe('calcularEstadoCuenta', () => {
  it('contrato nuevo sin pagos: el primer período queda PENDIENTE, nunca VENCIDO (B-05b)', () => {
    const contrato: DatosContratoParaEstadoCuenta = {
      fecha_inicio: new Date(Date.UTC(2026, 8, 20)), // 2026-09-20
      fecha_fin: new Date(Date.UTC(2027, 8, 19)),
      dia_pago: 5,
      canon_centavos: 1_000_000,
    };
    const hoy = new Date(Date.UTC(2026, 8, 21)); // 2026-09-21

    const periodos = calcularEstadoCuenta(contrato, [], [], hoy);

    expect(periodos).toHaveLength(1);
    expect(periodos[0].periodo.getTime()).toBe(Date.UTC(2026, 9, 1));
    expect(periodos[0].fecha_limite.getTime()).toBe(Date.UTC(2026, 9, 5));
    expect(periodos[0].estado).toBe('PENDIENTE');
  });

  it('pago anticipado (antes de la fecha límite) por el canon completo: PAGADO (B-05a)', () => {
    const contrato: DatosContratoParaEstadoCuenta = {
      fecha_inicio: new Date(Date.UTC(2026, 8, 20)),
      fecha_fin: new Date(Date.UTC(2027, 8, 19)),
      dia_pago: 5,
      canon_centavos: 1_000_000,
    };
    const pagos: DatosPagoParaEstadoCuenta[] = [
      {
        periodo: new Date(Date.UTC(2026, 9, 1)),
        estado: 'APROBADO',
        monto_centavos: 1_000_000,
      },
    ];
    const hoy = new Date(Date.UTC(2026, 9, 4)); // 2026-10-04, antes de la fecha límite (10-05)

    const periodos = calcularEstadoCuenta(contrato, [], pagos, hoy);

    expect(periodos).toHaveLength(1);
    expect(periodos[0].estado).toBe('PAGADO');
    expect(periodos[0].monto_aprobado_centavos).toBe(1_000_000);
  });

  it('meses cortos: el ajuste de día se recalcula mes a mes, sin contagiar febrero a marzo', () => {
    const contrato: DatosContratoParaEstadoCuenta = {
      fecha_inicio: new Date(Date.UTC(2026, 0, 15)), // 2026-01-15
      fecha_fin: new Date(Date.UTC(2027, 0, 14)),
      dia_pago: 31,
      canon_centavos: 1_000_000,
    };
    const hoy = new Date(Date.UTC(2026, 3, 1)); // 2026-04-01

    const periodos = calcularEstadoCuenta(contrato, [], [], hoy);

    expect(periodos[0].fecha_limite.getTime()).toBe(Date.UTC(2026, 0, 31));
    expect(periodos[1].fecha_limite.getTime()).toBe(Date.UTC(2026, 1, 28)); // 2026 no es bisiesto
    expect(periodos[2].fecha_limite.getTime()).toBe(Date.UTC(2026, 2, 31)); // marzo no hereda el recorte de febrero
  });

  it('pago parcial en un período ya vencido: PARCIAL con el monto parcial', () => {
    const contrato: DatosContratoParaEstadoCuenta = {
      fecha_inicio: new Date(Date.UTC(2026, 0, 10)), // 2026-01-10
      fecha_fin: new Date(Date.UTC(2027, 0, 9)),
      dia_pago: 10,
      canon_centavos: 1_000_000,
    };
    const pagos: DatosPagoParaEstadoCuenta[] = [
      {
        periodo: new Date(Date.UTC(2026, 0, 1)),
        estado: 'APROBADO',
        monto_centavos: 400_000,
      },
    ];
    const hoy = new Date(Date.UTC(2026, 0, 15)); // posterior a fecha_limite (01-10) + 1 día

    const periodos = calcularEstadoCuenta(contrato, [], pagos, hoy);

    const periodoEnero = periodos[0];
    expect(periodoEnero.fecha_limite.getTime()).toBe(Date.UTC(2026, 0, 10));
    expect(periodoEnero.estado).toBe('PARCIAL');
    expect(periodoEnero.monto_aprobado_centavos).toBe(400_000);
  });

  it('incremento a mitad de año: los períodos antes del incremento usan el canon base y los posteriores el nuevo', () => {
    const contrato: DatosContratoParaEstadoCuenta = {
      fecha_inicio: new Date(Date.UTC(2026, 0, 5)), // 2026-01-05
      fecha_fin: new Date(Date.UTC(2027, 0, 4)),
      dia_pago: 5,
      canon_centavos: 1_000_000,
    };
    const incrementos: DatosIncrementoParaEstadoCuenta[] = [
      {
        fecha_aplicacion: new Date(Date.UTC(2026, 5, 5)), // 2026-06-05, justo la fecha límite de junio
        canon_nuevo_centavos: 1_100_000,
      },
    ];
    const hoy = new Date(Date.UTC(2026, 7, 1)); // 2026-08-01

    const periodos = calcularEstadoCuenta(contrato, incrementos, [], hoy);

    // Enero..Mayo (fecha_limite anterior al incremento): canon base.
    for (let indice = 0; indice < 5; indice += 1) {
      expect(periodos[indice].canon_vigente_centavos).toBe(1_000_000);
    }
    // Junio en adelante (fecha_limite >= fecha_aplicacion): canon nuevo.
    for (let indice = 5; indice < periodos.length; indice += 1) {
      expect(periodos[indice].canon_vigente_centavos).toBe(1_100_000);
    }
  });

  it('fecha_fin a mitad de mes: el último período vence exactamente en fecha_fin, sin período posterior', () => {
    const contrato: DatosContratoParaEstadoCuenta = {
      fecha_inicio: new Date(Date.UTC(2026, 0, 5)), // 2026-01-05
      fecha_fin: new Date(Date.UTC(2026, 10, 15)), // 2026-11-15
      dia_pago: 5,
      canon_centavos: 1_000_000,
    };
    const hoy = new Date(Date.UTC(2027, 0, 1)); // muy posterior, para no cortar por "hoy"

    const periodos = calcularEstadoCuenta(contrato, [], [], hoy);

    const ultimo = periodos[periodos.length - 1];
    expect(ultimo.fecha_limite.getTime()).toBe(Date.UTC(2026, 10, 15));
    // La clave de mes del último período es la de su fecha límite SIN recortar (diciembre).
    expect(ultimo.periodo.getTime()).toBe(Date.UTC(2026, 11, 1));

    for (const periodo of periodos) {
      expect(periodo.fecha_limite.getTime()).toBeLessThanOrEqual(
        Date.UTC(2026, 10, 15),
      );
    }
  });

  it('con dos o más incrementos, usa el más reciente aplicable (no el primero ni el último de la lista sin filtrar)', () => {
    const contrato: DatosContratoParaEstadoCuenta = {
      fecha_inicio: new Date(Date.UTC(2026, 0, 1)), // 2026-01-01
      fecha_fin: new Date(Date.UTC(2027, 0, 1)),
      dia_pago: 1,
      canon_centavos: 1_000_000,
    };
    // Orden deliberadamente desordenado: ni el primero ni el último del
    // arreglo son el "más reciente aplicable" en todos los casos.
    const incrementos: DatosIncrementoParaEstadoCuenta[] = [
      {
        fecha_aplicacion: new Date(Date.UTC(2026, 6, 1)), // julio
        canon_nuevo_centavos: 1_300_000,
      },
      {
        fecha_aplicacion: new Date(Date.UTC(2026, 4, 1)), // mayo
        canon_nuevo_centavos: 1_200_000,
      },
      {
        fecha_aplicacion: new Date(Date.UTC(2026, 2, 1)), // marzo
        canon_nuevo_centavos: 1_100_000,
      },
    ];
    const hoy = new Date(Date.UTC(2026, 8, 1)); // 2026-09-01

    const periodos = calcularEstadoCuenta(contrato, incrementos, [], hoy);

    // Período de fecha_limite = 2026-02-01: ningún incremento aplica todavía.
    expect(periodos[1].fecha_limite.getTime()).toBe(Date.UTC(2026, 1, 1));
    expect(periodos[1].canon_vigente_centavos).toBe(1_000_000);

    // Período de fecha_limite = 2026-05-01: aplican marzo y mayo; el más
    // reciente es mayo (1.200.000), no marzo (el primero cronológicamente)
    // ni julio (el primer elemento del arreglo).
    expect(periodos[4].fecha_limite.getTime()).toBe(Date.UTC(2026, 4, 1));
    expect(periodos[4].canon_vigente_centavos).toBe(1_200_000);

    // Período de fecha_limite = 2026-08-01: los tres incrementos aplican;
    // el más reciente es julio (1.300.000).
    expect(periodos[7].fecha_limite.getTime()).toBe(Date.UTC(2026, 7, 1));
    expect(periodos[7].canon_vigente_centavos).toBe(1_300_000);
  });

  it('un pago PENDIENTE (sin aprobar) en un período ya vencido: EN_REVISION, no VENCIDO', () => {
    const contrato: DatosContratoParaEstadoCuenta = {
      fecha_inicio: new Date(Date.UTC(2026, 0, 10)), // 2026-01-10
      fecha_fin: new Date(Date.UTC(2027, 0, 9)),
      dia_pago: 10,
      canon_centavos: 1_000_000,
    };
    const pagos: DatosPagoParaEstadoCuenta[] = [
      {
        periodo: new Date(Date.UTC(2026, 0, 1)),
        estado: 'PENDIENTE',
        monto_centavos: 1_000_000,
      },
    ];
    const hoy = new Date(Date.UTC(2026, 1, 20)); // muy posterior a la fecha límite

    const periodos = calcularEstadoCuenta(contrato, [], pagos, hoy);

    expect(periodos[0].fecha_limite.getTime()).toBe(Date.UTC(2026, 0, 10));
    expect(periodos[0].estado).toBe('EN_REVISION');
    expect(periodos[0].monto_aprobado_centavos).toBe(0);
  });

  it('no genera períodos después de "hoy" ni después de fecha_fin', () => {
    const contrato: DatosContratoParaEstadoCuenta = {
      fecha_inicio: new Date(Date.UTC(2026, 0, 1)),
      fecha_fin: new Date(Date.UTC(2026, 11, 31)),
      dia_pago: 1,
      canon_centavos: 1_000_000,
    };
    const hoy = new Date(Date.UTC(2026, 0, 1)); // mismo día del inicio

    const periodos = calcularEstadoCuenta(contrato, [], [], hoy);

    expect(periodos).toHaveLength(1);
  });
});

describe('derivarEstadoPagoContrato', () => {
  function periodo(
    overrides: Partial<PeriodoEstadoCuenta>,
  ): PeriodoEstadoCuenta {
    return {
      periodo: new Date(Date.UTC(2026, 0, 1)),
      fecha_limite: new Date(Date.UTC(2026, 0, 5)),
      canon_vigente_centavos: 1_000_000,
      monto_aprobado_centavos: 1_000_000,
      estado: 'PAGADO',
      ...overrides,
    };
  }

  it('devuelve PENDIENTE cuando no hay ningún período generado', () => {
    expect(derivarEstadoPagoContrato([])).toBe('PENDIENTE');
  });

  it('devuelve PENDIENTE cuando el único período generado está PENDIENTE (contrato recién iniciado)', () => {
    const periodos = [periodo({ estado: 'PENDIENTE' })];
    expect(derivarEstadoPagoContrato(periodos)).toBe('PENDIENTE');
  });

  it('devuelve AL_DIA cuando ningún período está VENCIDO ni PARCIAL', () => {
    const periodos = [
      periodo({ estado: 'PAGADO' }),
      periodo({ estado: 'PENDIENTE' }),
      periodo({ estado: 'EN_REVISION' }),
    ];
    expect(derivarEstadoPagoContrato(periodos)).toBe('AL_DIA');
  });

  it('devuelve EN_MORA cuando algún período está VENCIDO', () => {
    const periodos = [
      periodo({ estado: 'PAGADO' }),
      periodo({ estado: 'VENCIDO' }),
    ];
    expect(derivarEstadoPagoContrato(periodos)).toBe('EN_MORA');
  });

  it('devuelve EN_MORA cuando algún período está PARCIAL', () => {
    const periodos = [
      periodo({ estado: 'PENDIENTE' }),
      periodo({ estado: 'PARCIAL' }),
    ];
    expect(derivarEstadoPagoContrato(periodos)).toBe('EN_MORA');
  });
});
