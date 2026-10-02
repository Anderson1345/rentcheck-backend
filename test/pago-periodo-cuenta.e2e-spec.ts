import { HttpStatus, INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test, TestingModule } from '@nestjs/testing';
import {
  EstadoContrato,
  EstadoPago,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/configurar-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { archivoDePrueba } from './helpers/archivos.helper';
import {
  autenticarInquilino,
  crearContrato,
  crearInmueble,
  crearInquilino,
  registrarArrendador,
  RespuestaCrearContrato,
  vincularContrato,
} from './helpers/crear-datos.helper';
import { enDias } from './helpers/fechas.helper';
import { limpiarBd } from './helpers/limpiar-bd';

// Escenario único (se prepara una vez): pagos creados directo con Prisma en períodos de contratos
// reales, para controlar el estado de cada período, y comparados con GET /contratos/:id/estado-cuenta.
jest.setTimeout(180_000);

const OK = HttpStatus.OK;

interface PeriodoApi {
  periodo: string;
  fechaLimite: string;
  canonVigenteCentavos: number;
  estado: string;
  montoAprobadoCentavos: number;
}

interface PeriodoCuentaApi {
  canon_vigente_centavos: number;
  fecha_limite: string;
  monto_aprobado_centavos: number;
  estado: string;
}

interface PagoApi {
  id: string;
  contrato_id: string;
  periodo: string;
  estado: string;
  comprobante_ruta?: unknown;
  comprobante_url: string | null;
  comprobante_tipo: 'IMAGEN' | 'PDF' | null;
  periodo_cuenta: PeriodoCuentaApi | null;
  contrato?: {
    id: string;
    unidad: { inmueble: { id: string } };
    inquilino: { id: string };
  };
}

function idDelToken(token: string): string {
  return (
    JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
    ) as {
      id: string;
    }
  ).id;
}

