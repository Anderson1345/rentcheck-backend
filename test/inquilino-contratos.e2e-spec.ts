import { archivoDePrueba } from './helpers/archivos.helper';
import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AlmacenamientoService } from '../src/almacenamiento/almacenamiento.service';
import { AppModule } from '../src/app.module';
import {
  sumarDiasUTC,
  sumarMesesUTC,
} from '../src/common/fechas-contrato.util';
import { hoyEnBogota } from '../src/common/hoy-bogota.util';
import { configurarApp } from '../src/configurar-app';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  autenticarInquilino,
  crearContrato,
  crearInmueble,
  crearInquilino,
  registrarArrendador,
  vincularContrato,
} from './helpers/crear-datos.helper';
import { limpiarBd } from './helpers/limpiar-bd';

interface ContratoLista {
  id: string;
  estado: string;
  estado_pago: string | null;
  unidad: { id: string; nombre: string; tipo: string };
  inmueble: { direccion: string; ciudad: string };
  [clave: string]: unknown;
}

interface PeriodoCuenta {
  periodo: string;
  fechaLimite: string;
  canonVigenteCentavos: number;
  estado: string;
  montoAprobadoCentavos: number;
}

interface PanelActivo {
  contrato_id: string;
  estado: string;
  fecha_fin: string;
  dias_restantes: number;
  canon_vigente_centavos: number;
  estado_pago: string;
  proximo_periodo: {
    periodo: string;
    fecha_limite: string;
    monto_centavos: number;
    estado: string;
  } | null;
  periodos_vencidos: { cantidad: number; total_pendiente_centavos: number };
}

const CREADO: number = HttpStatus.CREATED;
const OK: number = HttpStatus.OK;
const NO_ENCONTRADO: number = HttpStatus.NOT_FOUND;
const NO_AUTORIZADO: number = HttpStatus.UNAUTHORIZED;

const iso = (fecha: Date): string => fecha.toISOString().slice(0, 10);

