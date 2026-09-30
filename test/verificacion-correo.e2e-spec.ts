import { HttpStatus, INestApplication, Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/configurar-app';
import { CANAL_CORREO } from '../src/correo/correo.constants';
import { PrismaService } from '../src/prisma/prisma.service';
import { CanalCorreoFalso } from './helpers/canal-correo-falso';
import {
  crearContrato,
  crearInmueble,
  crearInquilino,
} from './helpers/crear-datos.helper';
import { limpiarBd } from './helpers/limpiar-bd';

const OK: number = HttpStatus.OK;
const CREADO: number = HttpStatus.CREATED;
const ACEPTADO: number = HttpStatus.ACCEPTED;
const MALA_PETICION: number = HttpStatus.BAD_REQUEST;
const NO_AUTORIZADO: number = HttpStatus.UNAUTHORIZED;
const PROHIBIDO: number = HttpStatus.FORBIDDEN;
const NO_DISPONIBLE: number = HttpStatus.SERVICE_UNAVAILABLE;
const DEMASIADAS: number = HttpStatus.TOO_MANY_REQUESTS;

interface CuerpoError {
  statusCode?: number;
  codigo?: string;
  mensaje?: string;
}

const MINUTO = 60 * 1000;

describe('Verificación de correo (e2e)', () => {
  let prisma: PrismaService;
  let contador = 0;
  let contadorIp = 0;

  /** IP distinta por petición: cada prueba aísla el bloqueo por origen. */
  const nuevaIp = () => {
    contadorIp += 1;
    return `10.${Math.floor(contadorIp / 250) % 250}.${contadorIp % 250}.${(contadorIp % 200) + 1}`;
  };

  const correoNuevo = (prefijo: string) => {
    contador += 1;
    return `${prefijo}-${contador}@correo.com`;
  };

  async function crearApp(canal?: CanalCorreoFalso) {
    let constructor = Test.createTestingModule({ imports: [AppModule] });
    if (canal) {
      constructor = constructor.overrideProvider(CANAL_CORREO).useValue(canal);
    }
    const modulo: TestingModule = await constructor.compile();
    const app = modulo.createNestApplication<INestApplication<App>>();
    configurarApp(app);
    await app.init();
    return app;
  }

  const post = (app: INestApplication<App>, ruta: string, cuerpo: object) =>
    request(app.getHttpServer())
      .post(ruta)
      .set('X-Forwarded-For', nuevaIp())
      .send(cuerpo);

  beforeEach(async () => {
    // El límite por IP/ruta no es lo que se prueba aquí.
    jest.spyOn(ThrottlerGuard.prototype, 'canActivate').mockResolvedValue(true);
    prisma = new PrismaService();
    await prisma.$connect();
    await limpiarBd(prisma);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await prisma.$disconnect();
  });

  afterAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await limpiarBd(prisma);
    await prisma.$disconnect();
  });

  // ==================================================================
  // Con un proveedor activo (canal falso)
  // ==================================================================
  describe('con un proveedor activo', () => {
    let app: INestApplication<App>;
    let canal: CanalCorreoFalso;
    let salida: string[];

    beforeEach(async () => {
      canal = new CanalCorreoFalso();
      app = await crearApp(canal);
      // Todo lo que el servidor escribe en los logs.
      salida = [];
      const capturar = (...partes: unknown[]) => {
        salida.push(partes.map((p) => String(p)).join(' '));
        return true;
      };
      jest.spyOn(process.stdout, 'write').mockImplementation(capturar);
      jest.spyOn(process.stderr, 'write').mockImplementation(capturar);
      for (const metodo of [
        'log',
        'warn',
        'error',
        'debug',
        'verbose',
      ] as const) {
        jest.spyOn(Logger.prototype, metodo).mockImplementation(capturar);
      }
    });

    afterEach(async () => {
      await app.close();
    });

    const registrarArrendadorNuevo = async (correo: string) =>
      post(app, '/auth/arrendador/registro', {
        nombre: 'Arrendador Verificación',
        correo,
        telefono: '3001234567',
        contrasena: 'clave123',
      });

    const loginArrendador = (correo: string, contrasena = 'clave123') =>
      post(app, '/auth/arrendador/login', { correo, contrasena });

    const verificar = (correo: string, codigo: string, ip?: string) =>
      request(app.getHttpServer())
        .post('/auth/verificar-correo')
        .set('X-Forwarded-For', ip ?? nuevaIp())
        .send({ correo, codigo });

    const reenviar = (correo: string) =>
      post(app, '/auth/reenviar-verificacion', { correo });

    const codigoError = (r: { body: unknown }) =>
      (r.body as CuerpoError).codigo;

    /** Como si la espera de 60 s ya hubiera pasado. */
    const envejecerCodigos = (correo: string, minutos: number) =>
      prisma.codigoCorreo.updateMany({
        where: { correo },
        data: { creado_en: new Date(Date.now() - minutos * MINUTO) },
      });

    // ----------------------------------------------------------------
    it('GET /auth/capacidades da true/true', async () => {
      const r = await request(app.getHttpServer())
        .get('/auth/capacidades')
        .expect(OK);
      expect(r.body).toEqual({
        verificacion_correo: true,
        recuperacion_contrasena: true,
      });
    });

    // ----------------------------------------------------------------
    it('registro de arrendador: 201 sin token, cuenta creada, un código vigente, un mensaje y nada en claro', async () => {
      const correo = correoNuevo('arr-reg');
      const r = await registrarArrendadorNuevo(correo).then((res) => res);

      expect(r.status).toBe(CREADO);
      expect(r.body).toEqual({ requiere_verificacion: true, correo });
      expect(JSON.stringify(r.body)).not.toContain('access_token');

      const cuenta = await prisma.arrendador.findUniqueOrThrow({
        where: { correo },
      });
      expect(cuenta.correo_verificado_en).toBeNull();

      const filas = await prisma.codigoCorreo.findMany({ where: { correo } });
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({
        proposito: 'VERIFICACION',
        intentos: 0,
        consumido_en: null,
      });
      const vigencia =
        filas[0].expira_en.getTime() - filas[0].creado_en.getTime();
      expect(vigencia).toBeGreaterThan(9.9 * MINUTO);
      expect(vigencia).toBeLessThanOrEqual(10.1 * MINUTO);

      expect(canal.para(correo)).toHaveLength(1);
      const mensaje = canal.para(correo)[0];
      const codigo = canal.ultimoCodigo(correo);
      expect(codigo).toMatch(/^\d{6}$/);
      expect(mensaje.asunto).toBe('Tu código de verificación de RentCheck');
      for (const cuerpo of [mensaje.texto, mensaje.html]) {
        expect(cuerpo).toContain(codigo);
        expect(cuerpo).toContain('10 minutos');
        expect(cuerpo).toContain('Si no fuiste tú, ignora este mensaje');
        expect(cuerpo).not.toMatch(/https?:\/\//);
        expect(cuerpo.toLowerCase()).not.toContain('contraseña:');
      }

      // Ni la base de datos ni los logs contienen el código en claro.
      expect(filas[0].codigo_hash).not.toContain(codigo);
      expect(filas[0].codigo_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(filas)).not.toContain(`"${codigo}"`);
      expect(salida.join('\n')).not.toContain(codigo);
    }, 60000);

    // ----------------------------------------------------------------
    it('login del arrendador: 401 genérico con contraseña mala, 403 CORREO_NO_VERIFICADO sin token con la buena, 200 tras verificar', async () => {
      const correo = correoNuevo('arr-login');
      await registrarArrendadorNuevo(correo);

      const mala = await loginArrendador(correo, 'clave-equivocada');
      expect(mala.status).toBe(NO_AUTORIZADO);
      const inexistente = await loginArrendador(correoNuevo('nadie'));
      expect(inexistente.status).toBe(NO_AUTORIZADO);
      expect(mala.body).toEqual(inexistente.body);

      const sinVerificar = await loginArrendador(correo);
      expect(sinVerificar.status).toBe(PROHIBIDO);
      expect(codigoError(sinVerificar)).toBe('CORREO_NO_VERIFICADO');
      expect(JSON.stringify(sinVerificar.body)).not.toContain('access_token');

      const v = await verificar(correo, canal.ultimoCodigo(correo));
      expect(v.status).toBe(OK);
      expect(v.body).toEqual({ correo_verificado: true });

      const cuenta = await prisma.arrendador.findUniqueOrThrow({
        where: { correo },
      });
      expect(cuenta.correo_verificado_en).not.toBeNull();
      const ok = await loginArrendador(correo);
      expect(ok.status).toBe(OK);
      expect((ok.body as { access_token: string }).access_token).toEqual(
        expect.any(String),
      );
    }, 60000);

    // ----------------------------------------------------------------
    /** Arrendador ya verificado, con cédula y un contrato (para el inquilino). */
    async function contratoParaInquilino() {
      const correo = correoNuevo('arr-base');
      await registrarArrendadorNuevo(correo);
      await verificar(correo, canal.ultimoCodigo(correo)).expect(OK);
      const login = await loginArrendador(correo).expect(OK);
      const token = (login.body as { access_token: string }).access_token;
      await request(app.getHttpServer())
        .patch('/arrendadores/perfil')
        .set('Authorization', `Bearer ${token}`)
        .send({ cedula: '900123456' })
        .expect(OK);
      const inmueble = await crearInmueble(app, token, `VER-${contador}`);
      const ficha = await crearInquilino(app, token);
      const contrato = await crearContrato(
        app,
        token,
        inmueble.unidades[0].id,
        ficha.id,
      );
      return { codigoAcceso: contrato.codigo_acceso?.codigo ?? '', contrato };
    }

    const completarRegistro = (
      codigo: string,
      correo: string,
      contrasena = 'clave1234',
    ) =>
      post(app, '/auth/inquilino/completar-registro', {
        codigo,
        correo,
        contrasena,
      });

    const loginInquilino = (correo: string, contrasena = 'clave1234') =>
      post(app, '/auth/inquilino/login', { correo, contrasena });

    it('inquilino: completar-registro da 201 sin token (cuenta y vinculación sí se crean), login 403 hasta verificar y 200 después', async () => {
      const { codigoAcceso, contrato } = await contratoParaInquilino();
      const correo = correoNuevo('inq');

      const r = await completarRegistro(codigoAcceso, correo);
      expect(r.status).toBe(CREADO);
      expect(r.body).toEqual({ requiere_verificacion: true, correo });

      const cuenta = await prisma.inquilino.findUniqueOrThrow({
        where: { correo },
      });
      expect(cuenta.correo_verificado_en).toBeNull();
      expect(cuenta.contrasena_hash).not.toBeNull();
      // La vinculación del contrato sigue en la misma transacción.
      const fila = await prisma.contrato.findUniqueOrThrow({
        where: { id: contrato.id },
      });
      expect(fila.vinculado_en).not.toBeNull();

      const filas = await prisma.codigoCorreo.findMany({ where: { correo } });
      expect(filas).toHaveLength(1);
      expect(canal.para(correo)).toHaveLength(1);
      const codigo = canal.ultimoCodigo(correo);
      expect(salida.join('\n')).not.toContain(codigo);
      expect(JSON.stringify(filas)).not.toContain(`"${codigo}"`);

      expect((await loginInquilino(correo, 'mala-mala-1')).status).toBe(
        NO_AUTORIZADO,
      );
      const sinVerificar = await loginInquilino(correo);
      expect(sinVerificar.status).toBe(PROHIBIDO);
      expect(codigoError(sinVerificar)).toBe('CORREO_NO_VERIFICADO');

      await verificar(correo, codigo).expect(OK);
      expect(
        (await prisma.inquilino.findUniqueOrThrow({ where: { correo } }))
          .correo_verificado_en,
      ).not.toBeNull();
      const ok = await loginInquilino(correo);
      expect(ok.status).toBe(OK);
      expect((ok.body as { access_token: string }).access_token).toEqual(
        expect.any(String),
      );
    }, 120000);

    // ----------------------------------------------------------------
    it('verificar-correo: 5 fallos consumen el código y el sexto intento con el código correcto también falla', async () => {
      const correo = correoNuevo('arr-intentos');
      await registrarArrendadorNuevo(correo);
      const correcto = canal.ultimoCodigo(correo);
      const equivocado = correcto === '000000' ? '111111' : '000000';

      for (let i = 0; i < 5; i += 1) {
        const r = await verificar(correo, equivocado);
        expect(r.status).toBe(MALA_PETICION);
        expect(codigoError(r)).toBe('CODIGO_INVALIDO');
      }
      const fila = await prisma.codigoCorreo.findFirstOrThrow({
        where: { correo },
      });
      expect(fila.intentos).toBe(5);
      expect(fila.consumido_en).not.toBeNull();

      const sexto = await verificar(correo, correcto);
      expect(sexto.status).toBe(MALA_PETICION);
      expect(codigoError(sexto)).toBe('CODIGO_INVALIDO');
      expect(
        (await prisma.arrendador.findUniqueOrThrow({ where: { correo } }))
          .correo_verificado_en,
      ).toBeNull();
    }, 120000);

    it('verificar-correo: vencido, consumido, equivocado, ya verificado y correo desconocido dan exactamente el mismo 400', async () => {
      const correo = correoNuevo('arr-400');
      await registrarArrendadorNuevo(correo);
      const codigo = canal.ultimoCodigo(correo);

      const cuerpos: unknown[] = [];
      const anotar = (r: { status: number; body: unknown }) => {
        expect(r.status).toBe(MALA_PETICION);
        expect(codigoError(r)).toBe('CODIGO_INVALIDO');
        cuerpos.push(r.body);
      };

      // Correo desconocido.
      anotar(await verificar(correoNuevo('desconocido'), '123456'));
      // Código equivocado.
      anotar(
        await verificar(correo, codigo === '123456' ? '654321' : '123456'),
      );
      // Vencido.
      await prisma.codigoCorreo.updateMany({
        where: { correo },
        data: { expira_en: new Date(Date.now() - MINUTO) },
      });
      anotar(await verificar(correo, codigo));
      // Consumido al usarse (código nuevo, correcto, y un segundo uso).
      await prisma.codigoCorreo.deleteMany({ where: { correo } });
      await envejecerCodigos(correo, 5);
      await reenviar(correo);
      const nuevo = canal.ultimoCodigo(correo);
      await verificar(correo, nuevo).expect(OK);
      anotar(await verificar(correo, nuevo));
      // Ya verificado (aunque se intente con cualquier código).
      anotar(await verificar(correo, '123456'));

      for (const cuerpo of cuerpos.slice(1)) {
        expect(cuerpo).toEqual(cuerpos[0]);
      }
    }, 180000);

    it('verificar-correo: 5 fallos desde la misma IP bloquean con 429 DEMASIADOS_INTENTOS', async () => {
      const ip = '10.250.0.77';
      for (let i = 0; i < 5; i += 1) {
        const r = await verificar(correoNuevo('nadie'), '123456', ip);
        expect(r.status).toBe(MALA_PETICION);
      }
      const bloqueado = await verificar(correoNuevo('nadie'), '123456', ip);
      expect(bloqueado.status).toBe(DEMASIADAS);
      expect(codigoError(bloqueado)).toBe('DEMASIADOS_INTENTOS');
    }, 120000);

    it('verificar-correo valida el cuerpo: código de 6 dígitos y correo válido', async () => {
      for (const cuerpo of [
        { correo: 'no-es-correo', codigo: '123456' },
        { correo: 'a@b.com', codigo: '12345' },
        { correo: 'a@b.com', codigo: 'abcdef' },
        { correo: 'a@b.com' },
      ]) {
        await post(app, '/auth/verificar-correo', cuerpo).expect(MALA_PETICION);
      }
    }, 60000);

    // ----------------------------------------------------------------
    it('reenviar-verificacion: misma respuesta 202 exista o no el correo, esté verificado o en espera; solo envía cuando corresponde', async () => {
      const correo = correoNuevo('arr-reenvio');
      await registrarArrendadorNuevo(correo);
      const enviadosTrasRegistro = canal.mensajes.length;
      expect(enviadosTrasRegistro).toBe(1);

      // En espera de 60 s (el registro acaba de enviar uno).
      const enEspera = await reenviar(correo);
      expect(enEspera.status).toBe(ACEPTADO);
      expect(canal.mensajes).toHaveLength(enviadosTrasRegistro);

      // Correo inexistente.
      const inexistente = await reenviar(correoNuevo('fantasma'));
      expect(inexistente.status).toBe(ACEPTADO);
      expect(canal.mensajes).toHaveLength(enviadosTrasRegistro);

      // Pasada la espera: envía y el código anterior deja de servir.
      const anterior = canal.ultimoCodigo(correo);
      await envejecerCodigos(correo, 2);
      const enviado = await reenviar(correo);
      expect(enviado.status).toBe(ACEPTADO);
      expect(canal.mensajes).toHaveLength(enviadosTrasRegistro + 1);
      const vigentes = await prisma.codigoCorreo.findMany({
        where: { correo, consumido_en: null },
      });
      expect(vigentes).toHaveLength(1);
      const nuevo = canal.ultimoCodigo(correo);
      if (nuevo !== anterior) {
        expect((await verificar(correo, anterior)).status).toBe(MALA_PETICION);
      }

      // Las cuatro respuestas 202 son idénticas.
      const inexistente2 = await reenviar(correoNuevo('fantasma'));
      expect(enEspera.body).toEqual(inexistente.body);
      expect(enviado.body).toEqual(inexistente.body);
      expect(inexistente2.body).toEqual(inexistente.body);

      // Ya verificado: 202 idéntico y sin envío.
      await verificar(correo, nuevo).expect(OK);
      await envejecerCodigos(correo, 5);
      const cantidad = canal.mensajes.length;
      const verificado = await reenviar(correo);
      expect(verificado.status).toBe(ACEPTADO);
      expect(verificado.body).toEqual(inexistente.body);
      expect(canal.mensajes).toHaveLength(cantidad);
    }, 180000);

    it('reenviar-verificacion: por encima de 5 envíos por hora no envía (202 igual)', async () => {
      const correo = correoNuevo('arr-tope');
      await registrarArrendadorNuevo(correo);
      // Cinco códigos en la última hora (el más reciente hace más de 60 s).
      await prisma.codigoCorreo.deleteMany({ where: { correo } });
      await prisma.codigoCorreo.createMany({
        data: [2, 10, 20, 30, 45].map((minutos) => ({
          correo,
          proposito: 'VERIFICACION' as const,
          codigo_hash: 'a'.repeat(64),
          expira_en: new Date(Date.now() + 10 * MINUTO),
          consumido_en: new Date(),
          creado_en: new Date(Date.now() - minutos * MINUTO),
        })),
      });
      const antes = canal.mensajes.length;

      const r = await reenviar(correo);

      expect(r.status).toBe(ACEPTADO);
      expect(canal.mensajes).toHaveLength(antes);
      expect(await prisma.codigoCorreo.count({ where: { correo } })).toBe(5);

      // Fuera de la ventana de una hora, vuelve a enviar.
      await prisma.codigoCorreo.updateMany({
        where: { correo },
        data: { creado_en: new Date(Date.now() - 2 * 60 * MINUTO) },
      });
      await reenviar(correo).expect(ACEPTADO);
      expect(canal.mensajes).toHaveLength(antes + 1);
    }, 120000);

    it('si el canal falla, el registro y el reenvío siguen respondiendo igual y el código no queda en los logs', async () => {
      canal.falla = true;
      const correo = correoNuevo('arr-falla');
      const r = await registrarArrendadorNuevo(correo);
      expect(r.status).toBe(CREADO);
      expect(r.body).toEqual({ requiere_verificacion: true, correo });
      expect(await prisma.arrendador.count({ where: { correo } })).toBe(1);

      await envejecerCodigos(correo, 2);
      const reenvio = await reenviar(correo);
      expect(reenvio.status).toBe(ACEPTADO);

      // El código que quedó en la base no aparece en ningún log.
      const filas = await prisma.codigoCorreo.findMany({ where: { correo } });
      expect(filas.length).toBeGreaterThan(0);
      // (sin el PID del prefijo `[Nest] 123456` de los logs de Nest)
      expect(salida.join('\n').replace(/\[Nest\] \d+/g, '')).not.toMatch(
        /\b\d{6}\b/,
      );
    }, 120000);

    it('un arrendador existente sin verificar puede verificar con reenviar + verificar', async () => {
      // Cuenta anterior a la verificación: sin correo_verificado_en y sin códigos.
      const correo = correoNuevo('arr-legado');
      await prisma.arrendador.create({
        data: {
          nombre: 'Legado',
          correo,
          telefono: '3000000000',
          contrasena_hash:
            '$2b$10$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz012345',
        },
      });
      await reenviar(correo).expect(ACEPTADO);
      expect(canal.para(correo)).toHaveLength(1);
      await verificar(correo, canal.ultimoCodigo(correo)).expect(OK);
      expect(
        (await prisma.arrendador.findUniqueOrThrow({ where: { correo } }))
          .correo_verificado_en,
      ).not.toBeNull();
    }, 60000);
  });

  // ==================================================================
  // Con el proveedor desactivado (valor por defecto): nada cambia
  // ==================================================================
  describe('con el proveedor desactivado (por defecto)', () => {
    let app: INestApplication<App>;

    beforeEach(async () => {
      app = await crearApp();
    });

    afterEach(async () => {
      await app.close();
    });

    it('GET /auth/capacidades da false/false', async () => {
      const r = await request(app.getHttpServer())
        .get('/auth/capacidades')
        .expect(OK);
      expect(r.body).toEqual({
        verificacion_correo: false,
        recuperacion_contrasena: false,
      });
    });

    it('reenviar-verificacion y verificar-correo responden 503 CORREO_NO_DISPONIBLE', async () => {
      const a = await post(app, '/auth/reenviar-verificacion', {
        correo: 'a@b.com',
      });
      const b = await post(app, '/auth/verificar-correo', {
        correo: 'a@b.com',
        codigo: '123456',
      });
      for (const r of [a, b]) {
        expect(r.status).toBe(NO_DISPONIBLE);
        expect((r.body as CuerpoError).codigo).toBe('CORREO_NO_DISPONIBLE');
      }
    });

    it('registro, login y completar-registro se comportan como siempre (con token, sin verificación)', async () => {
      const correo = correoNuevo('arr-desactivado');
      const registro = await post(app, '/auth/arrendador/registro', {
        nombre: 'Arrendador',
        correo,
        telefono: '3001234567',
        contrasena: 'clave123',
      });
      expect(registro.status).toBe(CREADO);
      const cuerpo = registro.body as {
        access_token: string;
        arrendador: { id: string };
      };
      expect(cuerpo.access_token).toEqual(expect.any(String));
      expect(JSON.stringify(registro.body)).not.toContain(
        'requiere_verificacion',
      );

      const login = await post(app, '/auth/arrendador/login', {
        correo,
        contrasena: 'clave123',
      });
      expect(login.status).toBe(OK);
      expect((login.body as { access_token: string }).access_token).toEqual(
        expect.any(String),
      );

      // Inquilino: crea cuenta con el código y recibe token (200, como hoy).
      await request(app.getHttpServer())
        .patch('/arrendadores/perfil')
        .set('Authorization', `Bearer ${cuerpo.access_token}`)
        .send({ cedula: '900123456' })
        .expect(OK);
      const inmueble = await crearInmueble(app, cuerpo.access_token, 'DES-1');
      const ficha = await crearInquilino(app, cuerpo.access_token);
      const contrato = await crearContrato(
        app,
        cuerpo.access_token,
        inmueble.unidades[0].id,
        ficha.id,
      );
      const correoInquilino = correoNuevo('inq-desactivado');
      const completar = await post(app, '/auth/inquilino/completar-registro', {
        codigo: contrato.codigo_acceso?.codigo,
        correo: correoInquilino,
        contrasena: 'clave1234',
      });
      expect(completar.status).toBe(OK);
      expect((completar.body as { access_token: string }).access_token).toEqual(
        expect.any(String),
      );
      const loginInquilino = await post(app, '/auth/inquilino/login', {
        correo: correoInquilino,
        contrasena: 'clave1234',
      });
      expect(loginInquilino.status).toBe(OK);
      expect(await prisma.codigoCorreo.count()).toBe(0);
    }, 120000);
  });
  // ==================================================================
  // Arranque: configuraciones que deben impedirlo
  // ==================================================================
  describe('arranque de la aplicación', () => {
    const VARIABLES = [
      'CORREO_PROVEEDOR',
      'CORREO_REMITENTE',
      'RESEND_API_KEY',
      'NODE_ENV',
    ] as const;
    const originales: Record<string, string | undefined> = {};

    beforeEach(() => {
      for (const variable of VARIABLES) {
        originales[variable] = process.env[variable];
      }
    });

    afterEach(() => {
      for (const variable of VARIABLES) {
        if (originales[variable] === undefined) {
          delete process.env[variable];
        } else {
          process.env[variable] = originales[variable];
        }
      }
    });

    const arrancar = () =>
      Test.createTestingModule({ imports: [AppModule] }).compile();

    it('CORREO_PROVEEDOR=consola con NODE_ENV=production impide el arranque', async () => {
      process.env.CORREO_PROVEEDOR = 'consola';
      process.env.NODE_ENV = 'production';
      await expect(arrancar()).rejects.toThrow(/consola.*producci/i);
    });

    it('CORREO_PROVEEDOR=resend sin RESEND_API_KEY o sin CORREO_REMITENTE impide el arranque', async () => {
      process.env.CORREO_PROVEEDOR = 'resend';
      delete process.env.RESEND_API_KEY;
      process.env.CORREO_REMITENTE = 'RentCheck <no-responder@ejemplo.com>';
      await expect(arrancar()).rejects.toThrow(/RESEND_API_KEY/);

      process.env.RESEND_API_KEY = 're_clave_de_prueba';
      delete process.env.CORREO_REMITENTE;
      await expect(arrancar()).rejects.toThrow(/CORREO_REMITENTE/);
    });

    it('con consola fuera de producción arranca y reporta el correo como disponible', async () => {
      process.env.CORREO_PROVEEDOR = 'consola';
      process.env.NODE_ENV = 'test';
      const modulo = await arrancar();
      const app = modulo.createNestApplication<INestApplication<App>>();
      configurarApp(app);
      await app.init();
      const r = await request(app.getHttpServer())
        .get('/auth/capacidades')
        .expect(OK);
      expect(r.body).toEqual({
        verificacion_correo: true,
        recuperacion_contrasena: true,
      });
      await app.close();
    });
  });
});
