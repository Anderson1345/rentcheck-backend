import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/configurar-app';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  crearInmueble,
  registrarArrendador,
} from './helpers/crear-datos.helper';
import { enDias } from './helpers/fechas.helper';
import { limpiarBd } from './helpers/limpiar-bd';

const OK: number = HttpStatus.OK;
const CREADO: number = HttpStatus.CREATED;
const MALA_PETICION: number = HttpStatus.BAD_REQUEST;

interface CuerpoError {
  codigo?: string;
  mensaje?: string;
}

const MENSAJE = 'La fecha de fin del contrato debe ser posterior a hoy.';

describe('fecha_fin posterior a hoy (B-55, e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let contador = 0;

  beforeEach(async () => {
    jest.spyOn(ThrottlerGuard.prototype, 'canActivate').mockResolvedValue(true);
    prisma = new PrismaService();
    await prisma.$connect();
    await limpiarBd(prisma);
    const modulo: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = modulo.createNestApplication<INestApplication<App>>();
    configurarApp(app);
    await app.init();
  });

  afterEach(async () => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    await app.close();
    await prisma.$disconnect();
  });

  afterAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await limpiarBd(prisma);
    await prisma.$disconnect();
  });

  async function preparar() {
    contador += 1;
    const { access_token } = await registrarArrendador(
      app,
      `Arrendador Fin ${contador}`,
      `fin-${contador}@correo.com`,
    );
    const inmueble = await crearInmueble(app, access_token, `FIN-${contador}`);
    return { token: access_token, unidadId: inmueble.unidades[0].id };
  }

  const cuerpoContrato = (
    unidadId: string,
    fechas: { fecha_inicio: string; fecha_fin: string },
  ) => ({
    unidad_id: unidadId,
    inquilino_nuevo: {
      nombre: 'Persona Fin',
      cedula: `CC99${++contador}${Date.now().toString().slice(-6)}`,
      telefono: '3001112233',
    },
    tipo_plantilla: 'VIVIENDA_URBANA_LEY_820',
    canon_centavos: 1000000,
    dia_pago: 5,
    forma_pago: 'Transferencia',
    datos_recaudo: 'Bancolombia 123',
    ...fechas,
  });

  const crear = (
    token: string,
    unidadId: string,
    fechas: { fecha_inicio: string; fecha_fin: string },
  ) =>
    request(app.getHttpServer())
      .post('/contratos')
      .set('Authorization', `Bearer ${token}`)
      .send(cuerpoContrato(unidadId, fechas));

  const corregir = (token: string, id: string, cuerpo: object) =>
    request(app.getHttpServer())
      .patch(`/contratos/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send(cuerpo);

  const codigoError = (r: { body: unknown }) => (r.body as CuerpoError).codigo;

  // ------------------------------------------------------------------
  // crear()
  // ------------------------------------------------------------------
  it('crear() con fecha_fin = hoy o anterior es 400 FECHA_FIN_PASADA y no escribe nada', async () => {
    const { token, unidadId } = await preparar();
    const identidades = await prisma.inquilino.count();

    for (const fin of [enDias(0), enDias(-1), enDias(-90)]) {
      const r = await crear(token, unidadId, {
        fecha_inicio: enDias(-400),
        fecha_fin: fin,
      });
      expect([fin, r.status, codigoError(r)]).toEqual([
        fin,
        MALA_PETICION,
        'FECHA_FIN_PASADA',
      ]);
      expect((r.body as CuerpoError).mensaje).toBe(MENSAJE);
    }

    expect(await prisma.contrato.count()).toBe(0);
    expect(await prisma.inquilino.count()).toBe(identidades);
    expect(await prisma.documentoContrato.count()).toBe(0);
    expect(await prisma.codigoAcceso.count()).toBe(0);
  }, 120000);

  it('crear() con fecha_fin = mañana funciona', async () => {
    const { token, unidadId } = await preparar();
    const r = await crear(token, unidadId, {
      fecha_inicio: enDias(-30),
      fecha_fin: enDias(1),
    });
    expect(r.status).toBe(CREADO);
    expect(await prisma.contrato.count()).toBe(1);
  }, 120000);

  it('el orden de validación se conserva: primero fin > inicio (VALIDACION), después fin futura', async () => {
    const { token, unidadId } = await preparar();
    // Fin anterior al inicio y además pasada: manda la regla existente.
    const r = await crear(token, unidadId, {
      fecha_inicio: enDias(10),
      fecha_fin: enDias(-5),
    });
    expect(r.status).toBe(MALA_PETICION);
    expect(codigoError(r)).toBe('VALIDACION');
  }, 60000);

  it('el día de hoy es el de Bogotá: a las 22:00 del 30/09 (03:00 UTC del 01/10) el 30/09 ya no vale y el 01/10 sí', async () => {
    const { token, unidadId } = await preparar();
    jest.useFakeTimers({
      now: new Date('2026-10-01T03:00:00.000Z'),
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

    const hoyBogota = await crear(token, unidadId, {
      fecha_inicio: '2026-09-01',
      fecha_fin: '2026-09-30',
    });
    expect(hoyBogota.status).toBe(MALA_PETICION);
    expect(codigoError(hoyBogota)).toBe('FECHA_FIN_PASADA');

    const manana = await crear(token, unidadId, {
      fecha_inicio: '2026-09-01',
      fecha_fin: '2026-10-01',
    });
    expect(manana.status).toBe(CREADO);
  }, 120000);

  // ------------------------------------------------------------------
  // PATCH /contratos/:id
  // ------------------------------------------------------------------
  async function contratoConFinPasado() {
    const { token, unidadId } = await preparar();
    const creado = await crear(token, unidadId, {
      fecha_inicio: enDias(-400),
      fecha_fin: enDias(30),
    }).expect(CREADO);
    const id = (creado.body as { id: string }).id;
    // Un contrato que quedó con fin pasado (p. ej. anterior a esta regla).
    await prisma.contrato.update({
      where: { id },
      data: { fecha_fin: new Date(`${enDias(-2)}T00:00:00Z`) },
    });
    return { token, unidadId, id };
  }

  it('PATCH con fecha_fin = hoy o anterior es 400 FECHA_FIN_PASADA sin cambios; con mañana funciona', async () => {
    const { token, unidadId } = await preparar();
    const creado = await crear(token, unidadId, {
      fecha_inicio: enDias(-30),
      fecha_fin: enDias(200),
    }).expect(CREADO);
    const id = (creado.body as { id: string }).id;
    const antes = await prisma.contrato.findUniqueOrThrow({ where: { id } });

    for (const fin of [enDias(0), enDias(-1)]) {
      const r = await corregir(token, id, { fecha_fin: fin });
      expect([fin, r.status, codigoError(r)]).toEqual([
        fin,
        MALA_PETICION,
        'FECHA_FIN_PASADA',
      ]);
      expect((r.body as CuerpoError).mensaje).toBe(MENSAJE);
    }
    expect(await prisma.contrato.findUniqueOrThrow({ where: { id } })).toEqual(
      antes,
    );

    const ok = await corregir(token, id, { fecha_fin: enDias(1) }).expect(OK);
    expect((ok.body as { fecha_fin: string }).fecha_fin.slice(0, 10)).toBe(
      enDias(1),
    );
  }, 180000);

  it('PATCH que solo cambia otros campos no falla por la regla aunque el contrato ya tenga fecha_fin pasada', async () => {
    const { token, id } = await contratoConFinPasado();

    const r = await corregir(token, id, { canon_centavos: 1234500 }).expect(OK);

    expect((r.body as { canon_centavos: number }).canon_centavos).toBe(1234500);
  }, 180000);

  it('PATCH que envía fecha_inicio valida la fecha_fin resultante: con fin pasada falla, con fin futura funciona', async () => {
    const pasado = await contratoConFinPasado();
    const fallo = await corregir(pasado.token, pasado.id, {
      fecha_inicio: enDias(-500),
    });
    expect(fallo.status).toBe(MALA_PETICION);
    expect(codigoError(fallo)).toBe('FECHA_FIN_PASADA');

    const { token, unidadId } = await preparar();
    const creado = await crear(token, unidadId, {
      fecha_inicio: enDias(-30),
      fecha_fin: enDias(200),
    }).expect(CREADO);
    const id = (creado.body as { id: string }).id;
    await corregir(token, id, { fecha_inicio: enDias(-31) }).expect(OK);
  }, 180000);

  it('el orden en el PATCH se conserva: fin <= inicio sigue siendo VALIDACION antes que fecha pasada', async () => {
    const { token, unidadId } = await preparar();
    const creado = await crear(token, unidadId, {
      fecha_inicio: enDias(-30),
      fecha_fin: enDias(200),
    }).expect(CREADO);
    const id = (creado.body as { id: string }).id;

    const r = await corregir(token, id, {
      fecha_inicio: enDias(10),
      fecha_fin: enDias(-5),
    });

    expect(r.status).toBe(MALA_PETICION);
    expect(codigoError(r)).toBe('VALIDACION');
  }, 120000);
});