describe('Portal del inquilino por contrato (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let almacenamiento: AlmacenamientoService;
  let contador = 0;
  const hoy = hoyEnBogota();

  beforeEach(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await limpiarBd(prisma);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configurarApp(app);
    almacenamiento = moduleFixture.get(AlmacenamientoService);
    await app.init();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
    await prisma.$disconnect();
  });

  afterAll(async () => {
    await prisma.$connect();
    await limpiarBd(prisma);
    await prisma.$disconnect();
  });

  /** Arrendador, una persona con cuenta y su primer contrato (ya vinculado). */
  async function persona(fechas: { inicio?: Date; fin?: Date } = {}) {
    contador += 1;
    const { access_token } = await registrarArrendador(
      app,
      `Arrendador ${contador}`,
      `portal-${contador}@correo.com`,
    );
    const ficha = await crearInquilino(app, access_token);
    const primero = await nuevoContrato(access_token, ficha.id, fechas);
    const inq = await autenticarInquilino(
      app,
      primero.codigo,
      `portal-inq-${contador}@correo.com`,
    );
    return { arr: access_token, ficha: ficha.id, primero, inq };
  }

  async function nuevoContrato(
    token: string,
    fichaId: string,
    fechas: { inicio?: Date; fin?: Date } = {},
    extra: Record<string, unknown> = {},
  ) {
    contador += 1;
    const inmueble = await crearInmueble(app, token, `PORTAL-${contador}`);
    const contrato = await crearContrato(
      app,
      token,
      inmueble.unidades[0].id,
      fichaId,
      {
        ...(fechas.inicio ? { fecha_inicio: iso(fechas.inicio) } : {}),
        ...(fechas.fin ? { fecha_fin: iso(fechas.fin) } : {}),
        ...extra,
      },
    );
    return {
      id: contrato.id,
      codigo: contrato.codigo_acceso?.codigo ?? '',
      unidadId: inmueble.unidades[0].id,
    };
  }

  const get = (token: string, ruta: string) =>
    request(app.getHttpServer())
      .get(ruta)
      .set('Authorization', `Bearer ${token}`);

  const post = (token: string, ruta: string, cuerpo: object = {}) =>
    request(app.getHttpServer())
      .post(ruta)
      .set('Authorization', `Bearer ${token}`)
      .send(cuerpo);

  const estadoCuentaArrendador = async (arr: string, contratoId: string) =>
    (
      (await get(arr, `/contratos/${contratoId}/estado-cuenta`).expect(OK))
        .body as { estadoPago: string; periodos: PeriodoCuenta[] }
    ).periodos;

  async function configurarIpc() {
    await prisma.configuracionIpc.create({
      data: { anio: hoy.getUTCFullYear() - 1, porcentaje: 5.1 },
    });
  }

  async function reportarYAprobar(
    arr: string,
    inq: string,
    contratoId: string,
    periodo: string,
  ) {
    const pago = await request(app.getHttpServer())
      .post('/pagos')
      .set('Authorization', `Bearer ${inq}`)
      .field('contratoId', contratoId)
      .field('monto_centavos', '1000000')
      .field('fecha_reportada', iso(hoy))
      .field('periodo', periodo.slice(0, 10))
      .attach('comprobante', archivoDePrueba('png', 'comprobante'), {
        filename: 'c.png',
        contentType: 'image/png',
      })
      .expect(CREADO);
    await request(app.getHttpServer())
      .patch(`/pagos/${(pago.body as { id: string }).id}/aprobar`)
      .set('Authorization', `Bearer ${arr}`)
      .expect(OK);
  }

  // ------------------------------------------------------------------
  // Listado
  // ------------------------------------------------------------------
  it('GET /inquilino/contratos lista los vinculados no cancelados: ACTIVO primero, luego PROGRAMADO, luego el resto por creación descendente', async () => {
    const { arr, ficha, primero, inq } = await persona();
    const c2 = await nuevoContrato(arr, ficha);
    const c3 = await nuevoContrato(arr, ficha, {
      inicio: sumarDiasUTC(hoy, 10),
      fin: sumarDiasUTC(hoy, 375),
    });
    const c4 = await nuevoContrato(arr, ficha);
    const sinVincular = await nuevoContrato(arr, ficha);
    const cancelado = await nuevoContrato(arr, ficha, {
      inicio: sumarDiasUTC(hoy, 20),
      fin: sumarDiasUTC(hoy, 385),
    });
    await vincularContrato(app, inq, c2.codigo).expect(OK);
    await vincularContrato(app, inq, c3.codigo).expect(OK);
    await vincularContrato(app, inq, c4.codigo).expect(OK);
    await vincularContrato(app, inq, cancelado.codigo).expect(OK);
    await post(arr, `/contratos/${cancelado.id}/cancelar-programado`).expect(
      CREADO,
    );
    await prisma.contrato.update({
      where: { id: c2.id },
      data: { estado: 'VENCIDO' },
    });
    // Un contrato de otra persona no aparece.
    const otra = await persona();
    expect(otra.primero.id).toBeTruthy();

    const respuesta = await get(inq, '/inquilino/contratos').expect(OK);
    const lista = respuesta.body as ContratoLista[];

    expect(lista.map((c) => c.id)).toEqual([c4.id, primero.id, c3.id, c2.id]);
    expect(lista.map((c) => c.estado)).toEqual([
      'ACTIVO',
      'ACTIVO',
      'PROGRAMADO',
      'VENCIDO',
    ]);
    for (const contrato of lista) {
      expect(contrato.unidad).toEqual({
        id: expect.any(String) as string, // B-66
        nombre: expect.any(String) as string,
        tipo: expect.any(String) as string,
      });
      expect(contrato.inmueble).toHaveProperty('direccion');
      expect(contrato.inmueble).toHaveProperty('ciudad');
      expect(contrato).not.toHaveProperty('datos_recaudo');
      expect(contrato).not.toHaveProperty('pdf_contrato_ruta');
    }
    expect(['al_dia', 'en_mora', 'pendiente']).toContain(lista[0].estado_pago);
    expect(lista[2].estado_pago).toBeNull();
    expect(lista[3].estado_pago).toBeNull();
    expect(sinVincular.id).not.toBe(c2.id);
  }, 180000);

  // ------------------------------------------------------------------
  // Helper: 404 en todas las rutas por id
  // ------------------------------------------------------------------
  it('toda ruta por id responde 404 con contrato ajeno, sin vincular, CANCELADO, inexistente o id inválido, y 401 sin token', async () => {
    const { arr, ficha, primero, inq } = await persona();
    const sinVincular = await nuevoContrato(arr, ficha);
    const cancelado = await nuevoContrato(arr, ficha, {
      inicio: sumarDiasUTC(hoy, 20),
      fin: sumarDiasUTC(hoy, 385),
    });
    await vincularContrato(app, inq, cancelado.codigo).expect(OK);
    await post(arr, `/contratos/${cancelado.id}/cancelar-programado`).expect(
      CREADO,
    );
    const ajeno = (await persona()).primero;

    const rutas: Array<['get' | 'post', string, object?]> = [
      ['get', ''],
      ['get', '/panel'],
      ['get', '/estado-cuenta'],
      ['get', '/documentos'],
      [
        'post',
        '/solicitar-terminacion-anticipada',
        { motivo: 'x', fecha_efectiva: iso(sumarDiasUTC(hoy, 5)) },
      ],
      ['post', '/confirmar-terminacion-anticipada'],
      ['post', '/cancelar-terminacion-anticipada'],
      ['post', '/aviso-no-renovacion', {}],
      ['post', '/cancelar-aviso-no-renovacion'],
    ];
    const ids = [
      ajeno.id,
      sinVincular.id,
      cancelado.id,
      '00000000-0000-4000-8000-000000000000',
      'no-es-un-id',
    ];
    for (const [metodo, sufijo, cuerpo] of rutas) {
      for (const id of ids) {
        const ruta = `/inquilino/contratos/${id}${sufijo}`;
        const respuesta =
          metodo === 'get'
            ? await get(inq, ruta)
            : await post(inq, ruta, cuerpo);
        expect([metodo, ruta, respuesta.status]).toEqual([
          metodo,
          ruta,
          NO_ENCONTRADO,
        ]);
      }
      const propia = `/inquilino/contratos/${primero.id}${sufijo}`;
      const sinToken =
        metodo === 'get'
          ? await request(app.getHttpServer()).get(propia)
          : await request(app.getHttpServer())
              .post(propia)
              .send(cuerpo ?? {});
      expect([propia, sinToken.status]).toEqual([propia, NO_AUTORIZADO]);
    }
    // Nada se escribió en los contratos ajenos o sin vincular.
    const escritos = await prisma.contrato.count({
      where: {
        id: { in: [ajeno.id, sinVincular.id, cancelado.id] },
        terminacionAnticipadaSolicitada: true,
      },
    });
    expect(escritos).toBe(0);
    expect(await prisma.avisoNoRenovacion.count()).toBe(0);
  }, 240000);

  // ------------------------------------------------------------------
  // Panel con estado de cuenta
  // ------------------------------------------------------------------
  it('panel por id: canon vigente tras un incremento, estado en mora y períodos vencidos coherentes con el estado de cuenta', async () => {
    await configurarIpc();
    const { arr, primero, inq } = await persona({
      inicio: sumarMesesUTC(hoy, -13),
      fin: sumarDiasUTC(hoy, 60),
    });
    await post(arr, `/contratos/${primero.id}/aplicar-incremento`).expect(
      CREADO,
    );

    const panel = (
      await get(inq, `/inquilino/contratos/${primero.id}/panel`).expect(OK)
    ).body as PanelActivo;
    const periodos = await estadoCuentaArrendador(arr, primero.id);
    const vencidos = periodos.filter(
      (p) => p.estado === 'VENCIDO' || p.estado === 'PARCIAL',
    );
    const primeroSinPagar = periodos.find((p) => p.estado !== 'PAGADO');

    expect(panel).toMatchObject({
      contrato_id: primero.id,
      estado: 'ACTIVO',
      canon_vigente_centavos: 1_051_000,
      estado_pago: 'en_mora',
    });
    expect(panel.canon_vigente_centavos).not.toBe(1_000_000);
    expect(panel.periodos_vencidos.cantidad).toBe(vencidos.length);
    expect(panel.periodos_vencidos.cantidad).toBeGreaterThan(0);
    expect(panel.periodos_vencidos.total_pendiente_centavos).toBe(
      vencidos.reduce(
        (suma, p) => suma + p.canonVigenteCentavos - p.montoAprobadoCentavos,
        0,
      ),
    );
    expect(panel.proximo_periodo?.periodo.slice(0, 10)).toBe(
      primeroSinPagar?.periodo.slice(0, 10),
    );
    expect(panel.proximo_periodo?.fecha_limite.slice(0, 10)).toBe(
      primeroSinPagar?.fechaLimite.slice(0, 10),
    );
    expect(panel.dias_restantes).toBe(60);
  }, 120000);

  it('con pagos adelantados, el próximo período es el primero no pagado', async () => {
    const { arr, primero, inq } = await persona({
      inicio: sumarDiasUTC(hoy, -70),
      fin: sumarDiasUTC(hoy, 300),
    });
    const periodos = await estadoCuentaArrendador(arr, primero.id);
    expect(periodos.length).toBeGreaterThanOrEqual(3);
    // Se paga el primero y el último; queda sin pagar el segundo.
    await reportarYAprobar(arr, inq, primero.id, periodos[0].periodo);
    await reportarYAprobar(
      arr,
      inq,
      primero.id,
      periodos[periodos.length - 1].periodo,
    );

    const panel = (
      await get(inq, `/inquilino/contratos/${primero.id}/panel`).expect(OK)
    ).body as PanelActivo;

    expect(panel.proximo_periodo?.periodo.slice(0, 10)).toBe(
      periodos[1].periodo.slice(0, 10),
    );
    expect(panel.proximo_periodo?.monto_centavos).toBe(1_000_000);
  }, 180000);

  it('mi-panel (alias obsoleto) y contratos/:id/panel coinciden en los datos y mi-panel conserva su forma', async () => {
    const { arr, primero, inq } = await persona({
      inicio: sumarDiasUTC(hoy, -40),
      fin: sumarDiasUTC(hoy, 200),
    });
    expect(arr).toBeTruthy();

    const nuevo = (
      await get(inq, `/inquilino/contratos/${primero.id}/panel`).expect(OK)
    ).body as PanelActivo;
    const alias = (await get(inq, '/inquilino/mi-panel').expect(OK)).body as {
      proximoPago: { monto_centavos: number; fecha: string } | null;
      estadoPago: string;
      diasRestantes: number;
    };

    expect(alias.estadoPago).toBe(nuevo.estado_pago);
    expect(alias.diasRestantes).toBe(nuevo.dias_restantes);
    expect(alias.proximoPago?.monto_centavos).toBe(
      nuevo.proximo_periodo?.monto_centavos,
    );
    expect(alias.proximoPago?.fecha.slice(0, 10)).toBe(
      nuevo.proximo_periodo?.fecha_limite.slice(0, 10),
    );
    expect(Object.keys(alias).sort()).toEqual([
      'diasRestantes',
      'estadoPago',
      'proximoPago',
    ]);
  }, 120000);

  // ------------------------------------------------------------------
  // Detalle y documentos
  // ------------------------------------------------------------------
  it('el detalle por id trae documentos; la lista de documentos incluye original y otrosí y una firma fallida no tumba el listado', async () => {
    await configurarIpc();
    const { arr, primero, inq } = await persona({
      inicio: sumarMesesUTC(hoy, -13),
      fin: sumarDiasUTC(hoy, 60),
    });
    await post(arr, `/contratos/${primero.id}/aplicar-incremento`).expect(
      CREADO,
    );

    const detalle = await get(inq, `/inquilino/contratos/${primero.id}`).expect(
      OK,
    );
    const cuerpo = detalle.body as {
      contratoId: string;
      documentos: Array<{ tipo: string; version: number }>;
      datos_recaudo: string | null;
    };
    expect(cuerpo.contratoId).toBe(primero.id);
    expect(cuerpo.documentos.map((d) => [d.version, d.tipo])).toEqual([
      [1, 'CONTRATO_ORIGINAL'],
      [2, 'OTROSI_INCREMENTO'],
    ]);
    expect(cuerpo.datos_recaudo).toBeTruthy();

    jest
      .spyOn(almacenamiento, 'generarUrlFirmada')
      .mockRejectedValueOnce(new Error('firma fallida'));
    const lista = await get(
      inq,
      `/inquilino/contratos/${primero.id}/documentos`,
    ).expect(OK);
    const documentos = lista.body as Array<{
      version: number;
      hash_sha256: string | null;
      url_firmada: string | null;
    }>;
    expect(documentos).toHaveLength(2);
    expect(documentos.filter((d) => d.url_firmada === null)).toHaveLength(1);
    expect(documentos.filter((d) => d.url_firmada !== null)).toHaveLength(1);
    for (const documento of documentos) {
      expect(documento).not.toHaveProperty('ruta');
      expect(documento.hash_sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  }, 120000);

  // ------------------------------------------------------------------
  // Terminación por id, solicitudes y pagos por contrato
  // ------------------------------------------------------------------
  it('la terminación por id actúa sobre ese contrato aunque no sea el "actual"', async () => {
    const { arr, ficha, primero, inq } = await persona();
    const segundo = await nuevoContrato(arr, ficha);
    await vincularContrato(app, inq, segundo.codigo).expect(OK);

    const respuesta = await post(
      inq,
      `/inquilino/contratos/${primero.id}/solicitar-terminacion-anticipada`,
      { motivo: 'Me mudo', fecha_efectiva: iso(sumarDiasUTC(hoy, 10)) },
    ).expect(CREADO);

    expect(
      (respuesta.body as { terminacion_anticipada: { estado: string } })
        .terminacion_anticipada.estado,
    ).toBe('SOLICITADA');
    expect(
      (await prisma.contrato.findUniqueOrThrow({ where: { id: primero.id } }))
        .terminacionAnticipadaSolicitada,
    ).toBe(true);
    expect(
      (await prisma.contrato.findUniqueOrThrow({ where: { id: segundo.id } }))
        .terminacionAnticipadaSolicitada,
    ).toBe(false);
  }, 120000);

  it('GET /inquilino/solicitudes (con ?contratoId=) y /:id solo de unidades con contrato vinculado; pagos/mios acepta ?contratoId=', async () => {
    const { arr, ficha, primero, inq } = await persona();
    const segundo = await nuevoContrato(arr, ficha);
    await vincularContrato(app, inq, segundo.codigo).expect(OK);
    const sinVincular = await nuevoContrato(arr, ficha);
    const crearSolicitud = async (unidadId: string) =>
      (
        await request(app.getHttpServer())
          .post('/solicitudes-mantenimiento')
          .set('Authorization', `Bearer ${inq}`)
          .field('unidadId', unidadId)
          .field('descripcion', 'Fuga')
          .field('urgencia', 'ALTO')
          .expect(CREADO)
      ).body as { id: string };
    const s1 = await crearSolicitud(primero.unidadId);
    const s2 = await crearSolicitud(segundo.unidadId);
    // Una solicitud de una unidad cuyo contrato no está vinculado.
    const huerfana = await prisma.solicitudMantenimiento.create({
      data: {
        arrendador_id: (
          await prisma.contrato.findUniqueOrThrow({
            where: { id: sinVincular.id },
          })
        ).arrendador_id,
        unidad_id: sinVincular.unidadId,
        inquilino_id: (
          await prisma.contrato.findUniqueOrThrow({
            where: { id: primero.id },
          })
        ).inquilino_id,
        descripcion: 'No debe verse',
        urgencia: 'BAJO',
      },
    });

    const todas = (await get(inq, '/inquilino/solicitudes').expect(OK))
      .body as Array<{ id: string }>;
    expect(todas.map((s) => s.id).sort()).toEqual([s1.id, s2.id].sort());
    const deUno = (
      await get(inq, `/inquilino/solicitudes?contratoId=${primero.id}`).expect(
        OK,
      )
    ).body as Array<{ id: string }>;
    expect(deUno.map((s) => s.id)).toEqual([s1.id]);
    await get(
      inq,
      `/inquilino/solicitudes?contratoId=${sinVincular.id}`,
    ).expect(NO_ENCONTRADO);

    await get(inq, `/inquilino/solicitudes/${s1.id}`).expect(OK);
    await get(inq, `/inquilino/solicitudes/${huerfana.id}`).expect(
      NO_ENCONTRADO,
    );
    await get(inq, '/inquilino/solicitudes/no-es-un-id').expect(NO_ENCONTRADO);

    // Pagos por contrato.
    const periodos = await estadoCuentaArrendador(arr, primero.id);
    await reportarYAprobar(arr, inq, primero.id, periodos[0].periodo);
    const todosLosPagos = (await get(inq, '/pagos/mios').expect(OK))
      .body as unknown[];
    const pagosDelPrimero = (
      await get(inq, `/pagos/mios?contratoId=${primero.id}`).expect(OK)
    ).body as unknown[];
    const pagosDelSegundo = (
      await get(inq, `/pagos/mios?contratoId=${segundo.id}`).expect(OK)
    ).body as unknown[];
    expect(todosLosPagos).toHaveLength(1);
    expect(pagosDelPrimero).toHaveLength(1);
    expect(pagosDelSegundo).toHaveLength(0);
    await get(inq, `/pagos/mios?contratoId=${sinVincular.id}`).expect(
      NO_ENCONTRADO,
    );
  }, 240000);
});
