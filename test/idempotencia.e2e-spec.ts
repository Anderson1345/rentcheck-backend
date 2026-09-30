import { archivoDePrueba } from './helpers/archivos.helper';
import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AlmacenamientoService } from '../src/almacenamiento/almacenamiento.service';
import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/configurar-app';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  autenticarInquilino,
  crearContrato,
  crearInmueble,
  crearInquilino,
  fechaHoyLocal,
  registrarArrendador,
  RespuestaCrearContrato,
  RespuestaCrearInmueble,
} from './helpers/crear-datos.helper';
import { limpiarBd } from './helpers/limpiar-bd';

interface CuerpoError {
  codigo: string;
}

interface RecursoCreado {
  id: string;
}

const CLAVE = 'clave-de-prueba-0001';
const CREADO: number = HttpStatus.CREATED;
const CONFLICTO: number = HttpStatus.CONFLICT;

function ayerLocal(): string {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() - 1);
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${fecha.getFullYear()}-${mes}-${dia}`;
}

describe('Idempotency-Key (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let almacenamiento: AlmacenamientoService;

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

  async function prepararContrato(sufijo: string): Promise<{
    access_token: string;
    inmueble: RespuestaCrearInmueble;
    contrato: RespuestaCrearContrato;
    inquilinoToken: string;
  }> {
    const { access_token } = await registrarArrendador(
      app,
      `Arrendador ${sufijo}`,
      `idem-${sufijo}@correo.com`,
    );
    const inmueble = await crearInmueble(app, access_token, `IDE-${sufijo}`);
    const inquilino = await crearInquilino(app, access_token);
    const contrato = await crearContrato(
      app,
      access_token,
      inmueble.unidades[0].id,
      inquilino.id,
      { fecha_inicio: fechaHoyLocal() },
    );
    const inquilinoToken = await autenticarInquilino(
      app,
      contrato.codigo_acceso?.codigo ?? '',
      `inquilino-idem-${sufijo}@correo.com`,
    );
    return { access_token, inmueble, contrato, inquilinoToken };
  }

  function enviarPago(
    token: string,
    contratoId: string,
    opciones: {
      clave?: string;
      monto?: number;
      fechaReportada?: string;
    } = {},
  ) {
    const peticion = request(app.getHttpServer())
      .post('/pagos')
      .set('Authorization', `Bearer ${token}`);
    if (opciones.clave !== undefined) {
      peticion.set('Idempotency-Key', opciones.clave);
    }
    return peticion
      .field('contratoId', contratoId)
      .field('monto_centavos', String(opciones.monto ?? 1_000_000))
      .field('fecha_reportada', opciones.fechaReportada ?? fechaHoyLocal())
      .attach('comprobante', archivoDePrueba('png', 'comprobante de prueba'), {
        filename: 'comprobante.png',
        contentType: 'image/png',
      });
  }

  function enviarSolicitud(token: string, unidadId: string, clave?: string) {
    const peticion = request(app.getHttpServer())
      .post('/solicitudes-mantenimiento')
      .set('Authorization', `Bearer ${token}`);
    if (clave !== undefined) {
      peticion.set('Idempotency-Key', clave);
    }
    return peticion
      .field('unidadId', unidadId)
      .field('descripcion', 'El lavadero tiene una fuga de agua.')
      .field('urgencia', 'ALTO');
  }

  it('pago: misma clave y mismo contenido devuelve el mismo pago sin duplicar ni subir el archivo otra vez', async () => {
    const { contrato, inquilinoToken } = await prepararContrato('mismo');
    const subir = jest.spyOn(almacenamiento, 'subirArchivo');

    const primera = await enviarPago(inquilinoToken, contrato.id, {
      clave: CLAVE,
    }).expect(HttpStatus.CREATED);
    const segunda = await enviarPago(inquilinoToken, contrato.id, {
      clave: CLAVE,
    }).expect(HttpStatus.CREATED);

    expect((segunda.body as RecursoCreado).id).toBe(
      (primera.body as RecursoCreado).id,
    );
    expect(primera.headers['idempotent-replayed']).toBeUndefined();
    expect(segunda.headers['idempotent-replayed']).toBe('true');
    expect(subir).toHaveBeenCalledTimes(1);
    expect(await prisma.pago.count()).toBe(1);
  });

  it('pago: misma clave con distinto monto responde 422 IDEMPOTENCY_KEY_REUTILIZADA', async () => {
    const { contrato, inquilinoToken } = await prepararContrato('distinto');

    await enviarPago(inquilinoToken, contrato.id, { clave: CLAVE }).expect(
      HttpStatus.CREATED,
    );
    const respuesta = await enviarPago(inquilinoToken, contrato.id, {
      clave: CLAVE,
      monto: 500_000,
    }).expect(HttpStatus.UNPROCESSABLE_ENTITY);

    expect((respuesta.body as CuerpoError).codigo).toBe(
      'IDEMPOTENCY_KEY_REUTILIZADA',
    );
    expect(await prisma.pago.count()).toBe(1);
  });

  it('pago: el reintento después de que el arrendador aprobó devuelve el pago original, no PERIODO_YA_PAGADO', async () => {
    const { access_token, contrato, inquilinoToken } =
      await prepararContrato('aprobado');

    const primera = await enviarPago(inquilinoToken, contrato.id, {
      clave: CLAVE,
    }).expect(HttpStatus.CREATED);
    const pagoId = (primera.body as RecursoCreado).id;

    await request(app.getHttpServer())
      .patch(`/pagos/${pagoId}/aprobar`)
      .set('Authorization', `Bearer ${access_token}`)
      .expect(HttpStatus.OK);

    const reintento = await enviarPago(inquilinoToken, contrato.id, {
      clave: CLAVE,
    }).expect(HttpStatus.CREATED);

    expect((reintento.body as RecursoCreado).id).toBe(pagoId);
    expect(reintento.headers['idempotent-replayed']).toBe('true');
    expect(await prisma.pago.count()).toBe(1);
  });

  it('pago: dos peticiones simultáneas con la misma clave dejan un solo pago y ningún 500', async () => {
    const { contrato, inquilinoToken } = await prepararContrato('carrera');

    const [r1, r2] = await Promise.all([
      enviarPago(inquilinoToken, contrato.id, { clave: CLAVE }),
      enviarPago(inquilinoToken, contrato.id, { clave: CLAVE }),
    ]);

    for (const respuesta of [r1, r2]) {
      expect([CREADO, CONFLICTO]).toContain(respuesta.status);
      if (respuesta.status === CONFLICTO) {
        expect((respuesta.body as CuerpoError).codigo).toBe(
          'SOLICITUD_EN_PROCESO',
        );
      }
    }
    expect([r1, r2].some((r) => r.status === CREADO)).toBe(true);

    expect(await prisma.pago.count()).toBe(1);
    const claves = await prisma.claveIdempotencia.findMany();
    expect(claves).toHaveLength(1);
    expect(claves[0].recurso_id).not.toBeNull();
  });

  it('pago: un error de validación de negocio no deja reclamo y la misma clave luego crea el pago', async () => {
    const { contrato, inquilinoToken } = await prepararContrato('validacion');

    const fallida = await enviarPago(inquilinoToken, contrato.id, {
      clave: CLAVE,
      fechaReportada: ayerLocal(),
    }).expect(HttpStatus.BAD_REQUEST);
    expect((fallida.body as CuerpoError).codigo).toBe(
      'FECHA_REPORTADA_ANTERIOR_A_INICIO',
    );
    expect(await prisma.claveIdempotencia.count()).toBe(0);

    await enviarPago(inquilinoToken, contrato.id, { clave: CLAVE }).expect(
      HttpStatus.CREATED,
    );
    expect(await prisma.pago.count()).toBe(1);
  });

  it('pago: dos inquilinos distintos con la misma clave no se afectan', async () => {
    const a = await prepararContrato('inq-a');
    const b = await prepararContrato('inq-b');

    const respuestaA = await enviarPago(a.inquilinoToken, a.contrato.id, {
      clave: CLAVE,
    }).expect(HttpStatus.CREATED);
    const respuestaB = await enviarPago(b.inquilinoToken, b.contrato.id, {
      clave: CLAVE,
    }).expect(HttpStatus.CREATED);

    expect((respuestaA.body as RecursoCreado).id).not.toBe(
      (respuestaB.body as RecursoCreado).id,
    );
    expect(respuestaB.headers['idempotent-replayed']).toBeUndefined();
    expect(await prisma.pago.count()).toBe(2);
  });

  it('pago: clave con formato inválido responde 400 IDEMPOTENCY_KEY_INVALIDA', async () => {
    const { contrato, inquilinoToken } = await prepararContrato('formato');

    for (const claveInvalida of ['corta', 'tiene espacios y $ raros!!']) {
      const respuesta = await enviarPago(inquilinoToken, contrato.id, {
        clave: claveInvalida,
      }).expect(HttpStatus.BAD_REQUEST);
      expect((respuesta.body as CuerpoError).codigo).toBe(
        'IDEMPOTENCY_KEY_INVALIDA',
      );
    }
    expect(await prisma.pago.count()).toBe(0);
  });

  it('pago: sin encabezado el comportamiento es el de siempre (el segundo envío reemplaza al primero)', async () => {
    const { contrato, inquilinoToken } = await prepararContrato('sinclave');

    const primera = await enviarPago(inquilinoToken, contrato.id).expect(
      HttpStatus.CREATED,
    );
    const segunda = await enviarPago(inquilinoToken, contrato.id).expect(
      HttpStatus.CREATED,
    );

    expect(segunda.headers['idempotent-replayed']).toBeUndefined();
    expect((segunda.body as RecursoCreado).id).not.toBe(
      (primera.body as RecursoCreado).id,
    );
    const pagos = await prisma.pago.findMany({ orderBy: { creado_en: 'asc' } });
    expect(pagos.map((p) => p.estado)).toEqual(['REEMPLAZADO', 'PENDIENTE']);
    expect(await prisma.claveIdempotencia.count()).toBe(0);
  });

  it('solicitud de mantenimiento: misma clave dos veces crea una sola solicitud con el mismo id', async () => {
    const { inmueble, inquilinoToken } = await prepararContrato('solicitud');

    const primera = await enviarSolicitud(
      inquilinoToken,
      inmueble.unidades[0].id,
      CLAVE,
    ).expect(HttpStatus.CREATED);
    const segunda = await enviarSolicitud(
      inquilinoToken,
      inmueble.unidades[0].id,
      CLAVE,
    ).expect(HttpStatus.CREATED);

    expect((segunda.body as RecursoCreado).id).toBe(
      (primera.body as RecursoCreado).id,
    );
    expect(segunda.headers['idempotent-replayed']).toBe('true');
    expect(await prisma.solicitudMantenimiento.count()).toBe(1);
  });
});
