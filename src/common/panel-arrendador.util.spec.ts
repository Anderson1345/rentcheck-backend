import { EstadoContrato, RolSolicitante } from '@prisma/client';
import { hoyEnBogota } from './hoy-bogota.util';
import {
  construirPanel,
  ContratoParaPanel,
  EntradasPanel,
  PagoParaPanel,
} from './panel-arrendador.util';

// Fechas inyectadas (nunca el reloj del sistema): ninguna prueba depende del día en que se corre.
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const HOY = d('2026-10-02');

function contrato(extra: Partial<ContratoParaPanel> = {}): ContratoParaPanel {
  return {
    id: 'c1',
    unidad_id: 'u1',
    unidad: 'Apto 101',
    inmueble: 'Calle 45 # 12-30',
    estado: EstadoContrato.ACTIVO,
    fecha_inicio: d('2026-09-01'),
    fecha_fin: d('2027-08-31'),
    dia_pago: 5,
    canon_centavos: 1_000_000,
    terminacionAnticipadaSolicitada: false,
    terminacionAnticipadaSolicitadaPor: null,
    terminacionAnticipadaSolicitadaEn: null,
    terminacionAnticipadaMotivo: null,
    terminacionAnticipadaConfirmadaEn: null,
    terminacion_fecha_efectiva: null,
    terminacion_confirmada_por: null,
    incrementos_ipc: [],
    pagos: [],
    ...extra,
  };
}

function pago(
  periodo: string,
  estado: PagoParaPanel['estado'],
  monto: number,
  fechaReportada = periodo,
): PagoParaPanel {
  return {
    periodo: d(periodo),
    estado,
    monto_centavos: monto,
    fecha_reportada: d(fechaReportada),
  };
}

function entradas(extra: Partial<EntradasPanel> = {}): EntradasPanel {
  return {
    contratos: [],
    unidades_total: 0,
    comprobantes_pendientes: 0,
    mantenimientos_pendientes: 0,
    ipc_configurado: true,
    ...extra,
  };
}

const MILLON = 1_000_000;

describe('construirPanel: sin datos', () => {
  it('todo en cero, mes y fecha de hoy, y la tendencia con 6 meses en cero', () => {
    const panel = construirPanel(entradas(), HOY);
    expect(panel).toEqual({
      mes: '2026-10',
      calculado_para: '2026-10-02',
      ingresos_mes_centavos: 0,
      recaudo: {
        esperado_centavos: 0,
        aprobado_centavos: 0,
        en_revision_centavos: 0,
        sin_reportar_centavos: 0,
        contratos: 0,
      },
      ocupacion: {
        unidades: 0,
        ocupadas: 0,
        libres: 0,
        con_contrato_programado: 0,
      },
      mora: { contratos: 0, periodos: 0, total_centavos: 0 },
      tendencia: [
        { mes: '2026-05', ingresos_centavos: 0 },
        { mes: '2026-06', ingresos_centavos: 0 },
        { mes: '2026-07', ingresos_centavos: 0 },
        { mes: '2026-08', ingresos_centavos: 0 },
        { mes: '2026-09', ingresos_centavos: 0 },
        { mes: '2026-10', ingresos_centavos: 0 },
      ],
      pendientes: {
        comprobantes_por_validar: 0,
        mantenimientos_pendientes: 0,
        contratos_por_vencer: { cantidad: 0, contratos: [] },
        incrementos_disponibles: { cantidad: 0, contratos: [] },
        terminaciones_por_confirmar: { cantidad: 0, contratos: [] },
      },
    });
  });
});