describe('periodo_cuenta y comprobante_tipo en los pagos (e2e, B-61 y B-63)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let prismaDeLaApp: PrismaClient<Prisma.PrismaClientOptions, 'query'>;
  const consultas: string[] = [];

  let tokenA: string;
  let arrendadorA: string;
  let tokenB: string;
  let tokenInquilino: string;
  let tokenInquilinoOtro: string;
  let contratoA: RespuestaCrearContrato; // desde hace 150 días: varios períodos
  let contratoB: RespuestaCrearContrato; // empieza hoy: un período (PENDIENTE)
  let contratoD: RespuestaCrearContrato; // empieza hoy: para los POST reales
  let contratoT: RespuestaCrearContrato; // terminado anticipadamente
  let periodosA: PeriodoApi[];
  let periodosB: PeriodoApi[];
  let siguienteAnio = 2000;

  beforeAll(async () => {
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

    const a = await registrarArrendador(
      app,
      'Arrendador A',
      'cuenta-a@correo.com',
    );
    tokenA = a.access_token;
    arrendadorA = idDelToken(tokenA);
    const b = await registrarArrendador(
      app,
      'Arrendador B',
      'cuenta-b@correo.com',
    );
    tokenB = b.access_token;

    const inquilino = await crearInquilino(app, tokenA);
    const contratoEn = async (
      matricula: string,
      extra: Record<string, unknown>,
    ) => {
      const inmueble = await crearInmueble(app, tokenA, matricula);
      return crearContrato(
        app,
        tokenA,
        inmueble.unidades[0].id,
        inquilino.id,
        extra,
      );
    };
    contratoA = await contratoEn('CTA-100001', { fecha_inicio: enDias(-150) });
    contratoB = await contratoEn('CTA-100002', { fecha_inicio: enDias(0) });
    contratoD = await contratoEn('CTA-100003', { fecha_inicio: enDias(0) });
    contratoT = await contratoEn('CTA-100004', { fecha_inicio: enDias(-150) });

    // El inquilino vincula el primero al registrarse y los demás con su código.
    tokenInquilino = await autenticarInquilino(
      app,
      contratoA.codigo_acceso?.codigo ?? '',
      'inquilino-cuenta@correo.com',
    );
    for (const c of [contratoB, contratoD]) {
      await vincularContrato(
        app,
        tokenInquilino,
        c.codigo_acceso?.codigo ?? '',
      ).expect(OK);
    }

    // Otro arrendador con su inquilino: para comprobar el aislamiento.
    const inmuebleB = await crearInmueble(app, tokenB, 'CTB-200001');
    const inquilinoB = await crearInquilino(app, tokenB);
    const contratoOtro = await crearContrato(
      app,
      tokenB,
      inmuebleB.unidades[0].id,
      inquilinoB.id,
    );
    tokenInquilinoOtro = await autenticarInquilino(
      app,
      contratoOtro.codigo_acceso?.codigo ?? '',
      'inquilino-otro@correo.com',
    );

    periodosA = await cuentaDe(contratoA.id);
    periodosB = await cuentaDe(contratoB.id);
    expect(periodosB.length).toBe(1);
    expect(periodosA.length).toBeGreaterThanOrEqual(4);
  });

  afterAll(async () => {
    await limpiarBd(prisma);
    await app.close();
    await prismaDeLaApp.$disconnect();
    await prisma.$disconnect();
  });

  // ---- ayudas ----

  const get = (ruta: string, token: string) =>
    request(app.getHttpServer())
      .get(ruta)
      .set('Authorization', `Bearer ${token}`);
  const patch = (ruta: string, token: string) =>
    request(app.getHttpServer())
      .patch(ruta)
      .set('Authorization', `Bearer ${token}`);

  async function cuentaDe(contratoId: string): Promise<PeriodoApi[]> {
    const body: unknown = (
      await get(`/contratos/${contratoId}/estado-cuenta`, tokenA).expect(OK)
    ).body;
    return (body as { periodos: PeriodoApi[] }).periodos;
  }

  /** Lo que debería traer el pago según el estado de cuenta del contrato (la misma regla). */
  function esperadoDe(
    periodos: PeriodoApi[],
    periodoIso: string,
  ): PeriodoCuentaApi | null {
    const p = periodos.find(
      (x) => x.periodo.slice(0, 7) === periodoIso.slice(0, 7),
    );
    return p
      ? {
          canon_vigente_centavos: p.canonVigenteCentavos,
          fecha_limite: p.fechaLimite,
          monto_aprobado_centavos: p.montoAprobadoCentavos,
          estado: p.estado,
        }
      : null;
  }

  async function crearPago(
    contratoId: string,
    periodo: Date,
    estado: EstadoPago,
    monto = 1_000_000,
    ruta: string | null = null,
  ): Promise<string> {
    const pago = await prisma.pago.create({
      data: {
        arrendador_id: arrendadorA,
        contrato_id: contratoId,
        monto_centavos: monto,
        fecha_reportada: new Date(),
        periodo,
        estado,
        comprobante_ruta: ruta,
      },
      select: { id: true },
    });
    return pago.id;
  }

  const periodoDe = (iso: string) => new Date(iso);
  /** El único período del contrato B (empieza hoy). */
  const periodoB = () => new Date(periodosB[0].periodo);

  // ---- escenario del contrato A ----
  let rechazado: string;
  let parcial: string;
  let pagado: string;
  let enRevision: string;

  describe('escenario del contrato con varios períodos', () => {
    beforeAll(async () => {
      const [p0, p1, p2, p3] = periodosA;
      rechazado = await crearPago(
        contratoA.id,
        periodoDe(p0.periodo),
        EstadoPago.RECHAZADO,
      );
      parcial = await crearPago(
        contratoA.id,
        periodoDe(p1.periodo),
        EstadoPago.APROBADO,
        400_000,
      );
      pagado = await crearPago(
        contratoA.id,
        periodoDe(p2.periodo),
        EstadoPago.APROBADO,
        1_000_000,
      );
      enRevision = await crearPago(
        contratoA.id,
        periodoDe(p3.periodo),
        EstadoPago.PENDIENTE,
      );
    });

    it('GET /pagos: cada pago trae periodo_cuenta y coincide con el estado de cuenta del contrato', async () => {
      const cuenta = await cuentaDe(contratoA.id);
      const body: unknown = (await get('/pagos', tokenA).expect(OK)).body;
      const pagos = body as PagoApi[];
      for (const id of [rechazado, parcial, pagado, enRevision]) {
        const p = pagos.find((x) => x.id === id);
        expect(p).toBeDefined();
        expect(p?.periodo_cuenta).toEqual(esperadoDe(cuenta, p?.periodo ?? ''));
      }
    });

    it('cubre los estados del período: vencido, parcial, pagado y en revisión', async () => {
      const body: unknown = (await get('/pagos', tokenA).expect(OK)).body;
      const estadoDe = (id: string) =>
        (body as PagoApi[]).find((p) => p.id === id)?.periodo_cuenta;
      expect(estadoDe(rechazado)).toMatchObject({
        estado: 'VENCIDO',
        monto_aprobado_centavos: 0,
      });
      expect(estadoDe(parcial)).toMatchObject({
        estado: 'PARCIAL',
        monto_aprobado_centavos: 400_000,
        canon_vigente_centavos: 1_000_000,
      });
      expect(estadoDe(pagado)).toMatchObject({
        estado: 'PAGADO',
        monto_aprobado_centavos: 1_000_000,
      });
      expect(estadoDe(enRevision)).toMatchObject({ estado: 'EN_REVISION' });
    });

    it('GET /pagos/:id trae el mismo bloque', async () => {
      const cuenta = await cuentaDe(contratoA.id);
      for (const id of [rechazado, parcial, pagado, enRevision]) {
        const body: unknown = (await get(`/pagos/${id}`, tokenA).expect(OK))
          .body;
        const p = body as PagoApi;
        expect(p.periodo_cuenta).toEqual(esperadoDe(cuenta, p.periodo));
        expect(p.periodo_cuenta).not.toBeNull();
      }
    });

    it('GET /pagos/mios y ?contratoId=: el inquilino ve el bloque de cada uno de sus pagos', async () => {
      const cuenta = await cuentaDe(contratoA.id);
      for (const ruta of [
        '/pagos/mios',
        `/pagos/mios?contratoId=${contratoA.id}`,
      ]) {
        const body: unknown = (await get(ruta, tokenInquilino).expect(OK)).body;
        const pagos = body as PagoApi[];
        const p = pagos.find((x) => x.id === parcial);
        expect(p?.periodo_cuenta).toEqual(esperadoDe(cuenta, p?.periodo ?? ''));
        expect(p?.periodo_cuenta?.estado).toBe('PARCIAL');
      }
    });

    it('los pagos de varios contratos en un listado reciben cada uno SU periodo_cuenta', async () => {
      const unoDeB = await crearPago(
        contratoB.id,
        periodoB(),
        EstadoPago.PENDIENTE,
      );
      const cuentaA = await cuentaDe(contratoA.id);
      const cuentaB = await cuentaDe(contratoB.id);
      const body: unknown = (
        await get('/pagos/mios', tokenInquilino).expect(OK)
      ).body;
      const pagos = body as PagoApi[];
      const deA = pagos.find((p) => p.id === enRevision);
      const deB = pagos.find((p) => p.id === unoDeB);
      expect(deA?.contrato_id).toBe(contratoA.id);
      expect(deB?.contrato_id).toBe(contratoB.id);
      expect(deA?.periodo_cuenta).toEqual(
        esperadoDe(cuentaA, deA?.periodo ?? ''),
      );
      expect(deB?.periodo_cuenta).toEqual(
        esperadoDe(cuentaB, deB?.periodo ?? ''),
      );
      expect(deB?.periodo_cuenta?.estado).toBe('EN_REVISION');
      await prisma.pago.delete({ where: { id: unoDeB } });
    });

    it('un período sin pagos aprobados que aún no vence es PENDIENTE (con rechazado en el período)', async () => {
      const periodo = periodoB();
      const id = await crearPago(contratoB.id, periodo, EstadoPago.RECHAZADO);
      const body: unknown = (await get(`/pagos/${id}`, tokenA).expect(OK)).body;
      const cuenta = await cuentaDe(contratoB.id);
      expect((body as PagoApi).periodo_cuenta).toEqual(
        esperadoDe(cuenta, periodo.toISOString()),
      );
      expect((body as PagoApi).periodo_cuenta?.estado).toBe('PENDIENTE');
      await prisma.pago.delete({ where: { id } });
    });

    it('un pago cuyo período no aparece en el cálculo trae periodo_cuenta null y no rompe nada', async () => {
      siguienteAnio += 1;
      const id = await crearPago(
        contratoA.id,
        new Date(Date.UTC(siguienteAnio, 0, 1)),
        EstadoPago.REEMPLAZADO,
      );
      const lista = await get('/pagos', tokenA).expect(OK);
      const p = (lista.body as PagoApi[]).find((x) => x.id === id);
      expect(p).toBeDefined();
      expect(p?.periodo_cuenta).toBeNull();
      const detalle = await get(`/pagos/${id}`, tokenA).expect(OK);
      expect((detalle.body as PagoApi).periodo_cuenta).toBeNull();
    });

    it('no se pierde ningún campo anterior del pago ni se expone la ruta interna', async () => {
      const body: unknown = (await get(`/pagos/${parcial}`, tokenA).expect(OK))
        .body;
      const p = body as Record<string, unknown>;
      for (const campo of [
        'id',
        'arrendador_id',
        'contrato_id',
        'monto_centavos',
        'fecha_reportada',
        'periodo',
        'estado',
        'motivo_rechazo',
        'mensaje_rechazo',
        'creado_en',
        'actualizado_en',
        'comprobante_url',
        'comprobante_tipo',
        'periodo_cuenta',
        'contrato',
      ]) {
        expect(p).toHaveProperty(campo);
      }
      expect(p).not.toHaveProperty('comprobante_ruta');
      const contrato = p.contrato as Record<string, unknown>;
      for (const campo of [
        'id',
        'canon_centavos',
        'dia_pago',
        'estado',
        'unidad',
        'inquilino',
      ]) {
        expect(contrato).toHaveProperty(campo);
      }
    });
  });

  describe('comprobante_tipo de pagos existentes (se deriva de la ruta guardada)', () => {
    it.each([
      ['pagos/x/1-recibo.pdf', 'PDF'],
      ['pagos/x/1-recibo.PDF', 'PDF'],
      ['pagos/x/1-foto.jpg', 'IMAGEN'],
      ['pagos/x/1-foto.png', 'IMAGEN'],
      ['pagos/x/1-recibo', null],
      ['pagos/x/1-recibo.docx', null],
      [null, null],
    ])('ruta %s → %s', async (ruta, tipo) => {
      siguienteAnio += 1;
      const id = await crearPago(
        contratoA.id,
        new Date(Date.UTC(siguienteAnio, 0, 1)),
        EstadoPago.REEMPLAZADO,
        1,
        ruta,
      );
      const body: unknown = (await get(`/pagos/${id}`, tokenA).expect(OK)).body;
      expect((body as PagoApi).comprobante_tipo).toBe(tipo);
      expect(body).not.toHaveProperty('comprobante_ruta');
    });
  });

  describe('pagos nuevos (POST /pagos): tipo y extensión según el contenido real', () => {
    function reportar(
      bytes: Buffer,
      nombre: string,
      mimetype: string,
      token = tokenInquilino,
    ) {
      return request(app.getHttpServer())
        .post('/pagos')
        .set('Authorization', `Bearer ${token}`)
        .field('contratoId', contratoD.id)
        .field('monto_centavos', '1000000')
        .field('fecha_reportada', enDias(0))
        .attach('comprobante', bytes, {
          filename: nombre,
          contentType: mimetype,
        });
    }
    const rutaDe = async (id: string) =>
      (
        await prisma.pago.findUniqueOrThrow({
          where: { id },
          select: { comprobante_ruta: true },
        })
      ).comprobante_ruta ?? '';

    it('PDF con nombre que dice .jpg: tipo PDF y la ruta termina en .pdf; trae periodo_cuenta (EN_REVISION)', async () => {
      const r = await reportar(
        archivoDePrueba('pdf', 'uno'),
        'foto.jpg',
        'application/pdf',
      ).expect(HttpStatus.CREATED);
      const p = r.body as PagoApi;
      expect(p.comprobante_tipo).toBe('PDF');
      expect(await rutaDe(p.id)).toMatch(/\.pdf$/);
      expect(p.periodo_cuenta).toMatchObject({ estado: 'EN_REVISION' });
      const cuenta = await cuentaDe(contratoD.id);
      expect(p.periodo_cuenta).toEqual(esperadoDe(cuenta, p.periodo));
      expect(p).not.toHaveProperty('comprobante_ruta');
    });

    it('JPG con nombre que dice .pdf: tipo IMAGEN y la ruta termina en .jpg', async () => {
      const r = await reportar(
        archivoDePrueba('jpeg', 'dos'),
        'recibo.pdf',
        'image/jpeg',
      ).expect(HttpStatus.CREATED);
      const p = r.body as PagoApi;
      expect(p.comprobante_tipo).toBe('IMAGEN');
      expect(await rutaDe(p.id)).toMatch(/\.jpg$/);
    });

    it('PNG con nombre sin extensión: tipo IMAGEN y la ruta termina en .png', async () => {
      const r = await reportar(
        archivoDePrueba('png', 'tres'),
        'comprobante',
        'image/png',
      ).expect(HttpStatus.CREATED);
      const p = r.body as PagoApi;
      expect(p.comprobante_tipo).toBe('IMAGEN');
      expect(await rutaDe(p.id)).toMatch(/\.png$/);
    });

    it('contenido que no coincide con lo declarado: 415 y no se guarda nada', async () => {
      const antes = await prisma.pago.count({
        where: { contrato_id: contratoD.id },
      });
      await reportar(
        archivoDePrueba('png', 'cuatro'),
        'recibo.pdf',
        'application/pdf',
      ).expect(HttpStatus.UNSUPPORTED_MEDIA_TYPE);
      expect(
        await prisma.pago.count({ where: { contrato_id: contratoD.id } }),
      ).toBe(antes);
    });
  });

  describe('aprobar y rechazar: el bloque refleja el estado NUEVO', () => {
    it('aprobar parcial: monto_aprobado y estado nuevos, iguales al estado de cuenta', async () => {
      const id = await crearPago(
        contratoB.id,
        periodoB(),
        EstadoPago.PENDIENTE,
        400_000,
      );
      const antes = (await get(`/pagos/${id}`, tokenA).expect(OK))
        .body as PagoApi;
      expect(antes.periodo_cuenta?.estado).toBe('EN_REVISION');
      expect(antes.periodo_cuenta?.monto_aprobado_centavos).toBe(0);

      const body: unknown = (
        await patch(`/pagos/${id}/aprobar`, tokenA).expect(OK)
      ).body;
      const p = body as PagoApi;
      expect(p.estado).toBe('APROBADO');
      expect(p.periodo_cuenta?.monto_aprobado_centavos).toBe(400_000);
      expect(p.periodo_cuenta?.estado).not.toBe('EN_REVISION');
      const cuenta = await cuentaDe(contratoB.id);
      expect(p.periodo_cuenta).toEqual(esperadoDe(cuenta, p.periodo));
    });

    it('rechazar: el período deja de estar en revisión (con lo ya aprobado)', async () => {
      const id = await crearPago(
        contratoB.id,
        periodoB(),
        EstadoPago.PENDIENTE,
        300_000,
      );
      const body: unknown = (
        await patch(`/pagos/${id}/rechazar`, tokenA)
          .send({ motivo: 'PAGO_NO_VISIBLE' })
          .expect(OK)
      ).body;
      const p = body as PagoApi;
      expect(p.estado).toBe('RECHAZADO');
      expect(p.periodo_cuenta?.estado).not.toBe('EN_REVISION');
      expect(p.periodo_cuenta?.monto_aprobado_centavos).toBe(400_000);
      const cuenta = await cuentaDe(contratoB.id);
      expect(p.periodo_cuenta).toEqual(esperadoDe(cuenta, p.periodo));
    });

    it('aprobar lo que completa el canon: el período queda PAGADO', async () => {
      const id = await crearPago(
        contratoB.id,
        periodoB(),
        EstadoPago.PENDIENTE,
        600_000,
      );
      const body: unknown = (
        await patch(`/pagos/${id}/aprobar`, tokenA).expect(OK)
      ).body;
      const p = body as PagoApi;
      expect(p.periodo_cuenta).toMatchObject({
        estado: 'PAGADO',
        monto_aprobado_centavos: 1_000_000,
      });
      const cuenta = await cuentaDe(contratoB.id);
      expect(p.periodo_cuenta).toEqual(esperadoDe(cuenta, p.periodo));
    });

    it('aprobar y rechazar traen comprobante_tipo', async () => {
      const id = await crearPago(
        contratoA.id,
        periodoDe(periodosA[0].periodo),
        EstadoPago.PENDIENTE,
        1,
        'pagos/x/1-recibo.pdf',
      );
      const body: unknown = (
        await patch(`/pagos/${id}/rechazar`, tokenA).expect(OK)
      ).body;
      expect((body as PagoApi).comprobante_tipo).toBe('PDF');
    });
  });

  describe('contrato terminado anticipadamente: se usa la fecha_fin efectiva', () => {
    it('un período posterior a la fecha efectiva no está en el cálculo (null); uno anterior coincide con el estado de cuenta', async () => {
      await prisma.contrato.update({
        where: { id: contratoT.id },
        data: {
          estado: EstadoContrato.TERMINADO_ANTICIPADAMENTE,
          terminacionAnticipadaSolicitada: true,
          terminacionAnticipadaSolicitadaPor: 'ARRENDADOR',
          terminacionAnticipadaSolicitadaEn: new Date(),
          terminacionAnticipadaMotivo: 'Prueba',
          terminacionAnticipadaConfirmadaEn: new Date(),
          terminacion_confirmada_por: 'INQUILINO',
          terminacion_fecha_efectiva: new Date(`${enDias(-60)}T00:00:00.000Z`),
        },
      });
      const cuenta = await cuentaDe(contratoT.id);
      const despues = new Date(`${enDias(-10).slice(0, 7)}-01T00:00:00.000Z`);
      expect(
        cuenta.some(
          (p) => p.periodo.slice(0, 7) === despues.toISOString().slice(0, 7),
        ),
      ).toBe(false);

      const antes = cuenta[0];
      const idAntes = await crearPago(
        contratoT.id,
        periodoDe(antes.periodo),
        EstadoPago.PENDIENTE,
      );
      const idDespues = await crearPago(
        contratoT.id,
        despues,
        EstadoPago.REEMPLAZADO,
      );

      // El estado de cuenta DESPUÉS de crear los pagos (el pendiente deja el período en revisión).
      const cuentaConPagos = await cuentaDe(contratoT.id);
      const a = (await get(`/pagos/${idAntes}`, tokenA).expect(OK))
        .body as PagoApi;
      expect(a.periodo_cuenta).toEqual(esperadoDe(cuentaConPagos, a.periodo));
      expect(a.periodo_cuenta?.estado).toBe('EN_REVISION');
      expect(a.periodo_cuenta).not.toBeNull();
      const d = (await get(`/pagos/${idDespues}`, tokenA).expect(OK))
        .body as PagoApi;
      expect(d.periodo_cuenta).toBeNull();
      // La última fecha límite no pasa de la fecha efectiva.
      const ultimo = cuenta[cuenta.length - 1];
      expect(ultimo.fechaLimite.slice(0, 10) <= enDias(-60)).toBe(true);
    });
  });

  describe('aislamiento', () => {
    it('otro arrendador no ve estos pagos y recibe 404 en el detalle', async () => {
      const lista = await get('/pagos', tokenB).expect(OK);
      expect((lista.body as PagoApi[]).map((p) => p.id)).not.toContain(parcial);
      await get(`/pagos/${parcial}`, tokenB).expect(HttpStatus.NOT_FOUND);
      await patch(`/pagos/${parcial}/aprobar`, tokenB).expect(
        HttpStatus.NOT_FOUND,
      );
    });

    it('otro inquilino no ve estos pagos', async () => {
      const body: unknown = (
        await get('/pagos/mios', tokenInquilinoOtro).expect(OK)
      ).body;
      const ids = (body as PagoApi[]).map((p) => p.id);
      expect(ids).not.toContain(parcial);
      expect(ids).not.toContain(enRevision);
    });

    it('el contratoId de otro inquilino sigue dando 404', async () => {
      await get(
        `/pagos/mios?contratoId=${contratoA.id}`,
        tokenInquilinoOtro,
      ).expect(HttpStatus.NOT_FOUND);
    });
  });

  describe('eficiencia: el listado no hace una consulta por pago', () => {
    async function contarListado(ruta: string, token: string): Promise<number> {
      consultas.length = 0;
      await get(ruta, token).expect(OK);
      return consultas.length;
    }

    it('GET /pagos hace las mismas consultas con pocos o con muchos pagos (mismos contratos)', async () => {
      const pocos = await contarListado('/pagos', tokenA);
      const totalAntes = await prisma.pago.count({
        where: { arrendador_id: arrendadorA },
      });
      // 12 pagos más en los contratos A y B (los mismos contratos del listado)
      for (let i = 0; i < 6; i += 1) {
        siguienteAnio += 1;
        await crearPago(
          contratoA.id,
          new Date(Date.UTC(siguienteAnio, 0, 1)),
          EstadoPago.REEMPLAZADO,
        );
        await crearPago(contratoB.id, periodoB(), EstadoPago.REEMPLAZADO);
      }
      const muchos = await contarListado('/pagos', tokenA);
      const totalDespues = await prisma.pago.count({
        where: { arrendador_id: arrendadorA },
      });

      console.log(
        `[consultas SQL] GET /pagos: ${pocos} con ${totalAntes} pagos; ${muchos} con ${totalDespues} pagos (contratos distintos en el listado: 4)`,
      );
      expect(totalDespues).toBeGreaterThan(totalAntes);
      expect(muchos).toBe(pocos);
    });

    it('GET /pagos/mios: igual', async () => {
      const a = await contarListado('/pagos/mios', tokenInquilino);
      const b = await contarListado(
        `/pagos/mios?contratoId=${contratoA.id}`,
        tokenInquilino,
      );
      expect(a).toBeGreaterThan(0);
      expect(b).toBeGreaterThan(0);
    });
  });

  describe('OpenAPI: las respuestas de pagos están descritas (parte de B-57)', () => {
    interface Esquema {
      $ref?: string;
      type?: string;
      items?: { $ref?: string };
      properties?: Record<string, unknown>;
    }
    interface Operacion {
      responses: Record<
        string,
        { content?: Record<string, { schema?: Esquema }> }
      >;
    }
    type Documento = {
      paths: Record<string, Record<string, Operacion>>;
      components: { schemas: Record<string, Esquema> };
    };
    let documento: Documento;
    beforeAll(() => {
      documento = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('t').build(),
      ) as unknown as Documento;
    });
    const esquemaDe = (ruta: string, metodo: string, estado: string) =>
      documento.paths[ruta][metodo].responses[estado].content?.[
        'application/json'
      ]?.schema;

    it('los listados devuelven una lista de PagoRespuestaDto', () => {
      for (const ruta of ['/pagos', '/pagos/mios']) {
        const esquema = esquemaDe(ruta, 'get', '200');
        expect(esquema?.type).toBe('array');
        expect(esquema?.items?.$ref).toBe(
          '#/components/schemas/PagoRespuestaDto',
        );
      }
    });

    it('el detalle, aprobar y rechazar devuelven PagoRespuestaDto', () => {
      expect(esquemaDe('/pagos/{id}', 'get', '200')?.$ref).toBe(
        '#/components/schemas/PagoRespuestaDto',
      );
      expect(esquemaDe('/pagos/{id}/aprobar', 'patch', '200')?.$ref).toBe(
        '#/components/schemas/PagoRespuestaDto',
      );
      expect(esquemaDe('/pagos/{id}/rechazar', 'patch', '200')?.$ref).toBe(
        '#/components/schemas/PagoRespuestaDto',
      );
    });

    it('POST /pagos devuelve PagoCreadoDto (sin el bloque contrato) y documenta 400, 413, 415, 422', () => {
      expect(esquemaDe('/pagos', 'post', '201')?.$ref).toBe(
        '#/components/schemas/PagoCreadoDto',
      );
      const respuestas = Object.keys(documento.paths['/pagos'].post.responses);
      for (const codigo of ['400', '404', '409', '413', '415', '422']) {
        expect(respuestas).toContain(codigo);
      }
      expect(
        Object.keys(
          documento.components.schemas.PagoCreadoDto.properties ?? {},
        ),
      ).not.toContain('contrato');
    });

    it('PagoRespuestaDto trae los campos escalares, comprobante_tipo, periodo_cuenta y el bloque contrato', () => {
      const propiedades = Object.keys(
        documento.components.schemas.PagoRespuestaDto.properties ?? {},
      );
      for (const campo of [
        'id',
        'arrendador_id',
        'contrato_id',
        'monto_centavos',
        'fecha_reportada',
        'periodo',
        'estado',
        'motivo_rechazo',
        'mensaje_rechazo',
        'creado_en',
        'actualizado_en',
        'comprobante_url',
        'comprobante_tipo',
        'periodo_cuenta',
        'contrato',
      ]) {
        expect(propiedades).toContain(campo);
      }
      expect(propiedades).not.toContain('comprobante_ruta');
      const periodo = Object.keys(
        documento.components.schemas.PeriodoCuentaDto.properties ?? {},
      );
      expect(periodo.sort()).toEqual([
        'canon_vigente_centavos',
        'estado',
        'fecha_limite',
        'monto_aprobado_centavos',
      ]);
      const contrato = Object.keys(
        documento.components.schemas.ContratoDePagoDto.properties ?? {},
      );
      for (const campo of ['unidad', 'inquilino', 'canon_centavos', 'estado']) {
        expect(contrato).toContain(campo);
      }
    });
  });
});
