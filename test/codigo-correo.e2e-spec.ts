import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
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
  vincularContrato,
} from './helpers/crear-datos.helper';
import { limpiarBd } from './helpers/limpiar-bd';

interface CuerpoError {
  statusCode: number;
  codigo: string;
  mensaje: string;
}

const OK: number = HttpStatus.OK;
const CREADO: number = HttpStatus.CREATED;
const CONFLICTO: number = HttpStatus.CONFLICT;
const NO_ENCONTRADO: number = HttpStatus.NOT_FOUND;
const MUCHOS: number = HttpStatus.TOO_MANY_REQUESTS;

const FORMATO =
  /^RC-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/;
const MENSAJE_REGISTRO =
  'No fue posible completar el registro con esos datos. Si ya tienes cuenta, inicia sesión.';
const DIA_MS = 24 * 60 * 60 * 1000;

describe('Código de acceso seguro y correo normalizado (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let contador = 0;

  beforeEach(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await limpiarBd(prisma);

    // El límite de 5/min por ruta convive con el bloqueo por código; aquí se
    // desactiva el ThrottlerGuard para probar el bloqueo de forma aislada.
    jest.spyOn(ThrottlerGuard.prototype, 'canActivate').mockResolvedValue(true);
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configurarApp(app);
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

  async function nuevoContrato() {
    contador += 1;
    const correoArr = `codigo-${contador}@correo.com`;
    const { access_token } = await registrarArrendador(
      app,
      `Arrendador ${contador}`,
      correoArr,
    );
    const inmueble = await crearInmueble(app, access_token, `COD-${contador}`);
    const ficha = await crearInquilino(app, access_token);
    const contrato = await crearContrato(
      app,
      access_token,
      inmueble.unidades[0].id,
      ficha.id,
    );
    return {
      arr: access_token,
      correoArr,
      contrato,
      codigo: contrato.codigo_acceso?.codigo ?? '',
    };
  }

  const validar = (codigo: string) =>
    request(app.getHttpServer())
      .post('/auth/inquilino/validar-codigo')
      .send({ codigo });

  const completar = (codigo: string, correo: string) =>
    request(app.getHttpServer())
      .post('/auth/inquilino/completar-registro')
      .send({ codigo, correo, contrasena: 'clave1234' });

  const codigoError = (r: { body: unknown }) => (r.body as CuerpoError).codigo;

  // ------------------------------------------------------------------
  // Formato y expiración
  // ------------------------------------------------------------------
  it('el código nuevo tiene formato RC-XXXX-XXXX y expira a los 7 días; el arrendador ve expira_en', async () => {
    const { arr, contrato, codigo } = await nuevoContrato();

    expect(codigo).toMatch(FORMATO);
    const enBd = await prisma.codigoAcceso.findUniqueOrThrow({
      where: { codigo },
    });
    const dias = (enBd.expira_en.getTime() - Date.now()) / DIA_MS;
    expect(dias).toBeGreaterThan(6.9);
    expect(dias).toBeLessThan(7.1);

    const creado = contrato.codigo_acceso as unknown as {
      codigo: string;
      expira_en: string;
    };
    expect(new Date(creado.expira_en).getTime()).toBe(enBd.expira_en.getTime());

    const detalle = await request(app.getHttpServer())
      .get(`/contratos/${contrato.id}`)
      .set('Authorization', `Bearer ${arr}`)
      .expect(OK);
    expect(
      (detalle.body as { codigo_acceso: { expira_en: string } }).codigo_acceso
        .expira_en,
    ).toBeTruthy();
    const listado = await request(app.getHttpServer())
      .get('/contratos')
      .set('Authorization', `Bearer ${arr}`)
      .expect(OK);
    expect(
      (listado.body as Array<{ codigo_acceso: { expira_en: string } }>)[0]
        .codigo_acceso.expira_en,
    ).toBeTruthy();
  }, 90000);

  it('un código vencido da el mismo 404 que uno inexistente en validar, completar y vincular; regenerar lo reemplaza', async () => {
    const { arr, contrato, codigo } = await nuevoContrato();
    const inexistente = await validar('RC-ZZZZ-ZZZZ');
    expect(inexistente.status).toBe(NO_ENCONTRADO);

    await prisma.codigoAcceso.update({
      where: { codigo },
      data: { expira_en: new Date(Date.now() - 1000) },
    });

    const v = await validar(codigo);
    const c = await completar(codigo, 'vencido@correo.com');
    expect([v.status, v.body]).toEqual([NO_ENCONTRADO, inexistente.body]);
    expect([c.status, c.body]).toEqual([NO_ENCONTRADO, inexistente.body]);

    // vincular: una cuenta con un contrato vinculado usa el código vencido de otro contrato suyo.
    const fichaId = contrato.inquilino.id;
    const otro = await crearContrato(
      app,
      arr,
      (await crearInmueble(app, arr, `COD-V-${contador}`)).unidades[0].id,
      fichaId,
    );
    const token = await autenticarInquilino(
      app,
      otro.codigo_acceso?.codigo ?? '',
      'vencido-cuenta@correo.com',
    );
    const vinc = await vincularContrato(app, token, codigo);
    expect([vinc.status, vinc.body]).toEqual([NO_ENCONTRADO, inexistente.body]);

    const regenerado = await request(app.getHttpServer())
      .post(`/contratos/${contrato.id}/regenerar-codigo`)
      .set('Authorization', `Bearer ${arr}`)
      .expect(CREADO);
    const nuevo = regenerado.body as { codigo: string; expira_en: string };
    expect(nuevo.codigo).toMatch(FORMATO);
    expect(new Date(nuevo.expira_en).getTime()).toBeGreaterThan(Date.now());
    expect((await validar(nuevo.codigo)).status).toBe(OK);
    expect((await validar(codigo)).status).toBe(NO_ENCONTRADO);
  }, 120000);

  it('un contrato que ya está vinculado sigue respondiendo 200 a vincular repetido aunque su código haya expirado', async () => {
    const { arr, contrato } = await nuevoContrato();
    const token = await autenticarInquilino(
      app,
      contrato.codigo_acceso?.codigo ?? '',
      'idempotente@correo.com',
    );
    await prisma.codigoAcceso.updateMany({
      where: { contrato_id: contrato.id },
      data: { expira_en: new Date(Date.now() - 1000) },
    });
    expect(arr).toBeTruthy();

    await vincularContrato(
      app,
      token,
      contrato.codigo_acceso?.codigo ?? '',
    ).expect(OK);
  }, 90000);

  // ------------------------------------------------------------------
  // Normalización del código de entrada
  // ------------------------------------------------------------------
  it('un código con minúsculas y espacios, o sin guiones, funciona', async () => {
    const { codigo } = await nuevoContrato();
    const sinGuiones = codigo.replace(/-/g, '');

    for (const variante of [
      `  ${codigo.toLowerCase()} `,
      sinGuiones,
      sinGuiones.toLowerCase(),
    ]) {
      const respuesta = await validar(variante);
      expect([variante, respuesta.status]).toEqual([variante, OK]);
    }
  }, 90000);

  // ------------------------------------------------------------------
  // Bloqueo por intentos fallidos
  // ------------------------------------------------------------------
  it('5 intentos fallidos bloquean 15 minutos (429 DEMASIADOS_INTENTOS, también con un código válido) y vuelve a funcionar al pasar el bloqueo', async () => {
    const { codigo } = await nuevoContrato();

    for (let i = 0; i < 5; i += 1) {
      const fallo = await validar(`RC-ZZZZ-ZZZ${i + 2}`);
      expect([i, fallo.status]).toEqual([i, NO_ENCONTRADO]);
    }
    const bloqueado = await validar(codigo);
    expect(bloqueado.status).toBe(MUCHOS);
    expect(codigoError(bloqueado)).toBe('DEMASIADOS_INTENTOS');
    const bloqueadoInvalido = await validar('RC-ZZZZ-ZZZZ');
    expect([bloqueadoInvalido.status, bloqueadoInvalido.body]).toEqual([
      MUCHOS,
      bloqueado.body,
    ]);
    const fila = await prisma.intentoCodigo.findFirstOrThrow();
    expect(fila.bloqueado_hasta).not.toBeNull();
    const minutos = (fila.bloqueado_hasta!.getTime() - Date.now()) / 60000;
    expect(minutos).toBeGreaterThan(14);
    expect(minutos).toBeLessThan(15.1);

    await prisma.intentoCodigo.updateMany({
      data: { bloqueado_hasta: new Date(Date.now() - 1000) },
    });
    expect((await validar(codigo)).status).toBe(OK);
    expect((await prisma.intentoCodigo.findFirstOrThrow()).fallidos).toBe(0);
  }, 120000);

  it('un intento correcto reinicia el contador', async () => {
    const { codigo } = await nuevoContrato();
    for (let i = 0; i < 4; i += 1) {
      await validar(`RC-ZZZZ-ZZZ${i + 2}`).expect(NO_ENCONTRADO);
    }
    await validar(codigo).expect(OK);
    for (let i = 0; i < 4; i += 1) {
      await validar(`RC-ZZZZ-ZZZ${i + 2}`).expect(NO_ENCONTRADO);
    }

    expect((await validar(codigo)).status).toBe(OK);
  }, 120000);

  it('dos intentos fallidos simultáneos suman ambos (contador atómico)', async () => {
    await nuevoContrato();

    await Promise.all([
      validar('RC-ZZZZ-ZZZ2'),
      validar('RC-ZZZZ-ZZZ3'),
      validar('RC-ZZZZ-ZZZ4'),
    ]);

    expect((await prisma.intentoCodigo.findFirstOrThrow()).fallidos).toBe(3);
  }, 90000);

  it('completar-registro comparte el bloqueo por IP y vincular usa el origen cuenta:<id>', async () => {
    const { arr, contrato, codigo } = await nuevoContrato();
    for (let i = 0; i < 5; i += 1) {
      await completar(`RC-ZZZZ-ZZZ${i + 2}`, 'x@correo.com').expect(
        NO_ENCONTRADO,
      );
    }
    const bloqueado = await completar(codigo, 'y@correo.com');
    expect(bloqueado.status).toBe(MUCHOS);
    expect(codigoError(bloqueado)).toBe('DEMASIADOS_INTENTOS');
    await prisma.intentoCodigo.deleteMany();

    // vincular: origen por cuenta, no por IP.
    const token = await autenticarInquilino(
      app,
      codigo,
      'cuenta-bloqueo@correo.com',
    );
    const otro = await crearContrato(
      app,
      arr,
      (await crearInmueble(app, arr, `COD-B-${contador}`)).unidades[0].id,
      contrato.inquilino.id,
    );
    for (let i = 0; i < 5; i += 1) {
      await vincularContrato(app, token, `RC-ZZZZ-ZZZ${i + 2}`).expect(
        NO_ENCONTRADO,
      );
    }
    const enBloqueo = await vincularContrato(
      app,
      token,
      otro.codigo_acceso?.codigo ?? '',
    );
    expect(enBloqueo.status).toBe(MUCHOS);
    const origenes = (await prisma.intentoCodigo.findMany()).map(
      (f) => f.origen,
    );
    expect(origenes.some((o) => o.startsWith('cuenta:'))).toBe(true);
  }, 120000);

  // ------------------------------------------------------------------
  // Correo normalizado y cruzado
  // ------------------------------------------------------------------
  it('registro con "Ana@Correo.com " y login con "ana@correo.com" funciona; se guarda en minúsculas', async () => {
    await request(app.getHttpServer())
      .post('/auth/arrendador/registro')
      .send({
        nombre: 'Ana',
        correo: '  Ana@Correo.com ',
        telefono: '3001234567',
        contrasena: 'clave123',
      })
      .expect(CREADO);

    expect(
      (await prisma.arrendador.findFirstOrThrow({ where: { nombre: 'Ana' } }))
        .correo,
    ).toBe('ana@correo.com');
    for (const correo of ['ana@correo.com', 'ANA@CORREO.COM ']) {
      await request(app.getHttpServer())
        .post('/auth/arrendador/login')
        .send({ correo, contrasena: 'clave123' })
        .expect(OK);
    }
  }, 90000);

  it('el inquilino también se guarda y entra con el correo normalizado', async () => {
    const { codigo } = await nuevoContrato();

    await completar(codigo, '  Persona@Correo.COM ').expect(OK);

    expect(
      (
        await prisma.inquilino.findFirstOrThrow({
          where: { correo: { not: null } },
        })
      ).correo,
    ).toBe('persona@correo.com');
    await request(app.getHttpServer())
      .post('/auth/inquilino/login')
      .send({ correo: 'PERSONA@correo.com', contrasena: 'clave1234' })
      .expect(OK);
  }, 90000);

  it('un correo repetido o ya usado por el otro rol da el mismo 409 y el mismo texto', async () => {
    // Inquilino con cuenta y un arrendador.
    const { arr, codigo, correoArr } = await nuevoContrato();
    await completar(codigo, 'inquilino@correo.com').expect(OK);
    const otro = await nuevoContrato();

    const arrendadorRepetido = await request(app.getHttpServer())
      .post('/auth/arrendador/registro')
      .send({
        nombre: 'X',
        correo: correoArr.toUpperCase(),
        telefono: '1',
        contrasena: 'clave123',
      });
    const arrendadorConCorreoDeInquilino = await request(app.getHttpServer())
      .post('/auth/arrendador/registro')
      .send({
        nombre: 'Y',
        correo: 'Inquilino@Correo.com',
        telefono: '1',
        contrasena: 'clave123',
      });
    const inquilinoConCorreoDeArrendador = await completar(
      otro.codigo,
      correoArr,
    );
    const inquilinoConCorreoDeInquilino = await completar(
      otro.codigo,
      'inquilino@correo.com',
    );

    const respuestas = [
      arrendadorRepetido,
      arrendadorConCorreoDeInquilino,
      inquilinoConCorreoDeArrendador,
      inquilinoConCorreoDeInquilino,
    ];
    for (const respuesta of respuestas) {
      expect(respuesta.status).toBe(CONFLICTO);
      expect((respuesta.body as CuerpoError).mensaje).toBe(MENSAJE_REGISTRO);
    }
    expect(new Set(respuestas.map((r) => JSON.stringify(r.body))).size).toBe(1);
    expect(arr).toBeTruthy();
    // El código sin usar no se consumió.
    expect((await validar(otro.codigo)).status).toBe(OK);
  }, 120000);

  // ------------------------------------------------------------------
  // POST /inquilinos eliminado
  // ------------------------------------------------------------------
  it('POST /inquilinos ya no existe (404) y GET /inquilinos sigue funcionando', async () => {
    const { arr } = await nuevoContrato();

    await request(app.getHttpServer())
      .post('/inquilinos')
      .set('Authorization', `Bearer ${arr}`)
      .send({ nombre: 'X', cedula: '123456789', telefono: '3' })
      .expect(NO_ENCONTRADO);
    await request(app.getHttpServer())
      .get('/inquilinos')
      .set('Authorization', `Bearer ${arr}`)
      .expect(OK);
  }, 90000);
});
