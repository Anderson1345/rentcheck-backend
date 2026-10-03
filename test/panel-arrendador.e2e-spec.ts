// Panel del arrendador (B0.6-A2, B-58): GET /arrendadores/panel. La regla vive en una función pura
// (src/common/panel-arrendador.util.ts, con su propia prueba); aquí se comprueba el endpoint real:
// los datos que entrega con contratos en cada estado, el aislamiento entre arrendadores, que solo
// lee, que el número de consultas SQL no crece con los contratos y que OpenAPI lo describe.
import { HttpStatus, INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test, TestingModule } from '@nestjs/testing';
import {
  EstadoContrato,
  EstadoPago,
  EstadoSolicitudMantenimiento,
  Prisma,
  PrismaClient,
  RolSolicitante,
  TipoPlantillaContrato,
  TipoUnidad,
  UrgenciaMantenimiento,
  UsoPermitido,
} from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/configurar-app';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  autenticarInquilino,
  crearContrato,
  crearInmueble,
  crearInquilino,
  registrarArrendador,
} from './helpers/crear-datos.helper';
import { limpiarBd } from './helpers/limpiar-bd';
import { hoyDePrueba } from './helpers/fechas.helper';

// Un día fijo a mitad de mes (15/03/2027, 12:00 en Bogotá): los períodos de los contratos de prueba
// no dependen del día en que se corre. Se instala también antes de cada prueba porque, con
// RELOJ_SIMULADO, el setup de la suite reinstala su propio reloj antes de cada una. Solo se simula
// `Date`; los temporizadores siguen reales y el reloj avanza con el tiempo real.
const AHORA = new Date('2027-03-15T17:00:00.000Z');
function instalarReloj(): void {
  jest.useFakeTimers({
    now: AHORA,
    advanceTimers: true,
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
  });
}

const MILLON = 1_000_000;
const OK: number = HttpStatus.OK;

interface ContratoPendienteApi {
  contrato_id: string;
  unidad: string;
  inmueble: string;
  fecha_fin: string;
}
interface IncrementoApi {
  contrato_id: string;
  unidad: string;
  inmueble: string;
  disponible_desde: string;
  ipc_faltante: boolean;
}
interface MorosoApi {
  contrato_id: string;
  unidad: { id: string; nombre: string };
  inmueble: { id: string; direccion: string };
  inquilino: { nombre: string } | null;
  periodos: number;
  monto_centavos: number;
  dias_mora: number;
  periodo_mas_antiguo: string;
}
interface UnidadDetalleApi {
  unidad_id: string;
  nombre: string;
  inmueble_id: string;
  inmueble_direccion: string;
  estado: 'EN_MORA' | 'AL_DIA' | 'PROGRAMADA' | 'LIBRE';
}
interface PanelApi {
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
    unidades_detalle: UnidadDetalleApi[];
  };
  mora: { contratos: number; periodos: number; total_centavos: number };
  morosos: MorosoApi[];
  anio: {
    anio: number;
    meses: {
      mes: string;
      actual_centavos: number;
      anterior_centavos: number;
    }[];
    total_actual_centavos: number;
    total_anterior_centavos: number;
    variacion_porcentual: number | null;
  };
  por_inmueble: {
    inmueble_id: string;
    direccion: string;
    ingresos_anio_centavos: number;
    unidades: number;
    ocupadas: number;
  }[];
  tendencia: { mes: string; ingresos_centavos: number }[];
  pendientes: {
    comprobantes_por_validar: number;
    mantenimientos_pendientes: number;
    solicitudes_abiertas: { total: number; urgentes: number };
    contratos_por_vencer: {
      cantidad: number;
      contratos: ContratoPendienteApi[];
    };
    incrementos_disponibles: { cantidad: number; contratos: IncrementoApi[] };
    terminaciones_por_confirmar: {
      cantidad: number;
      contratos: ContratoPendienteApi[];
    };
  };
}

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/**
 * Regresión de B0.7-B: SOLO los campos que existían antes (B0.6-A2), con los ids reemplazados por
 * `<id>` (cambian en cada corrida). El snapshot se grabó con el código anterior a B0.7-B.
 */
