import {
  EstadoContrato,
  EstadoSolicitudMantenimiento,
  UrgenciaMantenimiento,
} from '@prisma/client';
import {
  construirPanel,
  ContratoParaPanel,
  EntradasPanel,
  MAXIMO_MOROSOS,
  PagoParaPanel,
  UnidadParaPanel,
} from './panel-arrendador.util';

// B0.7-B (B-82): bloques nuevos del Panel. Fechas inyectadas (nunca el reloj del sistema).
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const MILLON = 1_000_000;

function contrato(extra: Partial<ContratoParaPanel> = {}): ContratoParaPanel {
  return {
    id: 'c1',
    unidad_id: 'u1',
    unidad: 'Apto 101',
    inmueble_id: 'i1',
    inmueble: 'Calle 45 # 12-30',
    inquilino_nombre: 'Camilo Pardo',
    estado: EstadoContrato.ACTIVO,
    fecha_inicio: d('2026-09-01'),
    fecha_fin: d('2027-08-31'),
    dia_pago: 5,
    canon_centavos: MILLON,
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

function unidad(
  id: string,
  nombre: string,
  inmueble_id = 'i1',
  inmueble_direccion = 'Calle 45 # 12-30',
): UnidadParaPanel {
  return { id, nombre, inmueble_id, inmueble_direccion };
}

function entradas(extra: Partial<EntradasPanel> = {}): EntradasPanel {
  return {
    contratos: [],
    unidades: [],
    inmuebles: [],
    comprobantes_pendientes: 0,
    solicitudes: [],
    ipc_configurado: true,
    ...extra,
  };
}

// ---------------------------------------------------------------------------------------------
describe('morosos (quién me debe)', () => {
  const HOY = d('2026-10-20');

  it('un elemento por contrato con mora, con unidad, inmueble, inquilino, períodos, monto, días y período más antiguo', () => {
    // Inicio 01/08: agosto y septiembre vencidos (05/08 y 05/09); octubre vence el 05/10 y también.
    const c = contrato({
      id: 'deudor',
      fecha_inicio: d('2026-08-01'),
      pagos: [pago('2026-09-01', 'APROBADO', 300_000, '2026-09-04')],
    });
    const { morosos, mora } = construirPanel(entradas({ contratos: [c] }), HOY);
    expect(morosos).toEqual([
      {
        contrato_id: 'deudor',
        unidad: { id: 'u1', nombre: 'Apto 101' },
        inmueble: { id: 'i1', direccion: 'Calle 45 # 12-30' },
        inquilino: { nombre: 'Camilo Pardo' },
        periodos: 3,
        monto_centavos: 3 * MILLON - 300_000,
        dias_mora: 76, // del 05/08 al 20/10
        periodo_mas_antiguo: '2026-08-01',
      },
    ]);
    expect(mora.total_centavos).toBe(morosos[0].monto_centavos);
  });

  it('orden: monto desc, luego días desc, luego contrato_id; máximo 10; la suma de TODOS da mora.total_centavos', () => {
    // 12 contratos en mora con montos y antigüedades distintos (inicio en meses distintos).
    const contratos: ContratoParaPanel[] = [];
    for (let i = 0; i < 12; i += 1) {
      const mesInicio = 3 + (i % 6); // de marzo a agosto
      contratos.push(
        contrato({
          id: `c${String(i).padStart(2, '0')}`,
          unidad_id: `u${i}`,
          fecha_inicio: d(`2026-${String(mesInicio).padStart(2, '0')}-01`),
          canon_centavos: MILLON + (i < 6 ? 0 : 500_000),
        }),
      );
    }
    const panel = construirPanel(entradas({ contratos }), HOY);
    expect(panel.morosos).toHaveLength(MAXIMO_MOROSOS);
    expect(MAXIMO_MOROSOS).toBe(10);
    expect(panel.mora.contratos).toBe(12);

    // La suma de los 12 (no solo de los 10) es la cartera total.
    let suma = 0;
    for (const c of contratos) {
      const solo = construirPanel(entradas({ contratos: [c] }), HOY);
      suma += solo.morosos[0].monto_centavos;
    }
    expect(suma).toBe(panel.mora.total_centavos);

    const lista = panel.morosos;
    for (let i = 1; i < lista.length; i += 1) {
      const a = lista[i - 1];
      const b = lista[i];
      const enOrden =
        a.monto_centavos > b.monto_centavos ||
        (a.monto_centavos === b.monto_centavos &&
          (a.dias_mora > b.dias_mora ||
            (a.dias_mora === b.dias_mora && a.contrato_id < b.contrato_id)));
      expect(enOrden).toBe(true);
    }
    // El primero es el de canon mayor que empezó antes (más períodos vencidos).
    expect(lista[0].contrato_id).toBe('c06');
  });

  it('empate en monto: primero el de más días; empate total: por contrato_id', () => {
    const viejo = contrato({
      id: 'b-viejo',
      unidad_id: 'u1',
      fecha_inicio: d('2026-09-01'),
      dia_pago: 1,
    });
    const nuevo = contrato({
      id: 'a-nuevo',
      unidad_id: 'u2',
      fecha_inicio: d('2026-09-01'),
      dia_pago: 10,
    });
    const gemelo = contrato({
      id: 'a-gemelo',
      unidad_id: 'u3',
      fecha_inicio: d('2026-09-01'),
      dia_pago: 10,
    });
    const { morosos } = construirPanel(
      entradas({ contratos: [nuevo, gemelo, viejo] }),
      HOY,
    );
    expect(morosos.map((m) => m.contrato_id)).toEqual([
      'b-viejo',
      'a-gemelo',
      'a-nuevo',
    ]);
  });

  it('dias_mora cruza el cambio de mes y cuenta desde el período PARCIAL más antiguo', () => {
    // Fecha límite 31/10 (día de pago 31); hoy 02/11: 2 días. Octubre PARCIAL (aprobado 400.000).
    const c = contrato({
      fecha_inicio: d('2026-10-01'),
      dia_pago: 31,
      pagos: [pago('2026-10-01', 'APROBADO', 400_000, '2026-10-30')],
    });
    const { morosos } = construirPanel(
      entradas({ contratos: [c] }),
      d('2026-11-02'),
    );
    expect(morosos).toHaveLength(1);
    expect(morosos[0].dias_mora).toBe(2);
    expect(morosos[0].periodos).toBe(1);
    expect(morosos[0].monto_centavos).toBe(600_000);
    expect(morosos[0].periodo_mas_antiguo).toBe('2026-10-01');
  });

  it('inquilino null si el contrato no guarda nombre', () => {
    const c = contrato({ inquilino_nombre: '   ' });
    const { morosos } = construirPanel(entradas({ contratos: [c] }), HOY);
    expect(morosos[0].inquilino).toBeNull();
  });

  it('incluye contratos VENCIDO y TERMINADO_ANTICIPADAMENTE con deuda; excluye un ACTIVO al día', () => {
    const vencido = contrato({
      id: 'vencido',
      unidad_id: 'u1',
      estado: EstadoContrato.VENCIDO,
      fecha_inicio: d('2026-07-01'),
      fecha_fin: d('2026-08-31'),
    });
    const terminado = contrato({
      id: 'terminado',
      unidad_id: 'u2',
      estado: EstadoContrato.TERMINADO_ANTICIPADAMENTE,
      fecha_inicio: d('2026-08-01'),
      terminacionAnticipadaSolicitada: true,
      terminacionAnticipadaConfirmadaEn: new Date('2026-08-20T15:00:00.000Z'),
      terminacion_fecha_efectiva: d('2026-08-31'),
    });
    const alDia = contrato({
      id: 'al-dia',
      unidad_id: 'u3',
      fecha_inicio: d('2026-10-01'),
      pagos: [pago('2026-10-01', 'APROBADO', MILLON, '2026-10-03')],
    });
    const { morosos } = construirPanel(
      entradas({ contratos: [vencido, terminado, alDia] }),
      HOY,
    );
    expect(morosos.map((m) => m.contrato_id).sort()).toEqual([
      'terminado',
      'vencido',
    ]);
  });

  it('un período EN_REVISION no es mora', () => {
    const c = contrato({
      fecha_inicio: d('2026-10-01'),
      pagos: [pago('2026-10-01', 'PENDIENTE', MILLON, '2026-10-04')],
    });
    expect(construirPanel(entradas({ contratos: [c] }), HOY).morosos).toEqual(
      [],
    );
  });
});

// ---------------------------------------------------------------------------------------------
describe('anio (cómo va el año)', () => {
  const conPagos = (pagos: PagoParaPanel[], extra = {}) =>
    contrato({ fecha_inicio: d('2025-01-01'), pagos, ...extra });

  it('en enero hay un solo mes, con el mismo mes del año anterior', () => {
    const c = conPagos([
      pago('2027-01-01', 'APROBADO', MILLON, '2027-01-04'),
      pago('2026-01-01', 'APROBADO', 800_000, '2026-01-05'),
    ]);
    const { anio } = construirPanel(
      entradas({ contratos: [c] }),
      d('2027-01-10'),
    );
    expect(anio).toEqual({
      anio: 2027,
      meses: [
        { mes: '2027-01', actual_centavos: MILLON, anterior_centavos: 800_000 },
      ],
      total_actual_centavos: MILLON,
      total_anterior_centavos: 800_000,
      variacion_porcentual: 25,
    });
  });

  it('meses de enero al actual; el total anterior llega hasta el mismo día del año anterior', () => {
    const c = conPagos([
      pago('2027-02-01', 'APROBADO', MILLON, '2027-02-03'),
      pago('2027-03-01', 'APROBADO', MILLON, '2027-03-03'),
      pago('2026-02-01', 'APROBADO', MILLON, '2026-02-03'),
      // Después del 15/03 del año anterior: cuenta en el mes, no en el total.
      pago('2026-03-01', 'APROBADO', 500_000, '2026-03-20'),
      pago('2026-03-01', 'APROBADO', 300_000, '2026-03-15'),
    ]);
    const { anio } = construirPanel(
      entradas({ contratos: [c] }),
      d('2027-03-15'),
    );
    expect(anio.meses).toEqual([
      { mes: '2027-01', actual_centavos: 0, anterior_centavos: 0 },
      { mes: '2027-02', actual_centavos: MILLON, anterior_centavos: MILLON },
      { mes: '2027-03', actual_centavos: MILLON, anterior_centavos: 800_000 },
    ]);
    expect(anio.total_actual_centavos).toBe(2 * MILLON);
    expect(anio.total_anterior_centavos).toBe(MILLON + 300_000);
    expect(anio.variacion_porcentual).toBe(54); // (2.000.000 − 1.300.000) / 1.300.000 = 53,8 %
  });

  it('29 de febrero: el total anterior llega hasta el 28 de febrero', () => {
    const c = conPagos([
      pago('2027-02-01', 'APROBADO', 700_000, '2027-02-28'),
      pago('2027-03-01', 'APROBADO', 200_000, '2027-03-01'),
      pago('2028-02-01', 'APROBADO', MILLON, '2028-02-29'),
    ]);
    const { anio } = construirPanel(
      entradas({ contratos: [c] }),
      d('2028-02-29'),
    );
    expect(anio.anio).toBe(2028);
    expect(anio.total_actual_centavos).toBe(MILLON);
    expect(anio.total_anterior_centavos).toBe(700_000);
  });

  it('cuenta los pagos del año anterior de un contrato ya cerrado', () => {
    const cerrado = contrato({
      id: 'cerrado',
      estado: EstadoContrato.VENCIDO,
      fecha_inicio: d('2025-06-01'),
      fecha_fin: d('2026-05-31'),
      pagos: [pago('2026-03-01', 'APROBADO', 900_000, '2026-03-04')],
    });
    const { anio } = construirPanel(
      entradas({ contratos: [cerrado] }),
      d('2027-04-10'),
    );
    expect(anio.meses[2]).toEqual({
      mes: '2027-03',
      actual_centavos: 0,
      anterior_centavos: 900_000,
    });
    expect(anio.total_anterior_centavos).toBe(900_000);
    expect(anio.variacion_porcentual).toBe(-100);
  });

  it('variación null si el año anterior es 0; solo APROBADOS por fecha_reportada', () => {
    const c = conPagos([
      pago('2027-03-01', 'APROBADO', MILLON, '2027-03-02'),
      pago('2027-03-01', 'PENDIENTE', 5 * MILLON, '2027-03-02'),
      // Período de diciembre del año anterior, pagado en enero: cuenta en enero (fecha_reportada).
      pago('2026-12-01', 'APROBADO', 400_000, '2027-01-08'),
    ]);
    const { anio } = construirPanel(
      entradas({ contratos: [c] }),
      d('2027-03-15'),
    );
    expect(anio.meses.map((m) => m.actual_centavos)).toEqual([
      400_000,
      0,
      MILLON,
    ]);
    expect(anio.total_anterior_centavos).toBe(0);
    expect(anio.variacion_porcentual).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
describe('por_inmueble', () => {
  const HOY = d('2027-03-15');

  it('todos los inmuebles, también sin unidades ni ingresos; la suma da total_actual', () => {
    const a1 = contrato({
      id: 'a1',
      unidad_id: 'ua1',
      inmueble_id: 'ia',
      inmueble: 'Calle A',
      fecha_inicio: d('2027-01-01'),
      pagos: [
        pago('2027-01-01', 'APROBADO', MILLON, '2027-01-03'),
        pago('2027-02-01', 'APROBADO', MILLON, '2027-02-03'),
        pago('2026-12-01', 'APROBADO', MILLON, '2026-12-03'), // otro año: no cuenta
      ],
    });
    const b1 = contrato({
      id: 'b1',
      unidad_id: 'ub1',
      inmueble_id: 'ib',
      inmueble: 'Avenida B',
      estado: EstadoContrato.VENCIDO,
      fecha_inicio: d('2026-03-01'),
      fecha_fin: d('2027-02-28'),
      pagos: [pago('2027-02-01', 'APROBADO', 3 * MILLON, '2027-02-10')],
    });
    const panel = construirPanel(
      entradas({
        contratos: [a1, b1],
        inmuebles: [
          { id: 'ia', direccion: 'Calle A' },
          { id: 'ib', direccion: 'Avenida B' },
          { id: 'ic', direccion: 'Carrera C' },
          { id: 'id', direccion: 'Barrio D' },
        ],
        unidades: [
          unidad('ua1', 'A1', 'ia', 'Calle A'),
          unidad('ua2', 'A2', 'ia', 'Calle A'),
          unidad('ub1', 'B1', 'ib', 'Avenida B'),
          unidad('uc1', 'C1', 'ic', 'Carrera C'),
        ],
      }),
      HOY,
    );
    expect(panel.por_inmueble).toEqual([
      {
        inmueble_id: 'ib',
        direccion: 'Avenida B',
        ingresos_anio_centavos: 3 * MILLON,
        unidades: 1,
        ocupadas: 0,
      },
      {
        inmueble_id: 'ia',
        direccion: 'Calle A',
        ingresos_anio_centavos: 2 * MILLON,
        unidades: 2,
        ocupadas: 1,
      },
      // Sin ingresos: por dirección.
      {
        inmueble_id: 'id',
        direccion: 'Barrio D',
        ingresos_anio_centavos: 0,
        unidades: 0,
        ocupadas: 0,
      },
      {
        inmueble_id: 'ic',
        direccion: 'Carrera C',
        ingresos_anio_centavos: 0,
        unidades: 1,
        ocupadas: 0,
      },
    ]);
    expect(
      panel.por_inmueble.reduce((s, i) => s + i.ingresos_anio_centavos, 0),
    ).toBe(panel.anio.total_actual_centavos);
  });
});

// ---------------------------------------------------------------------------------------------
describe('ocupacion: porcentaje y unidades_detalle', () => {
  const HOY = d('2026-10-20');

  it('un caso de cada estado, ordenadas por dirección y nombre', () => {
    const enMora = contrato({
      id: 'mora',
      unidad_id: 'u-mora',
      fecha_inicio: d('2026-09-01'),
    });
    const alDia = contrato({
      id: 'aldia',
      unidad_id: 'u-aldia',
      fecha_inicio: d('2026-10-01'),
      pagos: [pago('2026-10-01', 'APROBADO', MILLON, '2026-10-02')],
    });
    const programado = contrato({
      id: 'prog',
      unidad_id: 'u-prog',
      estado: EstadoContrato.PROGRAMADO,
      fecha_inicio: d('2026-11-01'),
    });
    // La unidad libre tuvo un contrato VENCIDO con deuda: sigue LIBRE (la mora es del contrato cerrado).
    const cerrado = contrato({
      id: 'cerrado',
      unidad_id: 'u-libre',
      estado: EstadoContrato.VENCIDO,
      fecha_inicio: d('2026-07-01'),
      fecha_fin: d('2026-08-31'),
    });
    const { ocupacion } = construirPanel(
      entradas({
        contratos: [enMora, alDia, programado, cerrado],
        unidades: [
          unidad('u-prog', 'Apto 3', 'i2', 'Calle 2'),
          unidad('u-libre', 'Apto 4', 'i2', 'Calle 2'),
          unidad('u-aldia', 'Apto 2', 'i1', 'Calle 1'),
          unidad('u-mora', 'Apto 1', 'i1', 'Calle 1'),
        ],
      }),
      HOY,
    );
    expect(ocupacion.unidades).toBe(4);
    expect(ocupacion.ocupadas).toBe(2);
    expect(ocupacion.porcentaje).toBe(50);
    expect(ocupacion.unidades_detalle).toEqual([
      {
        unidad_id: 'u-mora',
        nombre: 'Apto 1',
        inmueble_id: 'i1',
        inmueble_direccion: 'Calle 1',
        estado: 'EN_MORA',
      },
      {
        unidad_id: 'u-aldia',
        nombre: 'Apto 2',
        inmueble_id: 'i1',
        inmueble_direccion: 'Calle 1',
        estado: 'AL_DIA',
      },
      {
        unidad_id: 'u-prog',
        nombre: 'Apto 3',
        inmueble_id: 'i2',
        inmueble_direccion: 'Calle 2',
        estado: 'PROGRAMADA',
      },
      {
        unidad_id: 'u-libre',
        nombre: 'Apto 4',
        inmueble_id: 'i2',
        inmueble_direccion: 'Calle 2',
        estado: 'LIBRE',
      },
    ]);
  });

  it('porcentaje redondeado y null con 0 unidades', () => {
    const tres = construirPanel(
      entradas({
        contratos: [
          contrato({ unidad_id: 'u1', fecha_inicio: d('2026-10-01') }),
        ],
        unidades: [unidad('u1', 'A'), unidad('u2', 'B'), unidad('u3', 'C')],
      }),
      HOY,
    );
    expect(tres.ocupacion.porcentaje).toBe(33);
    expect(construirPanel(entradas(), HOY).ocupacion.porcentaje).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
describe('pendientes.solicitudes_abiertas', () => {
  it('cuenta PENDIENTE y EN_PROCESO (no RESUELTO); urgentes = las de urgencia ALTO; mantenimientos_pendientes igual que antes', () => {
    const { pendientes } = construirPanel(
      entradas({
        solicitudes: [
          {
            estado: EstadoSolicitudMantenimiento.PENDIENTE,
            urgencia: UrgenciaMantenimiento.ALTO,
            cantidad: 2,
          },
          {
            estado: EstadoSolicitudMantenimiento.PENDIENTE,
            urgencia: UrgenciaMantenimiento.BAJO,
            cantidad: 1,
          },
          {
            estado: EstadoSolicitudMantenimiento.EN_PROCESO,
            urgencia: UrgenciaMantenimiento.ALTO,
            cantidad: 1,
          },
          {
            estado: EstadoSolicitudMantenimiento.EN_PROCESO,
            urgencia: UrgenciaMantenimiento.MEDIO,
            cantidad: 3,
          },
          {
            estado: EstadoSolicitudMantenimiento.RESUELTO,
            urgencia: UrgenciaMantenimiento.ALTO,
            cantidad: 9,
          },
        ],
      }),
      d('2026-10-20'),
    );
    expect(pendientes.solicitudes_abiertas).toEqual({ total: 7, urgentes: 3 });
    expect(pendientes.mantenimientos_pendientes).toBe(3);
  });
});