describe('recaudo del mes', () => {
  // A: octubre pagado; B: aprobado parcial + pendiente; C: sin reportar; D: septiembre parcial.
  const contratos = [
    contrato({
      id: 'a',
      unidad_id: 'ua',
      pagos: [
        pago('2026-09-01', 'APROBADO', MILLON, '2026-09-03'),
        pago('2026-10-01', 'APROBADO', MILLON, '2026-10-01'),
      ],
    }),
    contrato({
      id: 'b',
      unidad_id: 'ub',
      pagos: [
        pago('2026-09-01', 'APROBADO', MILLON, '2026-09-04'),
        pago('2026-10-01', 'APROBADO', 400_000, '2026-10-01'),
        pago('2026-10-01', 'PENDIENTE', 900_000, '2026-10-02'),
      ],
    }),
    contrato({
      id: 'c',
      unidad_id: 'uc',
      pagos: [pago('2026-09-01', 'APROBADO', MILLON, '2026-09-05')],
    }),
    contrato({
      id: 'd',
      unidad_id: 'ud',
      pagos: [pago('2026-09-01', 'APROBADO', 400_000, '2026-09-05')],
    }),
  ];

  it('esperado = aprobado + en revisión + sin reportar, por contrato y en total', () => {
    const { recaudo } = construirPanel(
      entradas({ contratos, unidades_total: 4 }),
      HOY,
    );
    expect(recaudo.esperado_centavos).toBe(4 * MILLON);
    expect(recaudo.aprobado_centavos).toBe(MILLON + 400_000);
    // El pendiente de 900.000 no pasa del saldo: 1.000.000 − 400.000 = 600.000.
    expect(recaudo.en_revision_centavos).toBe(600_000);
    expect(recaudo.sin_reportar_centavos).toBe(2 * MILLON);
    expect(recaudo.contratos).toBe(4);
    expect(
      recaudo.aprobado_centavos +
        recaudo.en_revision_centavos +
        recaudo.sin_reportar_centavos,
    ).toBe(recaudo.esperado_centavos);

    for (const c of contratos) {
      const solo = construirPanel(
        entradas({ contratos: [c], unidades_total: 1 }),
        HOY,
      ).recaudo;
      expect(
        solo.aprobado_centavos +
          solo.en_revision_centavos +
          solo.sin_reportar_centavos,
      ).toBe(solo.esperado_centavos);
    }
  });

  it('un pendiente menor al saldo cuenta completo', () => {
    const c = contrato({
      pagos: [
        pago('2026-09-01', 'APROBADO', MILLON),
        pago('2026-10-01', 'PENDIENTE', 300_000),
      ],
    });
    const { recaudo } = construirPanel(
      entradas({ contratos: [c], unidades_total: 1 }),
      HOY,
    );
    expect(recaudo.en_revision_centavos).toBe(300_000);
    expect(recaudo.sin_reportar_centavos).toBe(700_000);
    expect(recaudo.aprobado_centavos).toBe(0);
  });

  it('un sobrepago limita lo aprobado al canon, pero los ingresos no tienen tope', () => {
    const c = contrato({
      pagos: [
        pago('2026-09-01', 'APROBADO', MILLON, '2026-09-03'),
        pago('2026-10-01', 'APROBADO', 1_500_000, '2026-10-01'),
      ],
    });
    const panel = construirPanel(
      entradas({ contratos: [c], unidades_total: 1 }),
      HOY,
    );
    expect(panel.recaudo.esperado_centavos).toBe(MILLON);
    expect(panel.recaudo.aprobado_centavos).toBe(MILLON);
    expect(panel.recaudo.sin_reportar_centavos).toBe(0);
    expect(panel.ingresos_mes_centavos).toBe(1_500_000);
  });

  it('el canon de cada período sale del historial de incrementos, no del canon de hoy', () => {
    // Canon 1.000.000 hasta el 20/09 y 1.100.000 desde entonces: septiembre (límite 5/09) usa el
    // viejo y octubre (límite 5/10) el nuevo.
    const c = contrato({
      canon_centavos: 1_100_000,
      incrementos_ipc: [
        {
          fecha_aplicacion: d('2026-09-20'),
          canon_anterior_centavos: MILLON,
          canon_nuevo_centavos: 1_100_000,
        },
      ],
      pagos: [pago('2026-09-01', 'APROBADO', MILLON, '2026-09-03')],
    });
    const panel = construirPanel(
      entradas({ contratos: [c], unidades_total: 1 }),
      HOY,
    );
    expect(panel.recaudo.esperado_centavos).toBe(1_100_000);
    // Septiembre quedó pagado con el canon viejo: no hay mora.
    expect(panel.mora).toEqual({
      contratos: 0,
      periodos: 0,
      total_centavos: 0,
    });
  });

  it('un contrato que empieza a mitad de mes tiene su primer período en el mes de su primera fecha límite', () => {
    const c = contrato({ fecha_inicio: d('2026-09-20') });
    const panel = construirPanel(
      entradas({ contratos: [c], unidades_total: 1 }),
      HOY,
    );
    // Primer período: límite 5/10 → es el de octubre, y sí está en el mes.
    expect(panel.recaudo.contratos).toBe(1);
    const nuevo = contrato({ fecha_inicio: d('2026-10-01'), dia_pago: 3 });
    expect(
      construirPanel(entradas({ contratos: [nuevo], unidades_total: 1 }), HOY)
        .recaudo.contratos,
    ).toBe(1);
  });
});