function camposAntiguos(p: PanelApi): unknown {
  const sinIds = (valor: unknown): unknown => {
    if (Array.isArray(valor)) return valor.map(sinIds);
    if (valor && typeof valor === 'object') {
      return Object.fromEntries(
        Object.entries(valor).map(([k, v]) => [
          k,
          k.endsWith('_id') ? '<id>' : sinIds(v),
        ]),
      );
    }
    return valor;
  };
  return sinIds({
    mes: p.mes,
    calculado_para: p.calculado_para,
    ingresos_mes_centavos: p.ingresos_mes_centavos,
    recaudo: p.recaudo,
    ocupacion: {
      unidades: p.ocupacion.unidades,
      ocupadas: p.ocupacion.ocupadas,
      libres: p.ocupacion.libres,
      con_contrato_programado: p.ocupacion.con_contrato_programado,
    },
    mora: p.mora,
    tendencia: p.tendencia,
    pendientes: {
      comprobantes_por_validar: p.pendientes.comprobantes_por_validar,
      mantenimientos_pendientes: p.pendientes.mantenimientos_pendientes,
      contratos_por_vencer: p.pendientes.contratos_por_vencer,
      incrementos_disponibles: p.pendientes.incrementos_disponibles,
      terminaciones_por_confirmar: p.pendientes.terminaciones_por_confirmar,
    },
  });
}

