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
  crearInquilino,
  registrarArrendador,
} from './helpers/crear-datos.helper';
import { enDias } from './helpers/fechas.helper';
import { limpiarBd } from './helpers/limpiar-bd';

const OK: number = HttpStatus.OK;
const CREADO: number = HttpStatus.CREATED;
const MALA_PETICION: number = HttpStatus.BAD_REQUEST;
const NO_ENCONTRADO: number = HttpStatus.NOT_FOUND;
const CONFLICTO: number = HttpStatus.CONFLICT;

interface CuerpoError {
  codigo?: string;
}

describe('actualizarUnidad con la unidad bloqueada (B-48, e2e)', () => {
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

  async function nuevaUnidad(token: string) {
    contador += 1;
    const inmueble = await crearInmueble(app, token, `BLQ-${contador}`);
    return { inmuebleId: inmueble.id, unidadId: inmueble.unidades[0].id };
  }

  async function arrendador() {
    contador += 1;
    const { access_token, arrendador: datos } = await registrarArrendador(
      app,
      `Arrendador Bloqueo ${contador}`,
      `bloqueo-${contador}@correo.com`,
    );
    return { token: access_token, id: datos.id };
  }

  const patchUnidad = (
    token: string,
    inmuebleId: string,
    unidadId: string,
    cuerpo: object,
  ) =>
    request(app.getHttpServer())
      .patch(`/inmuebles/${inmuebleId}/unidades/${unidadId}`)
      .set('Authorization', `Bearer ${token}`)
      .send(cuerpo);

  const crearContratoApi = (
    token: string,
    unidadId: string,
    inquilinoId: string,
    plantilla = 'VIVIENDA_URBANA_LEY_820',
  ) =>
    request(app.getHttpServer())
      .post('/contratos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        unidad_id: unidadId,
        inquilino_id: inquilinoId,
        tipo_plantilla: plantilla,
        canon_centavos: 1000000,
        dia_pago: 5,
        forma_pago: 'Transferencia',
        datos_recaudo: 'Bancolombia 123',
        fecha_inicio: enDias(-10),
        fecha_fin: enDias(355),
      });

  const codigoError = (r: { body: unknown }) => (r.body as CuerpoError).codigo;

  const PASAR_A_LOCAL = { tipo: 'LOCAL', uso_permitido: 'COMERCIAL' };

  // ------------------------------------------------------------------
  // Comportamiento de siempre (sin cambiar respuestas ni códigos)
  // ------------------------------------------------------------------
  it('conserva las respuestas de hoy: 404 si la unidad no es del arrendador, 409 con contrato activo, 200 sin él', async () => {
    const a = await arrendador();
    const b = await arrendador();
    const { inmuebleId, unidadId } = await nuevaUnidad(a.token);
    const ficha = await crearInquilino(app, a.token);

    // Ajena, inexistente o con inmueble equivocado: 404.
    expect(
      (await patchUnidad(b.token, inmuebleId, unidadId, { nombre: 'X' }))
        .status,
    ).toBe(NO_ENCONTRADO);
    expect(
      (
        await patchUnidad(
          a.token,
          inmuebleId,
          '00000000-0000-4000-8000-000000000000',
          { nombre: 'X' },
        )
      ).status,
    ).toBe(NO_ENCONTRADO);

    // Sin contratos: cambia el tipo.
    const ok = await patchUnidad(
      a.token,
      inmuebleId,
      unidadId,
      PASAR_A_LOCAL,
    ).expect(OK);
    expect(ok.body).toMatchObject({
      tipo: 'LOCAL',
      uso_permitido: 'COMERCIAL',
    });

    // Con contrato activo: 409 UNIDAD_CON_CONTRATO_ACTIVO; un cambio que no es de tipo/uso sí pasa.
    await crearContratoApi(
      a.token,
      unidadId,
      ficha.id,
      'LOCAL_COMERCIAL',
    ).expect(CREADO);
    const conflicto = await patchUnidad(a.token, inmuebleId, unidadId, {
      tipo: 'APARTAMENTO',
      uso_permitido: 'RESIDENCIAL',
    });
    expect(conflicto.status).toBe(CONFLICTO);
    expect(codigoError(conflicto)).toBe('UNIDAD_CON_CONTRATO_ACTIVO');
    await patchUnidad(a.token, inmuebleId, unidadId, {
      nombre: 'Local Uno',
    }).expect(OK);
  }, 180000);

  // ------------------------------------------------------------------
  // B-48, determinista: la actualización espera el bloqueo y ve el contrato
  // ------------------------------------------------------------------
  it('si un contrato se crea justo mientras se actualiza la unidad, el cambio de tipo espera el bloqueo y responde 409 (no lo cuenta antes y escribe después)', async () => {
    const a = await arrendador();
    const { inmuebleId, unidadId } = await nuevaUnidad(a.token);
    const ficha = await crearInquilino(app, a.token);
    let confirmar: () => void = () => undefined;
    const pausa = new Promise<void>((resolver) => {
      confirmar = resolver;
    });

    // Simula `crear()`: bloquea la unidad y crea el contrato ACTIVO, sin confirmar aún.
    const contrato = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Unidad" WHERE id = ${unidadId}::uuid FOR UPDATE`;
        await tx.contrato.create({
          data: {
            arrendador_id: a.id,
            unidad_id: unidadId,
            inquilino_id: ficha.id,
            inquilino_nombre: 'Inquilino Prueba',
            inquilino_cedula: '123456789',
            inquilino_telefono: '3009876543',
            tipo_plantilla: 'VIVIENDA_URBANA_LEY_820',
            canon_centavos: 1000000,
            dia_pago: 5,
            forma_pago: 'Transferencia',
            datos_recaudo: 'Bancolombia 123',
            fecha_inicio: new Date(`${enDias(-10)}T00:00:00Z`),
            fecha_fin: new Date(`${enDias(355)}T00:00:00Z`),
            estado: 'ACTIVO',
          },
        });
        await pausa;
      },
      { timeout: 30000 },
    );
    await new Promise((resolver) => setTimeout(resolver, 500));

    const actualizacion = patchUnidad(
      a.token,
      inmuebleId,
      unidadId,
      PASAR_A_LOCAL,
    ).then((r) => r);
    await new Promise((resolver) => setTimeout(resolver, 1500));
    confirmar();
    await contrato;
    const r = await actualizacion;

    expect(r.status).toBe(CONFLICTO);
    expect(codigoError(r)).toBe('UNIDAD_CON_CONTRATO_ACTIVO');
    const unidad = await prisma.unidad.findUniqueOrThrow({
      where: { id: unidadId },
    });
    expect(unidad.tipo).not.toBe('LOCAL');
  }, 120000);

  it('si el tipo de la unidad cambia justo mientras se crea un contrato, crear() revalida la plantilla con la unidad bloqueada y responde 400', async () => {
    const a = await arrendador();
    const { unidadId } = await nuevaUnidad(a.token);
    const ficha = await crearInquilino(app, a.token);
    let confirmar: () => void = () => undefined;
    const pausa = new Promise<void>((resolver) => {
      confirmar = resolver;
    });

    // Simula `actualizarUnidad`: bloquea la unidad y la pasa a LOCAL comercial, sin confirmar aún.
    const cambio = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Unidad" WHERE id = ${unidadId}::uuid FOR UPDATE`;
        await tx.unidad.update({
          where: { id: unidadId },
          data: { tipo: 'LOCAL', uso_permitido: 'COMERCIAL' },
        });
        await pausa;
      },
      { timeout: 30000 },
    );
    await new Promise((resolver) => setTimeout(resolver, 500));

    // La plantilla de vivienda era válida para el apartamento que `crear()` leyó al empezar.
    const creacion = crearContratoApi(a.token, unidadId, ficha.id).then(
      (r) => r,
    );
    await new Promise((resolver) => setTimeout(resolver, 1500));
    confirmar();
    await cambio;
    const r = await creacion;

    expect(r.status).toBe(MALA_PETICION);
    expect(codigoError(r)).toBe('PLANTILLA_NO_CORRESPONDE_A_UNIDAD');
    expect(
      await prisma.contrato.count({ where: { unidad_id: unidadId } }),
    ).toBe(0);
  }, 120000);

  // ------------------------------------------------------------------
  // B-48, carrera real
  // ------------------------------------------------------------------
  it('actualizar tipo/uso y crear un contrato a la vez nunca deja una unidad con contrato ACTIVO y tipo incompatible', async () => {
    const a = await arrendador();
    const ficha = await crearInquilino(app, a.token);

    for (let intento = 0; intento < 8; intento += 1) {
      const { inmuebleId, unidadId } = await nuevaUnidad(a.token);

      const [actualizacion, creacion] = await Promise.all([
        patchUnidad(a.token, inmuebleId, unidadId, PASAR_A_LOCAL),
        crearContratoApi(a.token, unidadId, ficha.id),
      ]);

      const unidad = await prisma.unidad.findUniqueOrThrow({
        where: { id: unidadId },
      });
      const contratos = await prisma.contrato.findMany({
        where: { unidad_id: unidadId },
      });
      if (actualizacion.status === OK) {
        // Ganó el cambio de tipo: el contrato de vivienda ya no corresponde.
        expect(creacion.status).toBe(MALA_PETICION);
        expect(codigoError(creacion)).toBe('PLANTILLA_NO_CORRESPONDE_A_UNIDAD');
        expect(contratos).toHaveLength(0);
        expect(unidad.tipo).toBe('LOCAL');
      } else {
        // Ganó el contrato: el cambio de tipo no se aplica.
        expect(actualizacion.status).toBe(CONFLICTO);
        expect(codigoError(actualizacion)).toBe('UNIDAD_CON_CONTRATO_ACTIVO');
        expect(creacion.status).toBe(CREADO);
        expect(contratos).toHaveLength(1);
        expect(unidad.tipo).not.toBe('LOCAL');
      }
      // Invariante: toda unidad con contrato activo tiene su tipo compatible con la plantilla.
      for (const contrato of contratos) {
        expect(contrato.tipo_plantilla).toBe(
          unidad.uso_permitido === 'RESIDENCIAL' &&
            unidad.tipo !== 'PARQUEADERO'
            ? 'VIVIENDA_URBANA_LEY_820'
            : unidad.tipo === 'PARQUEADERO'
              ? 'PARQUEADERO'
              : 'LOCAL_COMERCIAL',
        );
      }
    }
  }, 300000);
});