describe('mora', () => {
  it('cuenta VENCIDO y PARCIAL con su saldo (canon − aprobado); EN_REVISION no es mora', () => {
    const vencido = contrato({
      id: 'v',
      unidad_id: 'uv',
      fecha_inicio: d('2026-08-01'),
    });
    const parcial = contrato({
      id: 'p',
      unidad_id: 'up',
      pagos: [pago('2026-09-01', 'APROBADO', 400_000)],
    });
    const enRevision = contrato({
      id: 'r',
      unidad_id: 'ur',
      pagos: [pago('2026-09-01', 'PENDIENTE', MILLON)],
    });
    const panel = construirPanel(
      entradas({
        contratos: [vencido, parcial, enRevision],
        unidades_total: 3,
      }),
      HOY,
    );
    // vencido: agosto y septiembre sin pago (2 períodos de 1.000.000); parcial: septiembre, saldo 600.000.
    expect(panel.mora.periodos).toBe(3);
    expect(panel.mora.contratos).toBe(2);
    expect(panel.mora.total_centavos).toBe(2 * MILLON + 600_000);
  });

  it('incluye contratos VENCIDO y TERMINADO_ANTICIPADAMENTE con deuda', () => {
    const cerrado = contrato({
      id: 'x',
      unidad_id: 'ux',
      estado: EstadoContrato.VENCIDO,
      fecha_inicio: d('2026-06-01'),
      fecha_fin: d('2026-08-31'),
    });
    const terminado = contrato({
      id: 'y',
      unidad_id: 'uy',
      estado: EstadoContrato.TERMINADO_ANTICIPADAMENTE,
      fecha_inicio: d('2026-06-01'),
      fecha_fin: d('2027-05-31'),
      terminacionAnticipadaSolicitada: true,
      terminacionAnticipadaConfirmadaEn: new Date('2026-07-20T15:00:00.000Z'),
      terminacion_fecha_efectiva: d('2026-07-31'),
    });
    const panel = construirPanel(
      entradas({ contratos: [cerrado, terminado], unidades_total: 2 }),
      HOY,
    );
    // cerrado: junio, julio, agosto y el último período, recortado a la fecha de fin (clave de
    // septiembre); terminado: junio, julio y el recortado a la fecha efectiva (clave de agosto).
    expect(panel.mora.periodos).toBe(7);
    expect(panel.mora.contratos).toBe(2);
    expect(panel.mora.total_centavos).toBe(7 * MILLON);
    // Sin períodos en octubre: no entran al recaudo del mes.
    expect(panel.recaudo.contratos).toBe(0);
  });

  it('un contrato PROGRAMADO o CANCELADO no genera períodos, ni mora ni recaudo', () => {
    const programado = contrato({
      id: 'pr',
      unidad_id: 'upr',
      estado: EstadoContrato.PROGRAMADO,
      fecha_inicio: d('2026-11-01'),
      fecha_fin: d('2027-10-31'),
    });
    const cancelado = contrato({
      id: 'ca',
      unidad_id: 'uca',
      estado: EstadoContrato.CANCELADO,
    });
    const panel = construirPanel(
      entradas({ contratos: [programado, cancelado], unidades_total: 2 }),
      HOY,
    );
    expect(panel.mora).toEqual({
      contratos: 0,
      periodos: 0,
      total_centavos: 0,
    });
    expect(panel.recaudo.esperado_centavos).toBe(0);
    expect(panel.recaudo.contratos).toBe(0);
  });
});

describe('ocupación', () => {
  it('ocupadas = con contrato ACTIVO; libres = el resto; con_contrato_programado es subconjunto de libres', () => {
    const contratos = [
      contrato({ id: 'a', unidad_id: 'u1', estado: EstadoContrato.ACTIVO }),
      contrato({
        id: 'b',
        unidad_id: 'u2',
        estado: EstadoContrato.PROGRAMADO,
        fecha_inicio: d('2026-12-01'),
      }),
      // u1 también tiene uno programado: sigue ocupada y no cuenta como "con programado".
      contrato({
        id: 'c',
        unidad_id: 'u1',
        estado: EstadoContrato.PROGRAMADO,
        fecha_inicio: d('2027-09-01'),
      }),
      contrato({
        id: 'd',
        unidad_id: 'u3',
        estado: EstadoContrato.VENCIDO,
        fecha_fin: d('2026-05-31'),
      }),
    ];
    const { ocupacion } = construirPanel(
      entradas({ contratos, unidades_total: 5 }),
      HOY,
    );
    expect(ocupacion).toEqual({
      unidades: 5,
      ocupadas: 1,
      libres: 4,
      con_contrato_programado: 1,
    });
  });
});