describe('Panel del arrendador (e2e, B-58)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let prismaDeLaApp: PrismaClient<Prisma.PrismaClientOptions, 'query'>;
  const consultas: string[] = [];

  let tokenA: string;
  let tokenB: string;
  let tokenC: string;
  let tokenInquilino: string;
  let idsA: Record<string, string>;
  let arrendadorB: string;
  let inquilinoB: string;
  let unidadesB: string[];

  const get = (ruta: string, token?: string) => {
    const peticion = request(app.getHttpServer()).get(ruta);
    return token ? peticion.set('Authorization', `Bearer ${token}`) : peticion;
  };
  const panel = async (token: string): Promise<PanelApi> =>
    (await get('/arrendadores/panel', token).expect(OK)).body as PanelApi;

  function idDelToken(token: string): string {
    return (
      JSON.parse(
        Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
      ) as {
        id: string;
      }
    ).id;
  }

  async function crearInmuebleConUnidades(
    arrendadorId: string,
    direccion: string,
    nombres: string[],
  ) {
    const inmueble = await prisma.inmueble.create({
      data: {
        arrendador_id: arrendadorId,
        direccion,
        ciudad: 'Bogotá',
        estrato: 3,
        matricula_inmobiliaria: `M-${direccion}`,
      },
      select: { id: true },
    });
    const unidades: string[] = [];
    for (const nombre of nombres) {
      const unidad = await prisma.unidad.create({
        data: {
          inmueble_id: inmueble.id,
          nombre,
          tipo: TipoUnidad.APARTAMENTO,
          canon_base_centavos: MILLON,
          acepta_mascotas: false,
          uso_permitido: UsoPermitido.RESIDENCIAL,
        },
        select: { id: true },
      });
      unidades.push(unidad.id);
    }
    return { inmuebleId: inmueble.id, unidades };
  }

  async function fichaInquilino(
    arrendadorId: string,
    cedula: string,
  ): Promise<string> {
    return (
      await prisma.inquilino.create({
        data: {
          arrendador_id: arrendadorId,
          nombre: 'Persona Prueba',
          cedula,
          telefono: '3001112233',
        },
        select: { id: true },
      })
    ).id;
  }

  async function nuevoContrato(datos: {
    arrendadorId: string;
    unidadId: string;
    inquilinoId: string;
    estado: EstadoContrato;
    inicio: string;
    fin: string;
    canon?: number;
    extra?: Partial<Prisma.ContratoUncheckedCreateInput>;
  }): Promise<string> {
    return (
      await prisma.contrato.create({
        data: {
          arrendador_id: datos.arrendadorId,
          unidad_id: datos.unidadId,
          inquilino_id: datos.inquilinoId,
          inquilino_nombre: 'Persona Prueba',
          inquilino_cedula: '1020304050',
          inquilino_telefono: '3001112233',
          tipo_plantilla: TipoPlantillaContrato.VIVIENDA_URBANA_LEY_820,
          canon_centavos: datos.canon ?? MILLON,
          dia_pago: 5,
          forma_pago: 'Transferencia',
          datos_recaudo: 'Cuenta de prueba',
          fecha_inicio: d(datos.inicio),
          fecha_fin: d(datos.fin),
          estado: datos.estado,
          ...datos.extra,
        },
        select: { id: true },
      })
    ).id;
  }

  /** Un pago del contrato: `periodo` = primer día del mes que cubre; `fecha` = día en que pagó. */
  async function nuevoPago(
    arrendadorId: string,
    contratoId: string,
    periodo: string,
    estado: EstadoPago,
    monto: number,
    fecha: string,
  ) {
    await prisma.pago.create({
      data: {
        arrendador_id: arrendadorId,
        contrato_id: contratoId,
        monto_centavos: monto,
        fecha_reportada: d(fecha),
        periodo: d(periodo),
        estado,
      },
    });
  }

  /** Paga completos (aprobados, día 3 de cada mes) los meses de `desde` a `hasta` (AAAA-MM). */
  async function pagarMeses(
    arrendadorId: string,
    contratoId: string,
    desde: string,
    hasta: string,
  ) {
    let [anio, mes] = desde.split('-').map(Number);
    const [anioFin, mesFin] = hasta.split('-').map(Number);
    while (anio < anioFin || (anio === anioFin && mes <= mesFin)) {
      const clave = `${anio}-${String(mes).padStart(2, '0')}`;
      await nuevoPago(
        arrendadorId,
        contratoId,
        `${clave}-01`,
        EstadoPago.APROBADO,
        MILLON,
        `${clave}-03`,
      );
      mes += 1;
      if (mes > 12) {
        mes = 1;
        anio += 1;
      }
    }
  }

  async function nuevaSolicitud(
    arrendadorId: string,
    unidadId: string,
    inquilinoId: string,
    estado: EstadoSolicitudMantenimiento,
  ) {
    await prisma.solicitudMantenimiento.create({
      data: {
        arrendador_id: arrendadorId,
        unidad_id: unidadId,
        inquilino_id: inquilinoId,
        descripcion: 'Solicitud de prueba',
        urgencia: UrgenciaMantenimiento.MEDIO,
        estado,
      },
    });
  }

  beforeAll(async () => {
    instalarReloj();
    prisma = new PrismaService();
    await prisma.$connect();
    await limpiarBd(prisma);

    // El cliente de Prisma de la APP registra cada consulta SQL (para contarlas).
    prismaDeLaApp = new PrismaClient<Prisma.PrismaClientOptions, 'query'>({
      adapter: new PrismaPg({
        connectionString: process.env.DATABASE_URL ?? '',
      }),
      log: [{ emit: 'event', level: 'query' }],
    });
    prismaDeLaApp.$on('query', (evento) => {
      consultas.push(evento.query);
    });
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaDeLaApp)
      .compile();
    app = moduleFixture.createNestApplication();
    configurarApp(app);
    await app.init();

    expect(hoyDePrueba().toISOString().slice(0, 10)).toBe('2027-03-15');

    // ---- Arrendador A: un contrato en cada situación ----
    const a = await registrarArrendador(
      app,
      'Arrendador A',
      'panel-a@correo.com',
    );
    tokenA = a.access_token;
    const idA = idDelToken(tokenA);
    const inquilinoA = await fichaInquilino(idA, '1000000001');
    const inmuebleA = await crearInmuebleConUnidades(idA, 'Calle A 1', [
      'Apto 101',
      'Apto 102',
      'Apto 103',
      'Apto 104',
      'Apto 105',
      'Apto 106',
      'Apto 107', // sin contrato
      'Apto 108', // sin contrato
    ]);
    const [u1, u2, u3, u4, u5, u6] = inmuebleA.unidades;
    const contrato = (
      unidadId: string,
      estado: EstadoContrato,
      inicio: string,
      fin: string,
      extra = {},
    ) =>
      nuevoContrato({
        arrendadorId: idA,
        unidadId,
        inquilinoId: inquilinoA,
        estado,
        inicio,
        fin,
        extra,
      });

    // C1: al día, con un comprobante de abril en revisión y una terminación pedida por el inquilino.
    const c1 = await contrato(
      u1,
      EstadoContrato.ACTIVO,
      '2027-01-01',
      '2027-12-31',
      {
        terminacionAnticipadaSolicitada: true,
        terminacionAnticipadaSolicitadaPor: RolSolicitante.INQUILINO,
        terminacionAnticipadaSolicitadaEn: new Date('2027-03-10T15:00:00.000Z'),
        terminacionAnticipadaMotivo: 'Me mudo',
        terminacion_fecha_efectiva: d('2027-05-31'),
      },
    );
    await pagarMeses(idA, c1, '2027-01', '2027-03');
    await nuevoPago(
      idA,
      c1,
      '2027-04-01',
      EstadoPago.PENDIENTE,
      MILLON,
      '2027-03-14',
    );
    // C2: febrero parcial (mora) y marzo con 400.000 aprobados y 900.000 en revisión.
    const c2 = await contrato(
      u2,
      EstadoContrato.ACTIVO,
      '2027-01-01',
      '2027-12-31',
    );
    await nuevoPago(
      idA,
      c2,
      '2027-01-01',
      EstadoPago.APROBADO,
      MILLON,
      '2027-01-03',
    );
    await nuevoPago(
      idA,
      c2,
      '2027-02-01',
      EstadoPago.APROBADO,
      400_000,
      '2027-02-20',
    );
    await nuevoPago(
      idA,
      c2,
      '2027-03-01',
      EstadoPago.APROBADO,
      400_000,
      '2027-03-10',
    );
    await nuevoPago(
      idA,
      c2,
      '2027-03-01',
      EstadoPago.PENDIENTE,
      900_000,
      '2027-03-14',
    );
    // C3: terminó en enero con diciembre, enero y el período recortado sin pagar.
    const c3 = await contrato(
      u3,
      EstadoContrato.VENCIDO,
      '2026-10-01',
      '2027-01-31',
    );
    await nuevoPago(
      idA,
      c3,
      '2026-10-01',
      EstadoPago.APROBADO,
      MILLON,
      '2026-10-04',
    );
    await nuevoPago(
      idA,
      c3,
      '2026-11-01',
      EstadoPago.APROBADO,
      MILLON,
      '2026-11-04',
    );
    // C4: programado.
    await contrato(u4, EstadoContrato.PROGRAMADO, '2027-04-01', '2028-03-31');
    // C5: termina en 16 días (por vencer), todo pagado.
    const c5 = await contrato(
      u5,
      EstadoContrato.ACTIVO,
      '2026-12-01',
      '2027-03-31',
    );
    await pagarMeses(idA, c5, '2026-12', '2027-03');
    // C6: 12 meses cumplidos desde el inicio (incremento disponible), todo pagado.
    const c6 = await contrato(
      u6,
      EstadoContrato.ACTIVO,
      '2026-03-01',
      '2027-08-31',
    );
    await pagarMeses(idA, c6, '2026-03', '2027-03');
    idsA = { c1, c2, c3, c5, c6, inmueble: inmuebleA.inmuebleId };
    await nuevaSolicitud(
      idA,
      u1,
      inquilinoA,
      EstadoSolicitudMantenimiento.PENDIENTE,
    );
    await nuevaSolicitud(
      idA,
      u2,
      inquilinoA,
      EstadoSolicitudMantenimiento.PENDIENTE,
    );
    await nuevaSolicitud(
      idA,
      u2,
      inquilinoA,
      EstadoSolicitudMantenimiento.EN_PROCESO,
    );
    await nuevaSolicitud(
      idA,
      u3,
      inquilinoA,
      EstadoSolicitudMantenimiento.RESUELTO,
    );

    // ---- Arrendador B: otro universo, con números distintos ----
    const b = await registrarArrendador(
      app,
      'Arrendador B',
      'panel-b@correo.com',
    );
    tokenB = b.access_token;
    arrendadorB = idDelToken(tokenB);
    inquilinoB = await fichaInquilino(arrendadorB, '1000000002');
    const inmuebleB = await crearInmuebleConUnidades(
      arrendadorB,
      'Carrera B 2',
      ['Local B1', 'Local B2'],
    );
    unidadesB = inmuebleB.unidades;
    const cb1 = await nuevoContrato({
      arrendadorId: arrendadorB,
      unidadId: unidadesB[0],
      inquilinoId: inquilinoB,
      estado: EstadoContrato.ACTIVO,
      inicio: '2027-01-01',
      fin: '2027-03-20',
      canon: 2 * MILLON,
    });
    await nuevoPago(
      arrendadorB,
      cb1,
      '2027-01-01',
      EstadoPago.APROBADO,
      2 * MILLON,
      '2027-01-02',
    );
    await nuevoPago(
      arrendadorB,
      cb1,
      '2027-02-01',
      EstadoPago.APROBADO,
      2 * MILLON,
      '2027-02-02',
    );
    await nuevoPago(
      arrendadorB,
      cb1,
      '2027-03-01',
      EstadoPago.PENDIENTE,
      2 * MILLON,
      '2027-03-14',
    );
    await nuevaSolicitud(
      arrendadorB,
      unidadesB[0],
      inquilinoB,
      EstadoSolicitudMantenimiento.PENDIENTE,
    );

    // ---- Arrendador C: sin ningún dato ----
    const c = await registrarArrendador(
      app,
      'Arrendador C',
      'panel-c@correo.com',
    );
    tokenC = c.access_token;

    // ---- Un inquilino real (token de otro rol) ----
    const e = await registrarArrendador(
      app,
      'Arrendador E',
      'panel-e@correo.com',
    );
    const inmuebleE = await crearInmueble(app, e.access_token, 'PANEL-E');
    const fichaE = await crearInquilino(app, e.access_token);
    const contratoE = await crearContrato(
      app,
      e.access_token,
      inmuebleE.unidades[0].id,
      fichaE.id,
    );
    tokenInquilino = await autenticarInquilino(
      app,
      contratoE.codigo_acceso?.codigo ?? '',
      'panel-inquilino@correo.com',
    );
  }, 240_000);

  beforeEach(() => {
    instalarReloj();
  });

  afterAll(async () => {
    await app.close();
    await prismaDeLaApp.$disconnect();
    await limpiarBd(prisma);
    await prisma.$disconnect();
    jest.useRealTimers();
  });

  describe('seguridad', () => {
    it('sin token: 401', async () => {
      await get('/arrendadores/panel').expect(HttpStatus.UNAUTHORIZED);
    });

    it('con el token de un inquilino: 401 (el patrón del repo para el otro rol)', async () => {
      await get('/arrendadores/panel', tokenInquilino).expect(
        HttpStatus.UNAUTHORIZED,
      );
    });
  });

  describe('regresión: los campos antiguos no cambian (B0.7-B)', () => {
    it('A, B y C devuelven exactamente los mismos campos de antes', async () => {
      expect(camposAntiguos(await panel(tokenA))).toMatchSnapshot('A');
      expect(camposAntiguos(await panel(tokenB))).toMatchSnapshot('B');
      expect(camposAntiguos(await panel(tokenC))).toMatchSnapshot('C');
    });
  });

  describe('arrendador A: contratos en cada estado', () => {
    let a: PanelApi;
    beforeAll(async () => {
      a = await panel(tokenA);
    });

    it('mes y fecha de hoy en Bogotá', () => {
      expect(a.mes).toBe('2027-03');
      expect(a.calculado_para).toBe('2027-03-15');
    });

    it('recaudo del mes: esperado = aprobado + en revisión + sin reportar', () => {
      expect(a.recaudo).toEqual({
        esperado_centavos: 4 * MILLON,
        aprobado_centavos: 3 * MILLON + 400_000,
        en_revision_centavos: 600_000,
        sin_reportar_centavos: 0,
        contratos: 4,
      });
      expect(
        a.recaudo.aprobado_centavos +
          a.recaudo.en_revision_centavos +
          a.recaudo.sin_reportar_centavos,
      ).toBe(a.recaudo.esperado_centavos);
    });

    it('ingresos del mes: pagos aprobados por fecha_reportada (sin el pendiente de 900.000)', () => {
      expect(a.ingresos_mes_centavos).toBe(3 * MILLON + 400_000);
    });

    it('tendencia de 6 meses ascendentes con los ingresos de cada uno', () => {
      expect(a.tendencia).toEqual([
        { mes: '2026-10', ingresos_centavos: 2 * MILLON },
        { mes: '2026-11', ingresos_centavos: 2 * MILLON },
        { mes: '2026-12', ingresos_centavos: 2 * MILLON },
        { mes: '2027-01', ingresos_centavos: 4 * MILLON },
        { mes: '2027-02', ingresos_centavos: 3 * MILLON + 400_000 },
        { mes: '2027-03', ingresos_centavos: 3 * MILLON + 400_000 },
      ]);
    });

    it('mora: febrero parcial de C2 y tres períodos vencidos de C3 (contrato cerrado); sin PROGRAMADO ni EN_REVISION', () => {
      expect(a.mora).toEqual({
        contratos: 2,
        periodos: 4,
        total_centavos: 3 * MILLON + 600_000,
      });
    });

    it('ocupación: 8 unidades, 4 ocupadas, 4 libres y una con contrato programado', () => {
      expect(a.ocupacion).toMatchObject({
        unidades: 8,
        ocupadas: 4,
        libres: 4,
        con_contrato_programado: 1,
      });
    });

    it('pendientes', () => {
      expect(a.pendientes.comprobantes_por_validar).toBe(2);
      expect(a.pendientes.mantenimientos_pendientes).toBe(2);
      expect(a.pendientes.contratos_por_vencer).toEqual({
        cantidad: 1,
        contratos: [
          {
            contrato_id: idsA.c5,
            unidad: 'Apto 105',
            inmueble: 'Calle A 1',
            fecha_fin: '2027-03-31',
          },
        ],
      });
      expect(a.pendientes.incrementos_disponibles).toEqual({
        cantidad: 1,
        contratos: [
          {
            contrato_id: idsA.c6,
            unidad: 'Apto 106',
            inmueble: 'Calle A 1',
            disponible_desde: '2027-03-01',
            ipc_faltante: true,
          },
        ],
      });
      expect(a.pendientes.terminaciones_por_confirmar).toEqual({
        cantidad: 1,
        contratos: [
          {
            contrato_id: idsA.c1,
            unidad: 'Apto 101',
            inmueble: 'Calle A 1',
            fecha_fin: '2027-12-31',
          },
        ],
      });
    });

    it('con el IPC del año anterior configurado, ipc_faltante pasa a false', async () => {
      await prisma.configuracionIpc.create({
        data: { anio: 2026, porcentaje: 5.1 },
      });
      try {
        const conIpc = await panel(tokenA);
        expect(
          conIpc.pendientes.incrementos_disponibles.contratos[0].ipc_faltante,
        ).toBe(false);
      } finally {
        await prisma.configuracionIpc.deleteMany();
      }
    });

    it('solo lee: no cambia el estado de pago guardado de ningún contrato', async () => {
      const antes = await prisma.contrato.findMany({
        where: { arrendador_id: idDelToken(tokenA) },
        select: { id: true, estado_pago: true },
        orderBy: { id: 'asc' },
      });
      await panel(tokenA);
      const despues = await prisma.contrato.findMany({
        where: { arrendador_id: idDelToken(tokenA) },
        select: { id: true, estado_pago: true },
        orderBy: { id: 'asc' },
      });
      expect(despues).toEqual(antes);
      // C2 y C3 están en mora de verdad, pero el Panel no lo guarda en ninguna parte.
      expect(despues.every((c) => c.estado_pago === 'PENDIENTE')).toBe(true);
    });

    it('todas las consultas del Panel son de lectura', async () => {
      consultas.length = 0;
      await panel(tokenA);
      expect(consultas.length).toBeGreaterThan(0);
      for (const consulta of consultas) {
        expect(consulta.trimStart().toUpperCase().startsWith('SELECT')).toBe(
          true,
        );
      }
    });
  });

  describe('B0.7-B: quién me debe, cómo va el año, por inmueble, ocupación por unidad y solicitudes', () => {
    let a: PanelApi;
    beforeAll(async () => {
      a = await panel(tokenA);
    });

    it('morosos: C3 (contrato cerrado, 3 períodos) y C2 (febrero parcial), por monto; suman mora.total_centavos', () => {
      expect(a.morosos).toEqual([
        {
          contrato_id: idsA.c3,
          unidad: { id: expect.any(String) as string, nombre: 'Apto 103' },
          inmueble: { id: idsA.inmueble, direccion: 'Calle A 1' },
          inquilino: { nombre: 'Persona Prueba' },
          periodos: 3,
          monto_centavos: 3 * MILLON,
          dias_mora: 100, // del 05/12/2026 al 15/03/2027
          periodo_mas_antiguo: '2026-12-01',
        },
        {
          contrato_id: idsA.c2,
          unidad: { id: expect.any(String) as string, nombre: 'Apto 102' },
          inmueble: { id: idsA.inmueble, direccion: 'Calle A 1' },
          inquilino: { nombre: 'Persona Prueba' },
          periodos: 1,
          monto_centavos: 600_000,
          dias_mora: 38, // del 05/02 al 15/03
          periodo_mas_antiguo: '2027-02-01',
        },
      ]);
      expect(a.morosos.reduce((s, m) => s + m.monto_centavos, 0)).toBe(
        a.mora.total_centavos,
      );
      expect(a.morosos.length).toBe(a.mora.contratos);
    });

    it('anio: enero a marzo de 2027 frente a 2026 (pagos APROBADOS por fecha_reportada)', () => {
      expect(a.anio).toEqual({
        anio: 2027,
        meses: [
          { mes: '2027-01', actual_centavos: 4 * MILLON, anterior_centavos: 0 },
          {
            mes: '2027-02',
            actual_centavos: 3 * MILLON + 400_000,
            anterior_centavos: 0,
          },
          {
            mes: '2027-03',
            actual_centavos: 3 * MILLON + 400_000,
            anterior_centavos: MILLON,
          },
        ],
        total_actual_centavos: 10 * MILLON + 800_000,
        total_anterior_centavos: MILLON,
        variacion_porcentual: 980,
      });
    });

    it('por_inmueble: el inmueble de A con sus ingresos del año, unidades y ocupadas', () => {
      expect(a.por_inmueble).toEqual([
        {
          inmueble_id: idsA.inmueble,
          direccion: 'Calle A 1',
          ingresos_anio_centavos: a.anio.total_actual_centavos,
          unidades: 8,
          ocupadas: 4,
        },
      ]);
    });

    it('ocupación por unidad: EN_MORA, AL_DIA, PROGRAMADA y LIBRE, y el porcentaje', () => {
      expect(a.ocupacion.porcentaje).toBe(50);
      expect(
        a.ocupacion.unidades_detalle.map((u) => [u.nombre, u.estado]),
      ).toEqual([
        ['Apto 101', 'AL_DIA'],
        ['Apto 102', 'EN_MORA'],
        ['Apto 103', 'LIBRE'], // su contrato VENCIDO debe, pero la unidad está libre
        ['Apto 104', 'PROGRAMADA'],
        ['Apto 105', 'AL_DIA'],
        ['Apto 106', 'AL_DIA'],
        ['Apto 107', 'LIBRE'],
        ['Apto 108', 'LIBRE'],
      ]);
      for (const u of a.ocupacion.unidades_detalle) {
        expect(u.inmueble_id).toBe(idsA.inmueble);
        expect(u.inmueble_direccion).toBe('Calle A 1');
      }
    });

    it('solicitudes abiertas: PENDIENTE y EN_PROCESO (no RESUELTO); urgentes = ALTO', async () => {
      expect(a.pendientes.solicitudes_abiertas).toEqual({
        total: 3,
        urgentes: 0,
      });
      // B: una PENDIENTE MEDIO de siempre + una EN_PROCESO ALTO + una RESUELTO ALTO (temporales).
      const extra = await Promise.all(
        [
          EstadoSolicitudMantenimiento.EN_PROCESO,
          EstadoSolicitudMantenimiento.RESUELTO,
        ].map((estado) =>
          prisma.solicitudMantenimiento.create({
            data: {
              arrendador_id: arrendadorB,
              unidad_id: unidadesB[0],
              inquilino_id: inquilinoB,
              descripcion: 'Urgente',
              urgencia: UrgenciaMantenimiento.ALTO,
              estado,
            },
            select: { id: true },
          }),
        ),
      );
      try {
        const b = await panel(tokenB);
        expect(b.pendientes.solicitudes_abiertas).toEqual({
          total: 2,
          urgentes: 1,
        });
        expect(b.pendientes.mantenimientos_pendientes).toBe(1);
      } finally {
        await prisma.solicitudMantenimiento.deleteMany({
          where: { id: { in: extra.map((s) => s.id) } },
        });
      }
    });

    it('arrendador sin datos: bloques nuevos vacíos o en cero', async () => {
      const c = await panel(tokenC);
      expect(c.morosos).toEqual([]);
      expect(c.anio).toEqual({
        anio: 2027,
        meses: ['2027-01', '2027-02', '2027-03'].map((mes) => ({
          mes,
          actual_centavos: 0,
          anterior_centavos: 0,
        })),
        total_actual_centavos: 0,
        total_anterior_centavos: 0,
        variacion_porcentual: null,
      });
      expect(c.por_inmueble).toEqual([]);
      expect(c.ocupacion.porcentaje).toBeNull();
      expect(c.ocupacion.unidades_detalle).toEqual([]);
      expect(c.pendientes.solicitudes_abiertas).toEqual({
        total: 0,
        urgentes: 0,
      });
    });
  });

  describe('arrendador B y aislamiento', () => {
    it('B ve solo lo suyo, con sus propios números', async () => {
      const b = await panel(tokenB);
      expect(b.recaudo).toEqual({
        esperado_centavos: 2 * MILLON,
        aprobado_centavos: 0,
        en_revision_centavos: 2 * MILLON,
        sin_reportar_centavos: 0,
        contratos: 1,
      });
      expect(b.ingresos_mes_centavos).toBe(0);
      expect(b.mora).toEqual({ contratos: 0, periodos: 0, total_centavos: 0 });
      expect(b.ocupacion).toMatchObject({
        unidades: 2,
        ocupadas: 1,
        libres: 1,
        con_contrato_programado: 0,
      });
      expect(b.pendientes.comprobantes_por_validar).toBe(1);
      expect(b.pendientes.mantenimientos_pendientes).toBe(1);
      expect(b.pendientes.contratos_por_vencer.cantidad).toBe(1);
      expect(b.pendientes.contratos_por_vencer.contratos[0].unidad).toBe(
        'Local B1',
      );
      expect(b.pendientes.incrementos_disponibles.cantidad).toBe(0);
      expect(b.pendientes.terminaciones_por_confirmar.cantidad).toBe(0);
      expect(b.tendencia.slice(-3).map((t) => t.ingresos_centavos)).toEqual([
        2 * MILLON,
        2 * MILLON,
        0,
      ]);
    });

    it('ningún bloque de A trae datos de B ni al revés', async () => {
      const textoA = JSON.stringify(await panel(tokenA));
      const textoB = JSON.stringify(await panel(tokenB));
      expect(textoA).not.toContain('Local B');
      expect(textoA).not.toContain('Carrera B 2');
      expect(textoB).not.toContain('Apto 10');
      expect(textoB).not.toContain('Calle A 1');
      for (const id of Object.values(idsA)) expect(textoB).not.toContain(id);
    });
  });

  describe('arrendador sin datos', () => {
    it('todo en cero y la tendencia con 6 meses en cero', async () => {
      const c = await panel(tokenC);
      expect(camposAntiguos(c)).toEqual({
        mes: '2027-03',
        calculado_para: '2027-03-15',
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
          '2026-10',
          '2026-11',
          '2026-12',
          '2027-01',
          '2027-02',
          '2027-03',
        ].map((mes) => ({
          mes,
          ingresos_centavos: 0,
        })),
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

  describe('eficiencia: el número de consultas no crece con los contratos', () => {
    async function contar(token: string): Promise<number> {
      consultas.length = 0;
      await get('/arrendadores/panel', token).expect(OK);
      return consultas.length;
    }

    it('con 0, 1 y 6 contratos hace las mismas consultas, y con 11 más también', async () => {
      const ninguno = await contar(tokenC);
      const uno = await contar(tokenB);
      const seis = await contar(tokenA);
      expect(uno).toBe(ninguno);
      expect(seis).toBe(ninguno);

      // 10 contratos más (con pagos) para B: 1 → 11 contratos.
      const extra = await crearInmuebleConUnidades(
        arrendadorB,
        'Carrera B 3',
        Array.from({ length: 10 }, (_, i) => `Local X${i}`),
      );
      for (const unidadId of extra.unidades) {
        const id = await nuevoContrato({
          arrendadorId: arrendadorB,
          unidadId,
          inquilinoId: inquilinoB,
          estado: EstadoContrato.ACTIVO,
          inicio: '2027-01-01',
          fin: '2027-12-31',
        });
        await pagarMeses(arrendadorB, id, '2027-01', '2027-03');
      }
      const once = await contar(tokenB);
      console.log(
        `[consultas SQL] GET /arrendadores/panel: ${ninguno} sin contratos, ${uno} con 1, ${seis} con 6 y ${once} con 11`,
      );
      expect(once).toBe(ninguno);
      // Y el resultado sí creció.
      expect((await panel(tokenB)).recaudo.contratos).toBe(11);
    }, 120_000);
  });

  describe('OpenAPI', () => {
    interface Esquema {
      $ref?: string;
      type?: string;
      properties?: Record<string, Esquema>;
      items?: { $ref?: string };
    }
    interface Documento {
      paths: Record<
        string,
        Record<
          string,
          {
            responses: Record<
              string,
              { content?: Record<string, { schema?: Esquema }> }
            >;
          }
        >
      >;
      components: { schemas: Record<string, Esquema> };
    }
    let documento: Documento;
    beforeAll(() => {
      documento = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('t').build(),
      ) as unknown as Documento;
    });

    it('GET /arrendadores/panel devuelve PanelArrendadorDto y documenta el 401', () => {
      const operacion = documento.paths['/arrendadores/panel'].get;
      expect(
        operacion.responses['200'].content?.['application/json']?.schema?.$ref,
      ).toBe('#/components/schemas/PanelArrendadorDto');
      expect(Object.keys(operacion.responses)).toContain('401');
    });

    it('los esquemas del Panel existen, con sus campos y ninguno vacío', () => {
      const esquemas = documento.components.schemas;
      const principal = Object.keys(
        esquemas.PanelArrendadorDto.properties ?? {},
      );
      for (const campo of [
        'mes',
        'calculado_para',
        'ingresos_mes_centavos',
        'recaudo',
        'ocupacion',
        'mora',
        'tendencia',
        'pendientes',
        'morosos',
        'anio',
        'por_inmueble',
      ]) {
        expect(principal).toContain(campo);
      }
      // El estado de la unidad es un enum con nombre propio.
      expect(esquemas.EstadoOcupacionUnidad).toEqual(
        expect.objectContaining({
          enum: ['EN_MORA', 'AL_DIA', 'PROGRAMADA', 'LIBRE'],
        }),
      );
      // Los 11 esquemas de esta entrega existen y ninguno está vacío.
      const delPanel = [
        'PanelArrendadorDto',
        'RecaudoPanelDto',
        'OcupacionPanelDto',
        'MoraPanelDto',
        'TendenciaMesDto',
        'ContratoPendienteDto',
        'IncrementoDisponibleDto',
        'ContratosPorVencerPanelDto',
        'IncrementosDisponiblesPanelDto',
        'TerminacionesPorConfirmarPanelDto',
        'PendientesPanelDto',
        // B0.7-B
        'MorosoPanelDto',
        'UnidadMorosoPanelDto',
        'InmuebleMorosoPanelDto',
        'InquilinoMorosoPanelDto',
        'AnioPanelDto',
        'MesAnioPanelDto',
        'InmueblePanelDto',
        'UnidadOcupacionPanelDto',
        'SolicitudesAbiertasPanelDto',
      ];
      for (const nombre of delPanel) {
        expect(esquemas[nombre]).toBeDefined();
        expect(
          Object.keys(esquemas[nombre].properties ?? {}).length,
        ).toBeGreaterThan(0);
      }
      const pendientes = Object.keys(
        esquemas.PendientesPanelDto.properties ?? {},
      );
      for (const campo of [
        'comprobantes_por_validar',
        'mantenimientos_pendientes',
        'contratos_por_vencer',
        'incrementos_disponibles',
        'terminaciones_por_confirmar',
        'solicitudes_abiertas',
      ]) {
        expect(pendientes).toContain(campo);
      }
    });
  });
});
