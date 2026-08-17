import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EstadoPago } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  autenticarInquilino,
  crearContrato,
  crearInmueble,
  crearInquilino,
  fechaHoyLocal,
  PagoCreado,
  registrarArrendador,
  reportarPago,
} from './helpers/crear-datos.helper';
import { limpiarBd } from './helpers/limpiar-bd';

interface PagoListado {
  id: string;
}

describe('PagoController (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeEach(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await limpiarBd(prisma);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  afterAll(async () => {
    await prisma.$connect();
    await limpiarBd(prisma);
    await prisma.$disconnect();
  });

  async function prepararPagoPendiente() {
    const { access_token } = await registrarArrendador(
      app,
      'Arrendador Pago',
      'pago@correo.com',
    );
    const inmueble = await crearInmueble(app, access_token);
    const inquilino = await crearInquilino(app, access_token);
    const contrato = await crearContrato(
      app,
      access_token,
      inmueble.unidades[0].id,
      inquilino.id,
    );
    const inquilinoToken = await autenticarInquilino(
      app,
      contrato.codigo_acceso?.codigo ?? '',
      'inquilino-pago@correo.com',
    );
    const pago = await reportarPago(app, inquilinoToken, contrato.id);
    return { access_token, contrato, inquilinoToken, pago };
  }

  it('registra un pago del inquilino con comprobante y queda PENDIENTE', async () => {
    const { contrato, pago } = await prepararPagoPendiente();

    expect(pago.id).toBeTruthy();
    expect(pago.contrato_id).toBe(contrato.id);
    expect(pago.monto_centavos).toBe(1000000);
    expect(pago.estado).toBe(EstadoPago.PENDIENTE);
    expect(pago.comprobante_url).toMatch(
      /^https:\/\/.*\.supabase\.co\/storage\/v1\/object\/sign\//,
    );
  });

  it('el arrendador aprueba un pago pendiente y queda APROBADO', async () => {
    const { access_token, contrato, pago } = await prepararPagoPendiente();

    const respuesta = await request(app.getHttpServer())
      .patch(`/pagos/${pago.id}/aprobar`)
      .set('Authorization', `Bearer ${access_token}`)
      .expect(HttpStatus.OK);

    expect((respuesta.body as PagoCreado).estado).toBe(EstadoPago.APROBADO);

    const contratoEnBd = await prisma.contrato.findUnique({
      where: { id: contrato.id },
    });
    expect(contratoEnBd?.estado_pago).toBe('AL_DIA');
  });

  it('el arrendador rechaza un pago pendiente y queda RECHAZADO', async () => {
    const { access_token, pago } = await prepararPagoPendiente();

    const respuesta = await request(app.getHttpServer())
      .patch(`/pagos/${pago.id}/rechazar`)
      .set('Authorization', `Bearer ${access_token}`)
      .expect(HttpStatus.OK);

    expect((respuesta.body as PagoCreado).estado).toBe(EstadoPago.RECHAZADO);
  });

  it('reemplaza automáticamente el comprobante previo del mismo ciclo', async () => {
    const { contrato, inquilinoToken } = await prepararPagoPendiente();

    const segundoPago = await reportarPago(app, inquilinoToken, contrato.id);

    expect(segundoPago.estado).toBe(EstadoPago.PENDIENTE);

    const pagosEnBd = await prisma.pago.findMany({
      where: { contrato_id: contrato.id },
      orderBy: { creado_en: 'asc' },
    });

    expect(pagosEnBd).toHaveLength(2);
    expect(pagosEnBd.map((p) => p.estado)).toEqual([
      EstadoPago.REEMPLAZADO,
      EstadoPago.PENDIENTE,
    ]);

    const pendientes = pagosEnBd.filter(
      (p) => p.estado === EstadoPago.PENDIENTE,
    );
    expect(pendientes).toHaveLength(1);
    expect(pendientes[0].id).toBe(segundoPago.id);
  });

  it('no permite a otro arrendador ver ni aprobar/rechazar un pago ajeno', async () => {
    const arrendadorA = await registrarArrendador(
      app,
      'Arrendador A Aislado',
      'aisla-pago-a@correo.com',
    );
    const arrendadorB = await registrarArrendador(
      app,
      'Arrendador B Aislado',
      'aisla-pago-b@correo.com',
    );
    const inmuebleA = await crearInmueble(app, arrendadorA.access_token);
    const inquilinoA = await crearInquilino(app, arrendadorA.access_token);
    const contrato = await crearContrato(
      app,
      arrendadorA.access_token,
      inmuebleA.unidades[0].id,
      inquilinoA.id,
    );
    const inquilinoToken = await autenticarInquilino(
      app,
      contrato.codigo_acceso?.codigo ?? '',
      'inquilino-aisla-pago@correo.com',
    );
    const pago = await reportarPago(app, inquilinoToken, contrato.id);

    await request(app.getHttpServer())
      .get(`/pagos/${pago.id}`)
      .set('Authorization', `Bearer ${arrendadorB.access_token}`)
      .expect(HttpStatus.NOT_FOUND);

    await request(app.getHttpServer())
      .patch(`/pagos/${pago.id}/aprobar`)
      .set('Authorization', `Bearer ${arrendadorB.access_token}`)
      .expect(HttpStatus.NOT_FOUND);

    await request(app.getHttpServer())
      .patch(`/pagos/${pago.id}/rechazar`)
      .set('Authorization', `Bearer ${arrendadorB.access_token}`)
      .expect(HttpStatus.NOT_FOUND);
  });

  it('lista solo los pagos de los contratos del arrendador autenticado', async () => {
    const arrendadorA = await registrarArrendador(
      app,
      'Arrendador A Listado',
      'lista-pago-a@correo.com',
    );
    const inmuebleA1 = await crearInmueble(app, arrendadorA.access_token);
    const inmuebleA2 = await crearInmueble(
      app,
      arrendadorA.access_token,
      'ABC-654321',
    );
    const inquilinoA1 = await crearInquilino(app, arrendadorA.access_token);
    const inquilinoA2 = await crearInquilino(app, arrendadorA.access_token);
    const contratoA1 = await crearContrato(
      app,
      arrendadorA.access_token,
      inmuebleA1.unidades[0].id,
      inquilinoA1.id,
    );
    const contratoA2 = await crearContrato(
      app,
      arrendadorA.access_token,
      inmuebleA2.unidades[0].id,
      inquilinoA2.id,
    );
    const tokenA1 = await autenticarInquilino(
      app,
      contratoA1.codigo_acceso?.codigo ?? '',
      'lista-pago-a1@correo.com',
    );
    const tokenA2 = await autenticarInquilino(
      app,
      contratoA2.codigo_acceso?.codigo ?? '',
      'lista-pago-a2@correo.com',
    );
    const pagoA1 = await reportarPago(app, tokenA1, contratoA1.id);
    const pagoA2 = await reportarPago(app, tokenA2, contratoA2.id);

    const arrendadorB = await registrarArrendador(
      app,
      'Arrendador B Listado',
      'lista-pago-b@correo.com',
    );
    const inmuebleB = await crearInmueble(
      app,
      arrendadorB.access_token,
      'ABC-112233',
    );
    const inquilinoB = await crearInquilino(app, arrendadorB.access_token);
    const contratoB = await crearContrato(
      app,
      arrendadorB.access_token,
      inmuebleB.unidades[0].id,
      inquilinoB.id,
    );
    const tokenB = await autenticarInquilino(
      app,
      contratoB.codigo_acceso?.codigo ?? '',
      'lista-pago-b1@correo.com',
    );
    await reportarPago(app, tokenB, contratoB.id);

    const respuesta = await request(app.getHttpServer())
      .get('/pagos')
      .set('Authorization', `Bearer ${arrendadorA.access_token}`)
      .expect(HttpStatus.OK);

    const ids = (respuesta.body as PagoListado[]).map((p) => p.id);
    expect(ids).toHaveLength(2);
    expect(ids).toEqual(expect.arrayContaining([pagoA1.id, pagoA2.id]));
  });

  it('rechaza con 415 un comprobante con tipo de archivo no permitido', async () => {
    const { contrato, inquilinoToken } = await prepararPagoPendiente();

    await request(app.getHttpServer())
      .post('/pagos')
      .set('Authorization', `Bearer ${inquilinoToken}`)
      .field('contratoId', contrato.id)
      .field('monto_centavos', '1000000')
      .field('fecha_reportada', fechaHoyLocal())
      .attach('comprobante', Buffer.from('texto plano no permitido'), {
        filename: 'comprobante.txt',
        contentType: 'text/plain',
      })
      .expect(HttpStatus.UNSUPPORTED_MEDIA_TYPE);
  });
});