describe('ingresos del mes y tendencia (por fecha_reportada)', () => {
  const unPago = (
    fecha: string,
    monto: number,
    estado: PagoParaPanel['estado'] = 'APROBADO',
  ) => pago('2026-09-01', estado, monto, fecha);

  it('suma solo APROBADOS con fecha_reportada en el mes: 1 del mes cuenta, 31 del anterior no', () => {
    const c = contrato({
      pagos: [
        unPago('2026-10-01', 100),
        unPago('2026-09-30', 7_000),
        unPago('2026-10-02', 20),
        unPago('2026-10-02', 5_000, 'PENDIENTE'),
        unPago('2026-10-02', 6_000, 'REEMPLAZADO'),
        unPago('2026-10-02', 8_000, 'RECHAZADO'),
      ],
    });
    const panel = construirPanel(
      entradas({ contratos: [c], unidades_total: 1 }),
      HOY,
    );
    expect(panel.ingresos_mes_centavos).toBe(120);
    expect(panel.tendencia[panel.tendencia.length - 1]).toEqual({
      mes: '2026-10',
      ingresos_centavos: 120,
    });
    expect(panel.tendencia[panel.tendencia.length - 2]).toEqual({
      mes: '2026-09',
      ingresos_centavos: 7_000,
    });
  });

  it('siempre son 6 meses ascendentes y cruzan el cambio de año', () => {
    const panel = construirPanel(entradas(), d('2027-01-15'));
    expect(panel.mes).toBe('2027-01');
    expect(panel.tendencia.map((t) => t.mes)).toEqual([
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
    ]);
  });

  it('31 de diciembre: el mes es diciembre y el pago de enero no cuenta', () => {
    const c = contrato({
      pagos: [unPago('2026-12-31', 500), unPago('2027-01-01', 900)],
    });
    const panel = construirPanel(
      entradas({ contratos: [c], unidades_total: 1 }),
      d('2026-12-31'),
    );
    expect(panel.mes).toBe('2026-12');
    expect(panel.ingresos_mes_centavos).toBe(500);
    expect(panel.tendencia).toHaveLength(6);
    expect(panel.tendencia[0].mes).toBe('2026-07');
  });

  it('29 de febrero (año bisiesto): mes y tendencia correctos', () => {
    const panel = construirPanel(entradas(), d('2028-02-29'));
    expect(panel.mes).toBe('2028-02');
    expect(panel.calculado_para).toBe('2028-02-29');
    expect(panel.tendencia.map((t) => t.mes)).toEqual([
      '2027-09',
      '2027-10',
      '2027-11',
      '2027-12',
      '2028-01',
      '2028-02',
    ]);
  });

  it('los pagos más viejos que la ventana de 6 meses se ignoran', () => {
    const c = contrato({
      pagos: [unPago('2026-04-30', 777), unPago('2026-05-01', 111)],
    });
    const panel = construirPanel(
      entradas({ contratos: [c], unidades_total: 1 }),
      HOY,
    );
    expect(panel.tendencia[0]).toEqual({
      mes: '2026-05',
      ingresos_centavos: 111,
    });
    expect(panel.tendencia.reduce((s, t) => s + t.ingresos_centavos, 0)).toBe(
      111,
    );
  });

  it('no se desplaza de mes entre las 7 p. m. y la medianoche de Bogotá (hoy llega de hoyEnBogota)', () => {
    // 31/10 a las 23:59 en Bogotá = 01/11 04:59 UTC; 01/11 00:00 en Bogotá = 01/11 05:00 UTC.
    const antes = construirPanel(
      entradas(),
      hoyEnBogota(new Date('2026-11-01T04:59:00.000Z')),
    );
    expect(antes.mes).toBe('2026-10');
    expect(antes.calculado_para).toBe('2026-10-31');
    const despues = construirPanel(
      entradas(),
      hoyEnBogota(new Date('2026-11-01T05:00:00.000Z')),
    );
    expect(despues.mes).toBe('2026-11');
    expect(despues.calculado_para).toBe('2026-11-01');
    // 7 p. m. en Bogotá del último día del año: todavía diciembre.
    const fin = construirPanel(
      entradas(),
      hoyEnBogota(new Date('2027-01-01T00:30:00.000Z')),
    );
    expect(fin.mes).toBe('2026-12');
  });
});

