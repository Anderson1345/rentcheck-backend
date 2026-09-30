import { HttpStatus, INestApplication, Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/configurar-app';
import { CodigoCorreoService } from '../src/correo/codigo-correo.service';
import { CANAL_CORREO } from '../src/correo/correo.constants';
import { PrismaService } from '../src/prisma/prisma.service';
import { CanalCorreoFalso } from './helpers/canal-correo-falso';
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
  codigo?: string;
  mensaje?: string;
  detalles?: unknown;
}

const MINUTO = 60 * 1000;
const CLAVE_VIEJA = 'clave-vieja-123';
const CLAVE_NUEVA = 'ClaveNueva-2026';

describe('Recuperación de contraseña (e2e)', () => {
  let prisma: PrismaService;
  let contador = 0;
  let contadorIp = 0;

  /** IP distinta por petición: cada prueba aísla el bloqueo por origen. */
  const nuevaIp = () => {
    contadorIp += 1;
    return `10.${100 + (Math.floor(contadorIp / 250) % 100)}.${contadorIp % 250}.${(contadorIp % 200) + 1}`;
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
    return { app, modulo };
  }

  const post = (
    app: INestApplication<App>,
    ruta: string,
    cuerpo: object,
    ip?: string,
  ) =>
    request(app.getHttpServer())
      .post(ruta)
      .set('X-Forwarded-For', ip ?? nuevaIp())
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
      ({ app } = await crearApp(canal));
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

    // ----------------------------------------------------------------
    // Cuentas (creadas directo en la base: no es lo que se prueba aquí)
    // ----------------------------------------------------------------
    async function arrendadorCon(
      correo: string,
      verificado: boolean,
      contrasena = CLAVE_VIEJA,
    ) {
      return prisma.arrendador.create({
        data: {
          nombre: 'Arrendador Recuperación',
          correo,
          telefono: '3001234567',
          contrasena_hash: await bcrypt.hash(contrasena, 4),
          correo_verificado_en: verificado
            ? new Date(Date.now() - 5 * MINUTO)
            : null,
        },
      });
    }

    async function inquilinoCon(
      correo: string,
      verificado: boolean,
      conCuenta = true,
    ) {
      contador += 1;
      return prisma.inquilino.create({
        data: {
          nombre: 'Inquilino Recuperación',
          cedula: `CC${900000 + contador}`,
          telefono: '3009876543',
          correo,
          contrasena_hash: conCuenta ? await bcrypt.hash(CLAVE_VIEJA, 4) : null,
          correo_verificado_en: verificado
            ? new Date(Date.now() - 5 * MINUTO)
            : null,
        },
      });
    }

    const recuperar = (correo: string, ip?: string) =>
      post(app, '/auth/recuperar-contrasena', { correo }, ip);

    const restablecer = (
      correo: string,
      codigo: string,
      nueva = CLAVE_NUEVA,
      ip?: string,
    ) =>
      post(
        app,
        '/auth/restablecer-contrasena',
        { correo, codigo, nueva_contrasena: nueva },
        ip,
      );

    const loginArrendador = (correo: string, contrasena: string) =>
      post(app, '/auth/arrendador/login', { correo, contrasena });
    const loginInquilino = (correo: string, contrasena: string) =>
      post(app, '/auth/inquilino/login', { correo, contrasena });

    const codigoError = (r: { body: unknown }) =>
      (r.body as CuerpoError).codigo;

    /** Como si la espera de 60 s ya hubiera pasado. */
    const envejecerCodigos = (correo: string, minutos: number) =>
      prisma.codigoCorreo.updateMany({
        where: { correo },
        data: { creado_en: new Date(Date.now() - minutos * MINUTO) },
      });

    const mensajesDeRecuperacion = (correo: string) =>
      canal
        .para(correo)
        .filter((m) => m.asunto.includes('restablecer la contraseña'));

    // ----------------------------------------------------------------
    it('recuperar-contrasena: mismo 202 para correo inexistente, inquilino sin cuenta, cuenta existente, en espera y sobre el tope; solo envía cuando corresponde', async () => {
      const existente = correoNuevo('arr-existe');
      await arrendadorCon(existente, true);
      const sinCuenta = correoNuevo('inq-sin-cuenta');
      await inquilinoCon(sinCuenta, false, false);
      const conCuentaInquilino = correoNuevo('inq-cuenta');
      await inquilinoCon(conCuentaInquilino, true);

      const inexistente = await recuperar(correoNuevo('fantasma'));
      const sinCuentaR = await recuperar(sinCuenta);
      const enviadoA = await recuperar(existente);
      const enviadoB = await recuperar(conCuentaInquilino);
      // Segunda llamada inmediata: en espera de 60 s.
      const enEspera = await recuperar(existente);

      // Sobre el tope de 5 por hora (el más reciente hace más de 60 s).
      const topeado = correoNuevo('arr-tope');
      await arrendadorCon(topeado, true);
      await prisma.codigoCorreo.createMany({
        data: [2, 10, 20, 30, 45].map((minutos) => ({
          correo: topeado,
          proposito: 'RECUPERACION' as const,
          codigo_hash: 'a'.repeat(64),
          expira_en: new Date(Date.now() + 10 * MINUTO),
          consumido_en: new Date(),
          creado_en: new Date(Date.now() - minutos * MINUTO),
        })),
      });
      const sobreElTope = await recuperar(topeado);

      const todas = [
        inexistente,
        sinCuentaR,
        enviadoA,
        enviadoB,
        enEspera,
        sobreElTope,
      ];
      for (const r of todas) {
        expect(r.status).toBe(ACEPTADO);
        expect(r.body).toEqual(inexistente.body);
      }
      expect((inexistente.body as { mensaje: string }).mensaje).toBe(
        'Si el correo corresponde a una cuenta, te enviamos un código.',
      );

      // Solo se envió a las dos cuentas con cuenta y fuera de espera y tope.
      expect(canal.mensajes).toHaveLength(2);
      expect(mensajesDeRecuperacion(existente)).toHaveLength(1);
      expect(mensajesDeRecuperacion(conCuentaInquilino)).toHaveLength(1);
      expect(canal.para(sinCuenta)).toHaveLength(0);
      expect(canal.para(topeado)).toHaveLength(0);
      expect(
        await prisma.codigoCorreo.count({ where: { correo: topeado } }),
      ).toBe(5);
    }, 120000);

    it('el mensaje de recuperación usa su plantilla: asunto, vigencia, aviso y sin enlaces ni contraseñas', async () => {
      const correo = correoNuevo('arr-plantilla');
      await arrendadorCon(correo, true);

      await recuperar(correo).expect(ACEPTADO);

      const mensaje = canal.para(correo)[0];
      const codigo = canal.ultimoCodigo(correo);
      expect(codigo).toMatch(/^\d{6}$/);
      expect(mensaje.asunto).toBe(
        'Tu código para restablecer la contraseña de RentCheck',
      );
      for (const cuerpo of [mensaje.texto, mensaje.html]) {
        expect(cuerpo).toContain(codigo);
        expect(cuerpo).toContain('10 minutos');
        expect(cuerpo).toContain(
          'Si no fuiste tú, ignora este mensaje y considera cambiar tu contraseña',
        );
        expect(cuerpo).not.toMatch(/https?:\/\//);
        expect(cuerpo).not.toContain(CLAVE_VIEJA);
        expect(cuerpo).not.toContain('Tu código de verificación');
      }
      const fila = await prisma.codigoCorreo.findFirstOrThrow({
        where: { correo },
      });
      expect(fila.proposito).toBe('RECUPERACION');
      expect(fila.codigo_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(fila)).not.toContain(`"${codigo}"`);
      expect(salida.join('\n')).not.toContain(codigo);
    }, 60000);

    it('un código de recuperación nuevo consume el anterior, pero no el de verificación', async () => {
      const correo = correoNuevo('arr-nuevo');
      await arrendadorCon(correo, false);
      // Un código de verificación ya emitido (p. ej. al registrarse).
      await post(app, '/auth/reenviar-verificacion', { correo }).expect(
        ACEPTADO,
      );
      const codigoVerificacion = canal.ultimoCodigo(correo);

      await recuperar(correo).expect(ACEPTADO);
      const primero = canal.ultimoCodigo(correo);
      await envejecerCodigos(correo, 2);
      await recuperar(correo).expect(ACEPTADO);
      const segundo = canal.ultimoCodigo(correo);

      const vigentes = await prisma.codigoCorreo.findMany({
        where: { correo, proposito: 'RECUPERACION', consumido_en: null },
      });
      expect(vigentes).toHaveLength(1);
      if (primero !== segundo) {
        const viejo = await restablecer(correo, primero);
        expect(viejo.status).toBe(MALA_PETICION);
        expect(codigoError(viejo)).toBe('CODIGO_INVALIDO');
      }
      // El de verificación sigue vigente y sirve.
      const verificacion = await post(app, '/auth/verificar-correo', {
        correo,
        codigo: codigoVerificacion,
      });
      expect(verificacion.status).toBe(OK);
    }, 120000);

    // ----------------------------------------------------------------
    it('restablecer (arrendador): cambia la contraseña, fija el correo verificado, consume el código y envía el aviso', async () => {
      const correo = correoNuevo('arr-restablece');
      await arrendadorCon(correo, false);
      await recuperar(correo).expect(ACEPTADO);
      const codigo = canal.ultimoCodigo(correo);
      const antes = await prisma.arrendador.findUniqueOrThrow({
        where: { correo },
      });
      expect(antes.correo_verificado_en).toBeNull();

      const r = await restablecer(correo, codigo);

      expect(r.status).toBe(OK);
      expect(r.body).toEqual({ contrasena_actualizada: true });
      expect((await loginArrendador(correo, CLAVE_VIEJA)).status).toBe(
        NO_AUTORIZADO,
      );
      const nuevo = await loginArrendador(correo, CLAVE_NUEVA);
      expect(nuevo.status).toBe(OK);
      expect((nuevo.body as { access_token: string }).access_token).toEqual(
        expect.any(String),
      );
      const despues = await prisma.arrendador.findUniqueOrThrow({
        where: { correo },
      });
      expect(despues.correo_verificado_en).not.toBeNull();
      expect(despues.contrasena_hash).not.toBe(antes.contrasena_hash);
      expect(await bcrypt.compare(CLAVE_NUEVA, despues.contrasena_hash)).toBe(
        true,
      );

      // Se consumió: usarlo otra vez falla.
      const reuso = await restablecer(correo, codigo, 'OtraClave-2027');
      expect(reuso.status).toBe(MALA_PETICION);
      expect(codigoError(reuso)).toBe('CODIGO_INVALIDO');
      expect((await loginArrendador(correo, 'OtraClave-2027')).status).toBe(
        NO_AUTORIZADO,
      );

      // Aviso de seguridad al mismo correo, sin datos sensibles.
      const avisos = canal
        .para(correo)
        .filter((m) => m.asunto === 'Tu contraseña de RentCheck fue cambiada');
      expect(avisos).toHaveLength(1);
      for (const cuerpo of [avisos[0].texto, avisos[0].html]) {
        expect(cuerpo).not.toContain(CLAVE_NUEVA);
        expect(cuerpo).not.toContain(codigo);
        expect(cuerpo).not.toMatch(/https?:\/\//);
      }
    }, 120000);

    it('restablecer (inquilino con cuenta): cambia la contraseña y NO modifica un correo ya verificado', async () => {
      const correo = correoNuevo('inq-restablece');
      const cuenta = await inquilinoCon(correo, true);
      await recuperar(correo).expect(ACEPTADO);
      const codigo = canal.ultimoCodigo(correo);

      const r = await restablecer(correo, codigo);

      expect(r.status).toBe(OK);
      expect(r.body).toEqual({ contrasena_actualizada: true });
      expect((await loginInquilino(correo, CLAVE_VIEJA)).status).toBe(
        NO_AUTORIZADO,
      );
      expect((await loginInquilino(correo, CLAVE_NUEVA)).status).toBe(OK);
      const despues = await prisma.inquilino.findUniqueOrThrow({
        where: { correo },
      });
      expect(despues.correo_verificado_en?.getTime()).toBe(
        cuenta.correo_verificado_en?.getTime(),
      );
      expect(
        canal
          .para(correo)
          .filter(
            (m) => m.asunto === 'Tu contraseña de RentCheck fue cambiada',
          ),
      ).toHaveLength(1);
    }, 120000);

    it('B-56: una cuenta sin verificar (registro del correo de otra persona) vuelve a su dueño y puede iniciar sesión con el proveedor activo', async () => {
      // Arrendador: alguien se registró con el correo de la víctima.
      const correoArr = correoNuevo('victima-arr');
      await post(app, '/auth/arrendador/registro', {
        nombre: 'Quien Ocupó El Correo',
        correo: correoArr,
        telefono: '3001234567',
        contrasena: 'clave-del-intruso-1',
      }).expect(CREADO);
      expect(
        (await loginArrendador(correoArr, 'clave-del-intruso-1')).status,
      ).toBe(PROHIBIDO);
      await envejecerCodigos(correoArr, 2);
      await recuperar(correoArr).expect(ACEPTADO);
      await restablecer(correoArr, canal.ultimoCodigo(correoArr)).expect(OK);
      expect(
        (await loginArrendador(correoArr, 'clave-del-intruso-1')).status,
      ).toBe(NO_AUTORIZADO);
      const arr = await loginArrendador(correoArr, CLAVE_NUEVA);
      expect(arr.status).toBe(OK);
      expect((arr.body as { access_token: string }).access_token).toEqual(
        expect.any(String),
      );

      // Inquilino sin verificar.
      const correoInq = correoNuevo('victima-inq');
      await inquilinoCon(correoInq, false);
      expect((await loginInquilino(correoInq, CLAVE_VIEJA)).status).toBe(
        PROHIBIDO,
      );
      await recuperar(correoInq).expect(ACEPTADO);
      await restablecer(correoInq, canal.ultimoCodigo(correoInq)).expect(OK);
      expect((await loginInquilino(correoInq, CLAVE_NUEVA)).status).toBe(OK);
    }, 120000);

    // ----------------------------------------------------------------
    it('una contraseña que no cumple las reglas es 400 VALIDACION y el código sigue vigente sin gastar un intento', async () => {
      const correo = correoNuevo('arr-debil');
      await arrendadorCon(correo, true);
      await recuperar(correo).expect(ACEPTADO);
      const codigo = canal.ultimoCodigo(correo);

      for (const debil of ['corta1', 'soloLetrasLargas', '1234567890', '']) {
        const r = await restablecer(correo, codigo, debil);
        expect(r.status).toBe(MALA_PETICION);
        expect(codigoError(r)).toBe('VALIDACION');
      }
      await post(app, '/auth/restablecer-contrasena', {
        correo,
        codigo,
      }).expect(MALA_PETICION);
      await restablecer(correo, '12345').expect(MALA_PETICION);

      const fila = await prisma.codigoCorreo.findFirstOrThrow({
        where: { correo, proposito: 'RECUPERACION' },
      });
      expect(fila.intentos).toBe(0);
      expect(fila.consumido_en).toBeNull();
      expect((await restablecer(correo, codigo)).status).toBe(OK);
    }, 120000);

    it('5 códigos equivocados consumen el código y el sexto intento con el correcto también falla', async () => {
      const correo = correoNuevo('arr-intentos');
      await arrendadorCon(correo, true);
      await recuperar(correo).expect(ACEPTADO);
      const correcto = canal.ultimoCodigo(correo);
      const equivocado = correcto === '000000' ? '111111' : '000000';

      for (let i = 0; i < 5; i += 1) {
        const r = await restablecer(correo, equivocado);
        expect(r.status).toBe(MALA_PETICION);
        expect(codigoError(r)).toBe('CODIGO_INVALIDO');
      }
      const fila = await prisma.codigoCorreo.findFirstOrThrow({
        where: { correo },
      });
      expect(fila.intentos).toBe(5);
      expect(fila.consumido_en).not.toBeNull();

      const sexto = await restablecer(correo, correcto);
      expect(sexto.status).toBe(MALA_PETICION);
      expect(codigoError(sexto)).toBe('CODIGO_INVALIDO');
      expect((await loginArrendador(correo, CLAVE_VIEJA)).status).toBe(OK);
    }, 120000);

    it('vencido, consumido, correo desconocido, cuenta inexistente y códigos de otro propósito dan exactamente el mismo 400', async () => {
      const correo = correoNuevo('arr-400');
      await arrendadorCon(correo, false);
      const cuerpos: unknown[] = [];
      const anotar = (r: { status: number; body: unknown }) => {
        expect(r.status).toBe(MALA_PETICION);
        expect(codigoError(r)).toBe('CODIGO_INVALIDO');
        cuerpos.push(r.body);
      };

      // Correo desconocido.
      anotar(await restablecer(correoNuevo('desconocido'), '123456'));

      // Vencido.
      await recuperar(correo).expect(ACEPTADO);
      const vencido = canal.ultimoCodigo(correo);
      await prisma.codigoCorreo.updateMany({
        where: { correo },
        data: { expira_en: new Date(Date.now() - MINUTO) },
      });
      anotar(await restablecer(correo, vencido));

      // Consumido al usarse.
      await envejecerCodigos(correo, 2);
      await recuperar(correo).expect(ACEPTADO);
      const valido = canal.ultimoCodigo(correo);
      await restablecer(correo, valido).expect(OK);
      anotar(await restablecer(correo, valido));

      // Código de VERIFICACION usado como de recuperación (y al revés).
      const otro = correoNuevo('arr-cruzado');
      await arrendadorCon(otro, false);
      await post(app, '/auth/reenviar-verificacion', { correo: otro }).expect(
        ACEPTADO,
      );
      const deVerificacion = canal.ultimoCodigo(otro);
      anotar(await restablecer(otro, deVerificacion));
      await recuperar(otro).expect(ACEPTADO);
      const deRecuperacion = canal.ultimoCodigo(otro);
      const alReves = await post(app, '/auth/verificar-correo', {
        correo: otro,
        codigo: deRecuperacion,
      });
      anotar(alReves);
      // Ninguno de los dos se gastó por el intento cruzado: cada uno sirve en lo suyo.
      await restablecer(otro, deRecuperacion).expect(OK);

      // Cuenta sin contraseña (inquilino sin cuenta) con un código emitido a mano:
      // el código no se gasta y la respuesta es la misma.
      const sinCuenta = correoNuevo('inq-sin-cuenta');
      await inquilinoCon(sinCuenta, false, false);
      const servicio = app.get(CodigoCorreoService);
      await servicio.emitir(sinCuenta, 'RECUPERACION');
      const huerfano = canal.ultimoCodigo(sinCuenta);
      expect(huerfano).toMatch(/^\d{6}$/);
      anotar(await restablecer(sinCuenta, huerfano));
      const fila = await prisma.codigoCorreo.findFirstOrThrow({
        where: { correo: sinCuenta },
      });
      expect(fila.consumido_en).toBeNull();

      for (const cuerpo of cuerpos.slice(1)) {
        expect(cuerpo).toEqual(cuerpos[0]);
      }
      // Es el mismo cuerpo que da verificar-correo con un código inválido.
      const deVerificar = await post(app, '/auth/verificar-correo', {
        correo: correoNuevo('nadie'),
        codigo: '123456',
      });
      expect(deVerificar.body).toEqual(cuerpos[0]);
    }, 240000);

    it('5 fallos seguidos desde el mismo origen dan 429, y los errores de validación no cuentan', async () => {
      const ip = '10.200.0.55';
      // Seis contraseñas débiles: 400 VALIDACION, no cuentan como intento fallido.
      for (let i = 0; i < 6; i += 1) {
        const r = await restablecer(
          correoNuevo('nadie'),
          '123456',
          'corta1',
          ip,
        );
        expect(r.status).toBe(MALA_PETICION);
        expect(codigoError(r)).toBe('VALIDACION');
      }
      for (let i = 0; i < 5; i += 1) {
        const r = await restablecer(
          correoNuevo('nadie'),
          '123456',
          CLAVE_NUEVA,
          ip,
        );
        expect(r.status).toBe(MALA_PETICION);
        expect(codigoError(r)).toBe('CODIGO_INVALIDO');
      }
      const bloqueado = await restablecer(
        correoNuevo('nadie'),
        '123456',
        CLAVE_NUEVA,
        ip,
      );
      expect(bloqueado.status).toBe(DEMASIADAS);
      expect(codigoError(bloqueado)).toBe('DEMASIADOS_INTENTOS');
      // El origen de la recuperación es propio: no bloquea la verificación.
      const verificar = await post(
        app,
        '/auth/verificar-correo',
        { correo: correoNuevo('nadie'), codigo: '123456' },
        ip,
      );
      expect(verificar.status).toBe(MALA_PETICION);
    }, 120000);

    // ----------------------------------------------------------------
    it('la contraseña nueva, su hash y el código no aparecen en logs ni respuestas; el aviso no tumba la operación si el canal falla', async () => {
      const correo = correoNuevo('arr-logs');
      await arrendadorCon(correo, true);
      await recuperar(correo).expect(ACEPTADO);
      const codigo = canal.ultimoCodigo(correo);
      // El canal cae justo antes de enviar el aviso de cambio.
      canal.falla = true;

      const r = await restablecer(correo, codigo);

      expect(r.status).toBe(OK);
      expect(r.body).toEqual({ contrasena_actualizada: true });
      expect((await loginArrendador(correo, CLAVE_NUEVA)).status).toBe(OK);
      const hash = (
        await prisma.arrendador.findUniqueOrThrow({ where: { correo } })
      ).contrasena_hash;
      const todo = salida.join('\n');
      expect(todo).not.toContain(CLAVE_NUEVA);
      expect(todo).not.toContain(hash);
      expect(todo).not.toContain(codigo);
      expect(JSON.stringify(r.body)).not.toContain(hash);
      // Sí quedó un aviso del fallo del canal, sin datos sensibles.
      expect(todo).toMatch(/aviso|cambio de contraseña/i);
    }, 120000);

    it('recuperar-contrasena valida el cuerpo', async () => {
      for (const cuerpo of [{}, { correo: 'no-es-correo' }]) {
        await post(app, '/auth/recuperar-contrasena', cuerpo).expect(
          MALA_PETICION,
        );
      }
    }, 60000);
  });

  // ==================================================================
  // Con el proveedor desactivado (valor por defecto): nada cambia
  // ==================================================================
  describe('con el proveedor desactivado (por defecto)', () => {
    let app: INestApplication<App>;

    beforeEach(async () => {
      ({ app } = await crearApp());
    });

    afterEach(async () => {
      await app.close();
    });

    it('recuperar-contrasena y restablecer-contrasena responden 503 CORREO_NO_DISPONIBLE', async () => {
      const a = await post(app, '/auth/recuperar-contrasena', {
        correo: 'a@b.com',
      });
      const b = await post(app, '/auth/restablecer-contrasena', {
        correo: 'a@b.com',
        codigo: '123456',
        nueva_contrasena: CLAVE_NUEVA,
      });
      for (const r of [a, b]) {
        expect(r.status).toBe(NO_DISPONIBLE);
        expect((r.body as CuerpoError).codigo).toBe('CORREO_NO_DISPONIBLE');
      }
      expect(await prisma.codigoCorreo.count()).toBe(0);
    });
  });
});
