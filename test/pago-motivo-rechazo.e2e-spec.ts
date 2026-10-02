import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EstadoPago, MotivoRechazoPago } from '@prisma/client';
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
  RespuestaCrearContrato,
} from './helpers/crear-datos.helper';
import { limpiarBd } from './helpers/limpiar-bd';

// Cada prueba rechaza SU propio pago pendiente (creado directo con Prisma, en un período distinto):
// así la preparación pesada (arrendador, inmueble, contrato, inquilinos) se hace una sola vez.
jest.setTimeout(120_000);

const OK: number = HttpStatus.OK;
const BAD: number = HttpStatus.BAD_REQUEST;

interface CuerpoError {
  statusCode: number;
  codigo: string;
  mensaje: string;
  message: string;
}

interface PagoRespuesta {
  id: string;
  estado: string;
  motivo_rechazo: string | null;
  mensaje_rechazo: string | null;
}

interface Escenario {
  tokenArrendador: string;
  arrendadorId: string;
  tokenInquilino: string;
  contrato: RespuestaCrearContrato;
}

function idDelToken(token: string): string {
  return (
    JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
    ) as { id: string }
  ).id;
}

describe('Motivo del rechazo de un pago (e2e, B-59)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let a: Escenario;
  let b: Escenario;
  let siguientePeriodo = 0;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await limpiarBd(prisma);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configurarApp(app);
    await app.init();

    a = await prepararEscenario('a', 'ABC-100001');
    b = await prepararEscenario('b', 'ABC-200002');
  });

  afterAll(async () => {
    await limpiarBd(prisma);
    await app.close();
    await prisma.$disconnect();
  });

  async function prepararEscenario(
    sufijo: string,
    matricula: string,
  ): Promise<Escenario> {
    const { access_token } = await registrarArrendador(
      app,
      `Arrendador ${sufijo}`,
      `motivo-${sufijo}@correo.com`,
    );
    const inmueble = await crearInmueble(app, access_token, matricula);
    const inquilino = await crearInquilino(app, access_token);
    const contrato = await crearContrato(
      app,
      access_token,
      inmueble.unidades[0].id,
      inquilino.id,
    );
    const tokenInquilino = await autenticarInquilino(
      app,
      contrato.codigo_acceso?.codigo ?? '',
      `inquilino-motivo-${sufijo}@correo.com`,
    );
    return {
      tokenArrendador: access_token,
      arrendadorId: idDelToken(access_token),
      tokenInquilino,
      contrato,
    };
  }

  /** Un pago del contrato del escenario A, en un período propio. */
  async function crearPago(estado: EstadoPago = EstadoPago.PENDIENTE) {
    const periodo = new Date(Date.UTC(2020, siguientePeriodo, 1));
    siguientePeriodo += 1;
    const pago = await prisma.pago.create({
      data: {
        arrendador_id: a.arrendadorId,
        contrato_id: a.contrato.id,
        monto_centavos: 1_000_000,
        fecha_reportada: new Date(),
        periodo,
        estado,
      },
      select: { id: true },
    });
    return pago.id;
  }

  function rechazar(id: string, cuerpo?: object, token = a.tokenArrendador) {
    const peticion = request(app.getHttpServer())
      .patch(`/pagos/${id}/rechazar`)
      .set('Authorization', `Bearer ${token}`);
    return cuerpo === undefined ? peticion : peticion.send(cuerpo);
  }

  async function enBd(id: string) {
    return prisma.pago.findUniqueOrThrow({
      where: { id },
      select: { estado: true, motivo_rechazo: true, mensaje_rechazo: true },
    });
  }

  async function sinCambios(id: string) {
    expect(await enBd(id)).toEqual({
      estado: EstadoPago.PENDIENTE,
      motivo_rechazo: null,
      mensaje_rechazo: null,
    });
  }

  describe('rechazo sin cuerpo (como antes)', () => {
    it('sin cuerpo: RECHAZADO con ambos campos en null', async () => {
      const id = await crearPago();
      const body: unknown = (await rechazar(id).expect(OK)).body;
      const pago = body as PagoRespuesta;
      expect(pago.estado).toBe(EstadoPago.RECHAZADO);
      expect(pago.motivo_rechazo).toBeNull();
      expect(pago.mensaje_rechazo).toBeNull();
      expect(await enBd(id)).toEqual({
        estado: EstadoPago.RECHAZADO,
        motivo_rechazo: null,
        mensaje_rechazo: null,
      });
    });

    it('con cuerpo vacío {}: igual', async () => {
      const id = await crearPago();
      const body: unknown = (await rechazar(id, {}).expect(OK)).body;
      expect((body as PagoRespuesta).motivo_rechazo).toBeNull();
    });
  });

  describe('rechazo con motivo', () => {
    it.each([
      MotivoRechazoPago.MONTO_NO_COINCIDE,
      MotivoRechazoPago.PAGO_NO_VISIBLE,
      MotivoRechazoPago.COMPROBANTE_ILEGIBLE,
    ])('%s solo, sin mensaje', async (motivo) => {
      const id = await crearPago();
      const body: unknown = (await rechazar(id, { motivo }).expect(OK)).body;
      const pago = body as PagoRespuesta;
      expect(pago.estado).toBe(EstadoPago.RECHAZADO);
      expect(pago.motivo_rechazo).toBe(motivo);
      expect(pago.mensaje_rechazo).toBeNull();
      expect(await enBd(id)).toEqual({
        estado: EstadoPago.RECHAZADO,
        motivo_rechazo: motivo,
        mensaje_rechazo: null,
      });
    });

    it('un motivo de la lista con mensaje opcional (se recorta)', async () => {
      const id = await crearPago();
      const body: unknown = (
        await rechazar(id, {
          motivo: 'MONTO_NO_COINCIDE',
          mensaje: '  Faltan 50.000 pesos  ',
        }).expect(OK)
      ).body;
      expect((body as PagoRespuesta).mensaje_rechazo).toBe(
        'Faltan 50.000 pesos',
      );
      expect((await enBd(id)).mensaje_rechazo).toBe('Faltan 50.000 pesos');
    });

    it('OTRO con mensaje', async () => {
      const id = await crearPago();
      const body: unknown = (
        await rechazar(id, {
          motivo: 'OTRO',
          mensaje: 'La foto está borrosa',
        }).expect(OK)
      ).body;
      const pago = body as PagoRespuesta;
      expect(pago.motivo_rechazo).toBe('OTRO');
      expect(pago.mensaje_rechazo).toBe('La foto está borrosa');
    });

    it('acepta un mensaje de exactamente 200 caracteres', async () => {
      const id = await crearPago();
      const mensaje = 'a'.repeat(200);
      const body: unknown = (
        await rechazar(id, {
          motivo: 'OTRO',
          mensaje,
        }).expect(OK)
      ).body;
      expect((body as PagoRespuesta).mensaje_rechazo).toBe(mensaje);
    });

    it('un mensaje en blanco con un motivo que no es OTRO cuenta como no enviado', async () => {
      const id = await crearPago();
      const body: unknown = (
        await rechazar(id, {
          motivo: 'PAGO_NO_VISIBLE',
          mensaje: '   ',
        }).expect(OK)
      ).body;
      expect((body as PagoRespuesta).mensaje_rechazo).toBeNull();
    });
  });

  describe('validación (no escribe nada)', () => {
    it('mensaje sin motivo: 400 MOTIVO_REQUERIDO', async () => {
      const id = await crearPago();
      const body: unknown = (
        await rechazar(id, { mensaje: 'Algo' }).expect(BAD)
      ).body;
      expect((body as CuerpoError).codigo).toBe('MOTIVO_REQUERIDO');
      await sinCambios(id);
    });

    it('OTRO sin mensaje: 400 MENSAJE_REQUERIDO', async () => {
      const id = await crearPago();
      const body: unknown = (await rechazar(id, { motivo: 'OTRO' }).expect(BAD))
        .body;
      expect((body as CuerpoError).codigo).toBe('MENSAJE_REQUERIDO');
      await sinCambios(id);
    });

    it('OTRO con mensaje de solo espacios: 400 MENSAJE_REQUERIDO', async () => {
      const id = await crearPago();
      const body: unknown = (
        await rechazar(id, {
          motivo: 'OTRO',
          mensaje: '     ',
        }).expect(BAD)
      ).body;
      expect((body as CuerpoError).codigo).toBe('MENSAJE_REQUERIDO');
      await sinCambios(id);
    });

    it('mensaje de 201 caracteres: 400 VALIDACION', async () => {
      const id = await crearPago();
      const body: unknown = (
        await rechazar(id, {
          motivo: 'OTRO',
          mensaje: 'a'.repeat(201),
        }).expect(BAD)
      ).body;
      expect((body as CuerpoError).codigo).toBe('VALIDACION');
      await sinCambios(id);
    });

    it('motivo fuera de la lista: 400 VALIDACION', async () => {
      const id = await crearPago();
      const body: unknown = (
        await rechazar(id, { motivo: 'NO_ME_GUSTA' }).expect(BAD)
      ).body;
      expect((body as CuerpoError).codigo).toBe('VALIDACION');
      await sinCambios(id);
    });

    it('mensaje que no es texto: 400 VALIDACION', async () => {
      const id = await crearPago();
      const body: unknown = (
        await rechazar(id, {
          motivo: 'OTRO',
          mensaje: 12345,
        }).expect(BAD)
      ).body;
      expect((body as CuerpoError).codigo).toBe('VALIDACION');
      await sinCambios(id);
    });
  });

  describe('quién ve el motivo', () => {
    it('el inquilino dueño, en GET /pagos/mios y en GET /pagos/mios?contratoId=', async () => {
      const id = await crearPago();
      await rechazar(id, {
        motivo: 'COMPROBANTE_ILEGIBLE',
        mensaje: 'No se lee el valor',
      }).expect(OK);

      for (const ruta of [
        '/pagos/mios',
        `/pagos/mios?contratoId=${a.contrato.id}`,
      ]) {
        const body: unknown = (
          await request(app.getHttpServer())
            .get(ruta)
            .set('Authorization', `Bearer ${a.tokenInquilino}`)
            .expect(OK)
        ).body;
        const pago = (body as PagoRespuesta[]).find((p) => p.id === id);
        expect(pago?.estado).toBe(EstadoPago.RECHAZADO);
        expect(pago?.motivo_rechazo).toBe('COMPROBANTE_ILEGIBLE');
        expect(pago?.mensaje_rechazo).toBe('No se lee el valor');
      }
    });

    it('el arrendador, en GET /pagos y en GET /pagos/:id', async () => {
      const id = await crearPago();
      await rechazar(id, { motivo: 'PAGO_NO_VISIBLE' }).expect(OK);

      const lista = await request(app.getHttpServer())
        .get('/pagos?estado=RECHAZADO')
        .set('Authorization', `Bearer ${a.tokenArrendador}`)
        .expect(OK);
      const enLista = (lista.body as PagoRespuesta[]).find((p) => p.id === id);
      expect(enLista?.motivo_rechazo).toBe('PAGO_NO_VISIBLE');
      expect(enLista?.mensaje_rechazo).toBeNull();

      const detalle = await request(app.getHttpServer())
        .get(`/pagos/${id}`)
        .set('Authorization', `Bearer ${a.tokenArrendador}`)
        .expect(OK);
      expect((detalle.body as PagoRespuesta).motivo_rechazo).toBe(
        'PAGO_NO_VISIBLE',
      );
    });

    it('solo los pagos RECHAZADOS traen valor; el resto sale null', async () => {
      const pendiente = await crearPago();
      const aprobado = await crearPago(EstadoPago.APROBADO);
      const reemplazado = await crearPago(EstadoPago.REEMPLAZADO);
      const body: unknown = (
        await request(app.getHttpServer())
          .get('/pagos')
          .set('Authorization', `Bearer ${a.tokenArrendador}`)
          .expect(OK)
      ).body;
      const pagos = body as PagoRespuesta[];
      for (const id of [pendiente, aprobado, reemplazado]) {
        const pago = pagos.find((p) => p.id === id);
        expect(pago).toBeDefined();
        expect(pago).toHaveProperty('motivo_rechazo', null);
        expect(pago).toHaveProperty('mensaje_rechazo', null);
      }
      for (const pago of pagos) {
        if (pago.estado !== EstadoPago.RECHAZADO) {
          expect(pago.motivo_rechazo).toBeNull();
          expect(pago.mensaje_rechazo).toBeNull();
        }
      }
    });

    it('aprobar no escribe nunca esos campos', async () => {
      const id = await crearPago();
      const body: unknown = (
        await request(app.getHttpServer())
          .patch(`/pagos/${id}/aprobar`)
          .set('Authorization', `Bearer ${a.tokenArrendador}`)
          .expect(OK)
      ).body;
      const pago = body as PagoRespuesta;
      expect(pago.estado).toBe(EstadoPago.APROBADO);
      expect(pago.motivo_rechazo).toBeNull();
      expect(pago.mensaje_rechazo).toBeNull();
    });

    it('otro inquilino no ve el pago ni su motivo', async () => {
      const id = await crearPago();
      await rechazar(id, { motivo: 'MONTO_NO_COINCIDE' }).expect(OK);
      const body: unknown = (
        await request(app.getHttpServer())
          .get('/pagos/mios')
          .set('Authorization', `Bearer ${b.tokenInquilino}`)
          .expect(OK)
      ).body;
      expect((body as PagoRespuesta[]).map((p) => p.id)).not.toContain(id);
    });
  });

  describe('pertenencia y estado', () => {
    it('pago de otro arrendador: 404 y no cambia nada', async () => {
      const id = await crearPago();
      await rechazar(id, { motivo: 'MONTO_NO_COINCIDE' }, b.tokenArrendador)
        .expect(HttpStatus.NOT_FOUND)
        .expect(({ body }) => {
          expect((body as CuerpoError).codigo).toBeDefined();
        });
      await sinCambios(id);
    });

    it('segundo rechazo: 409 PAGO_YA_PROCESADO y no sobrescribe el primero', async () => {
      const id = await crearPago();
      await rechazar(id, {
        motivo: 'PAGO_NO_VISIBLE',
        mensaje: 'Primero',
      }).expect(OK);
      const body: unknown = (
        await rechazar(id, {
          motivo: 'OTRO',
          mensaje: 'Segundo',
        }).expect(HttpStatus.CONFLICT)
      ).body;
      expect((body as CuerpoError).codigo).toBe('PAGO_YA_PROCESADO');
      expect(await enBd(id)).toEqual({
        estado: EstadoPago.RECHAZADO,
        motivo_rechazo: 'PAGO_NO_VISIBLE',
        mensaje_rechazo: 'Primero',
      });
    });

    it('rechazar un pago ya aprobado: 409 PAGO_YA_PROCESADO y sigue aprobado sin motivo', async () => {
      const id = await crearPago(EstadoPago.APROBADO);
      const body: unknown = (
        await rechazar(id, {
          motivo: 'MONTO_NO_COINCIDE',
        }).expect(HttpStatus.CONFLICT)
      ).body;
      expect((body as CuerpoError).codigo).toBe('PAGO_YA_PROCESADO');
      expect(await enBd(id)).toEqual({
        estado: EstadoPago.APROBADO,
        motivo_rechazo: null,
        mensaje_rechazo: null,
      });
    });

    it('dos rechazos simultáneos con motivos distintos: uno gana y se guarda su motivo', async () => {
      const id = await crearPago();
      const [uno, dos] = await Promise.all([
        rechazar(id, { motivo: 'MONTO_NO_COINCIDE', mensaje: 'Uno' }),
        rechazar(id, { motivo: 'COMPROBANTE_ILEGIBLE', mensaje: 'Dos' }),
      ]);
      const estados = [uno.status, dos.status].sort((x, y) => x - y);
      expect(estados).toEqual([OK, HttpStatus.CONFLICT]);

      const ganador = (uno.status === OK ? uno : dos).body as PagoRespuesta;
      const perdedor = (uno.status === OK ? dos : uno).body as CuerpoError;
      expect(perdedor.codigo).toBe('PAGO_YA_PROCESADO');
      expect(await enBd(id)).toEqual({
        estado: EstadoPago.RECHAZADO,
        motivo_rechazo: ganador.motivo_rechazo,
        mensaje_rechazo: ganador.mensaje_rechazo,
      });
      expect(ganador.motivo_rechazo).not.toBeNull();
    });
  });

  it('el estado de pago del contrato se recalcula igual tras rechazar con motivo', async () => {
    const id = await crearPago();
    await rechazar(id, { motivo: 'MONTO_NO_COINCIDE' }).expect(OK);

    const contratoEnBd = await prisma.contrato.findUniqueOrThrow({
      where: { id: a.contrato.id },
      select: { estado_pago: true },
    });
    // El estado derivado (GET estado-cuenta) y el guardado en el contrato coinciden.
    const cuenta = await request(app.getHttpServer())
      .get(`/inquilino/contratos/${a.contrato.id}/estado-cuenta`)
      .set('Authorization', `Bearer ${a.tokenInquilino}`)
      .expect(OK);
    expect(contratoEnBd.estado_pago).toBe(
      (cuenta.body as { estadoPago: string }).estadoPago.toUpperCase(),
    );
  });
});