describe('pendientes', () => {
  it('copia los conteos de comprobantes y mantenimiento', () => {
    const { pendientes } = construirPanel(
      entradas({ comprobantes_pendientes: 3, mantenimientos_pendientes: 4 }),
      HOY,
    );
    expect(pendientes.comprobantes_por_validar).toBe(3);
    expect(pendientes.mantenimientos_pendientes).toBe(4);
  });

  it('contratos por vencer: ACTIVO con fecha_fin entre hoy y hoy+30, lista de 5 por fecha y cantidad real', () => {
    const fines = [
      '2026-10-02',
      '2026-10-05',
      '2026-10-10',
      '2026-10-15',
      '2026-10-20',
      '2026-10-25',
      '2026-11-01',
    ];
    const contratos = fines.map((fin, i) =>
      contrato({
        id: `c${i}`,
        unidad_id: `u${i}`,
        unidad: `Apto ${i}`,
        fecha_fin: d(fin),
      }),
    );
    // Fuera de la regla: pasado, más allá de 30 días y no ACTIVO.
    contratos.push(
      contrato({ id: 'pasado', unidad_id: 'up', fecha_fin: d('2026-10-01') }),
      contrato({ id: 'lejos', unidad_id: 'ul', fecha_fin: d('2026-11-02') }),
      contrato({
        id: 'viejo',
        unidad_id: 'uv',
        estado: EstadoContrato.VENCIDO,
        fecha_fin: d('2026-10-10'),
      }),
    );
    const barajados = [...contratos].reverse();
    const { contratos_por_vencer } = construirPanel(
      entradas({ contratos: barajados, unidades_total: 10 }),
      HOY,
    ).pendientes;
    expect(contratos_por_vencer.cantidad).toBe(7);
    expect(contratos_por_vencer.contratos).toHaveLength(5);
    expect(contratos_por_vencer.contratos.map((c) => c.fecha_fin)).toEqual([
      '2026-10-02',
      '2026-10-05',
      '2026-10-10',
      '2026-10-15',
      '2026-10-20',
    ]);
    expect(contratos_por_vencer.contratos[0]).toEqual({
      contrato_id: 'c0',
      unidad: 'Apto 0',
      inmueble: 'Calle 45 # 12-30',
      fecha_fin: '2026-10-02',
    });
  });

  it('el límite de 30 días en año bisiesto: 29/02 + 30 = 30/03 entra y 31/03 no', () => {
    const hoy = d('2028-02-29');
    const dentro = contrato({
      id: 'dentro',
      unidad_id: 'ua',
      fecha_fin: d('2028-03-30'),
      fecha_inicio: d('2028-01-01'),
    });
    const fuera = contrato({
      id: 'fuera',
      unidad_id: 'ub',
      fecha_fin: d('2028-03-31'),
      fecha_inicio: d('2028-01-01'),
    });
    const { contratos_por_vencer } = construirPanel(
      entradas({ contratos: [dentro, fuera], unidades_total: 2 }),
      hoy,
    ).pendientes;
    expect(contratos_por_vencer.contratos.map((c) => c.contrato_id)).toEqual([
      'dentro',
    ]);
  });

  it('incrementos disponibles: ACTIVO con 12 meses cumplidos desde el último incremento o el inicio', () => {
    const sinIncremento = contrato({
      id: 'a',
      unidad_id: 'ua',
      fecha_inicio: d('2025-09-01'),
      fecha_fin: d('2027-08-31'),
    });
    const conIncrementoViejo = contrato({
      id: 'b',
      unidad_id: 'ub',
      fecha_inicio: d('2024-01-01'),
      fecha_fin: d('2027-12-31'),
      incrementos_ipc: [
        {
          fecha_aplicacion: d('2025-06-01'),
          canon_anterior_centavos: 900_000,
          canon_nuevo_centavos: MILLON,
        },
      ],
    });
    const conIncrementoReciente = contrato({
      id: 'c',
      unidad_id: 'uc',
      fecha_inicio: d('2024-01-01'),
      fecha_fin: d('2027-12-31'),
      incrementos_ipc: [
        {
          fecha_aplicacion: d('2026-06-01'),
          canon_anterior_centavos: 900_000,
          canon_nuevo_centavos: MILLON,
        },
      ],
    });
    const aunNo = contrato({
      id: 'd',
      unidad_id: 'ud',
      fecha_inicio: d('2026-03-01'),
    });
    const cerrado = contrato({
      id: 'e',
      unidad_id: 'ue',
      estado: EstadoContrato.VENCIDO,
      fecha_inicio: d('2024-01-01'),
      fecha_fin: d('2026-05-31'),
    });
    const hoyBorde = d('2026-10-02');
    const justoHoy = contrato({
      id: 'f',
      unidad_id: 'uf',
      fecha_inicio: d('2025-10-02'),
      fecha_fin: d('2027-10-01'),
    });
    const panel = construirPanel(
      entradas({
        contratos: [
          aunNo,
          conIncrementoReciente,
          sinIncremento,
          cerrado,
          conIncrementoViejo,
          justoHoy,
        ],
        unidades_total: 6,
        ipc_configurado: false,
      }),
      hoyBorde,
    );
    const { incrementos_disponibles } = panel.pendientes;
    expect(incrementos_disponibles.cantidad).toBe(3);
    // Orden ascendente por la fecha desde la que están disponibles.
    expect(incrementos_disponibles.contratos.map((c) => c.contrato_id)).toEqual(
      ['b', 'a', 'f'],
    );
    expect(
      incrementos_disponibles.contratos.map((c) => c.disponible_desde),
    ).toEqual(['2026-06-01', '2026-09-01', '2026-10-02']);
    expect(incrementos_disponibles.contratos.every((c) => c.ipc_faltante)).toBe(
      true,
    );
  });

  it('ipc_faltante es false cuando el IPC del año anterior está configurado', () => {
    const c = contrato({
      fecha_inicio: d('2025-01-01'),
      fecha_fin: d('2027-12-31'),
    });
    const { incrementos_disponibles } = construirPanel(
      entradas({ contratos: [c], unidades_total: 1, ipc_configurado: true }),
      HOY,
    ).pendientes;
    expect(incrementos_disponibles.contratos[0].ipc_faltante).toBe(false);
  });

  it('terminaciones por confirmar: solicitadas por el INQUILINO, sin confirmar y con contrato ACTIVO', () => {
    const porConfirmar = contrato({
      id: 'si',
      unidad_id: 'u1',
      terminacionAnticipadaSolicitada: true,
      terminacionAnticipadaSolicitadaPor: RolSolicitante.INQUILINO,
      terminacionAnticipadaSolicitadaEn: new Date('2026-09-28T15:00:00.000Z'),
      terminacion_fecha_efectiva: d('2026-11-30'),
    });
    const laPidioElArrendador = contrato({
      id: 'no1',
      unidad_id: 'u2',
      terminacionAnticipadaSolicitada: true,
      terminacionAnticipadaSolicitadaPor: RolSolicitante.ARRENDADOR,
      terminacionAnticipadaSolicitadaEn: new Date('2026-09-28T15:00:00.000Z'),
    });
    const yaConfirmada = contrato({
      id: 'no2',
      unidad_id: 'u3',
      terminacionAnticipadaSolicitada: true,
      terminacionAnticipadaSolicitadaPor: RolSolicitante.INQUILINO,
      terminacionAnticipadaConfirmadaEn: new Date('2026-09-29T15:00:00.000Z'),
      terminacion_confirmada_por: RolSolicitante.ARRENDADOR,
    });
    const ninguna = contrato({ id: 'no3', unidad_id: 'u4' });
    const { terminaciones_por_confirmar } = construirPanel(
      entradas({
        contratos: [laPidioElArrendador, porConfirmar, yaConfirmada, ninguna],
        unidades_total: 4,
      }),
      HOY,
    ).pendientes;
    expect(terminaciones_por_confirmar.cantidad).toBe(1);
    expect(terminaciones_por_confirmar.contratos).toEqual([
      {
        contrato_id: 'si',
        unidad: 'Apto 101',
        inmueble: 'Calle 45 # 12-30',
        fecha_fin: '2027-08-31',
      },
    ]);
  });
});
