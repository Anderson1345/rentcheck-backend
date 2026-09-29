import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TipoPlantillaContrato } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/configurar-app';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  contratoValido,
  crearContrato,
  crearInmueble,
  crearInquilino,
  registrarArrendador,
} from './helpers/crear-datos.helper';
import { limpiarBd } from './helpers/limpiar-bd';

interface CuerpoError {
  codigo: string;
  detalles?: unknown;
}

interface InmuebleRespuesta {
  id: string;
  estrato: number | null;
  unidades: Array<{
    id: string;
    tipo: string;
    uso_permitido: string;
    metros_cuadrados: string | null;
    numero_habitaciones: number | null;
    numero_banos: number | null;
    ocupantes_maximos: number | null;
  }>;
}

const UNIDAD_RESIDENCIAL_COMPLETA = {
  nombre: 'Apto 201',
  tipo: 'APARTAMENTO',
  metros_cuadrados: 60,
  numero_habitaciones: 2,
  numero_banos: 1,
  canon_base_centavos: 100_000_000,
  ocupantes_maximos: 3,
  acepta_mascotas: true,
  uso_permitido: 'RESIDENCIAL',
};

const UNIDAD_COMERCIAL_MINIMA = {
  nombre: 'Local 1',
  tipo: 'LOCAL',
  canon_base_centavos: 200_000_000,
  acepta_mascotas: false,
  uso_permitido: 'COMERCIAL',
};

describe('Reglas de creación (e2e)', () => {
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
    configurarApp(app);
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

  async function crearInmuebleComercial(token: string, matricula: string) {
    const respuesta = await request(app.getHttpServer())
      .post('/inmuebles')
      .set('Authorization', `Bearer ${token}`)
      .send({
        direccion: 'Carrera 7 # 10-20',
        ciudad: 'Bogota',
        matricula_inmobiliaria: matricula,
        uso_unidad_principal: 'COMERCIAL',
      })
      .expect(HttpStatus.CREATED);
    return respuesta.body as InmuebleRespuesta;
  }

  function postContrato(token: string, cuerpo: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post('/contratos')
      .set('Authorization', `Bearer ${token}`)
      .send(cuerpo);
  }

  // ------------------------------------------------------------------
  // B-08: depósito condicional
  // ------------------------------------------------------------------
  describe('B-08 depósito', () => {
    it('vivienda con depósito > 0 responde 400 DEPOSITO_NO_PERMITIDO_VIVIENDA y no crea nada', async () => {
      const { access_token } = await registrarArrendador(
        app,
        'Arr Dep',
        'dep-a@correo.com',
      );
      const inmueble = await crearInmueble(app, access_token);
      const inquilino = await crearInquilino(app, access_token);

      const respuesta = await postContrato(
        access_token,
        contratoValido(inmueble.unidades[0].id, inquilino.id, {
          deposito_centavos: 500_000,
        }),
      ).expect(HttpStatus.BAD_REQUEST);

      expect((respuesta.body as CuerpoError).codigo).toBe(
        'DEPOSITO_NO_PERMITIDO_VIVIENDA',
      );
      expect(await prisma.contrato.count()).toBe(0);
    });

    it('vivienda sin depósito y con depósito 0 se crean con deposito null', async () => {
      const { access_token } = await registrarArrendador(
        app,
        'Arr Dep',
        'dep-b@correo.com',
      );
      const inmueble1 = await crearInmueble(app, access_token, 'DEP-1');
      const inmueble2 = await crearInmueble(app, access_token, 'DEP-2');
      const inquilino = await crearInquilino(app, access_token);

      const sinDeposito = await crearContrato(
        app,
        access_token,
        inmueble1.unidades[0].id,
        inquilino.id,
      );
      const conCero = await crearContrato(
        app,
        access_token,
        inmueble2.unidades[0].id,
        inquilino.id,
        { deposito_centavos: 0 },
      );

      expect(sinDeposito.deposito_centavos).toBeNull();
      expect(conCero.deposito_centavos).toBeNull();
      const guardados = await prisma.contrato.findMany();
      expect(guardados.every((c) => c.deposito_centavos === null)).toBe(true);
    });

    it('local con depósito se crea con el depósito guardado', async () => {
      const { access_token } = await registrarArrendador(
        app,
        'Arr Dep',
        'dep-c@correo.com',
      );
      const local = await crearInmuebleComercial(access_token, 'DEP-LOCAL');
      const inquilino = await crearInquilino(app, access_token);

      const respuesta = await postContrato(
        access_token,
        contratoValido(local.unidades[0].id, inquilino.id, {
          tipo_plantilla: TipoPlantillaContrato.LOCAL_COMERCIAL,
          deposito_centavos: 300_000_000,
        }),
      ).expect(HttpStatus.CREATED);

      expect(
        (respuesta.body as { deposito_centavos: number }).deposito_centavos,
      ).toBe(300_000_000);
    });
  });

  // ------------------------------------------------------------------
  // B-16: cédula del arrendador
  // ------------------------------------------------------------------
  describe('B-16 cédula del arrendador', () => {
    it('sin cédula responde 409 CEDULA_ARRENDADOR_REQUERIDA y no deja registros; con cédula crea', async () => {
      const { access_token } = await registrarArrendador(
        app,
        'Arr Sin Cedula',
        'sin-cedula@correo.com',
        false,
      );
      const inmueble = await crearInmueble(app, access_token);
      const inquilino = await crearInquilino(app, access_token);
      const cuerpo = contratoValido(inmueble.unidades[0].id, inquilino.id);

      const rechazado = await postContrato(access_token, cuerpo).expect(
        HttpStatus.CONFLICT,
      );
      expect((rechazado.body as CuerpoError).codigo).toBe(
        'CEDULA_ARRENDADOR_REQUERIDA',
      );
      expect(await prisma.contrato.count()).toBe(0);
      expect(await prisma.codigoAcceso.count()).toBe(0);

      await request(app.getHttpServer())
        .patch('/arrendadores/perfil')
        .set('Authorization', `Bearer ${access_token}`)
        .send({ cedula: '52123456' })
        .expect(HttpStatus.OK);

      await postContrato(access_token, cuerpo).expect(HttpStatus.CREATED);
      expect(await prisma.contrato.count()).toBe(1);
    });
  });

  // ------------------------------------------------------------------
  // B-26 / B-43: inmueble y unidad
  // ------------------------------------------------------------------
  describe('B-26 y B-43 validación condicional', () => {
    it('inmueble residencial sin estrato responde 400 ESTRATO_REQUERIDO', async () => {
      const { access_token } = await registrarArrendador(
        app,
        'Arr Est',
        'est-a@correo.com',
      );

      const respuesta = await request(app.getHttpServer())
        .post('/inmuebles')
        .set('Authorization', `Bearer ${access_token}`)
        .send({
          direccion: 'Calle 1',
          ciudad: 'Bogota',
          matricula_inmobiliaria: 'EST-1',
        })
        .expect(HttpStatus.BAD_REQUEST);

      expect((respuesta.body as CuerpoError).codigo).toBe('ESTRATO_REQUERIDO');
      expect(await prisma.inmueble.count()).toBe(0);
    });

    it('inmueble comercial sin estrato se crea con una unidad principal LOCAL con nulos', async () => {
      const { access_token } = await registrarArrendador(
        app,
        'Arr Est',
        'est-b@correo.com',
      );

      const inmueble = await crearInmuebleComercial(access_token, 'EST-C');

      expect(inmueble.estrato).toBeNull();
      expect(inmueble.unidades).toHaveLength(1);
      expect(inmueble.unidades[0]).toMatchObject({
        tipo: 'LOCAL',
        uso_permitido: 'COMERCIAL',
        metros_cuadrados: null,
        numero_habitaciones: null,
        numero_banos: null,
        ocupantes_maximos: null,
      });
    });

    it('la unidad principal residencial automática tiene nulos y se puede editar', async () => {
      const { access_token } = await registrarArrendador(
        app,
        'Arr Est',
        'est-c@correo.com',
      );
      const inmueble = await crearInmueble(app, access_token);
      const unidadId = inmueble.unidades[0].id;
      const ruta = `/inmuebles/${inmueble.id}/unidades/${unidadId}`;

      const enBd = await prisma.unidad.findUniqueOrThrow({
        where: { id: unidadId },
      });
      expect(enBd.metros_cuadrados).toBeNull();
      expect(enBd.numero_habitaciones).toBeNull();
      expect(enBd.numero_banos).toBeNull();
      expect(enBd.ocupantes_maximos).toBeNull();
      expect(enBd.tipo).toBe('APARTAMENTO');

      await request(app.getHttpServer())
        .patch(ruta)
        .set('Authorization', `Bearer ${access_token}`)
        .send({ nombre: 'Apto renombrado' })
        .expect(HttpStatus.OK);

      await request(app.getHttpServer())
        .patch(ruta)
        .set('Authorization', `Bearer ${access_token}`)
        .send({ metros_cuadrados: 55, ocupantes_maximos: 4 })
        .expect(HttpStatus.OK);

      const invalido = await request(app.getHttpServer())
        .patch(ruta)
        .set('Authorization', `Bearer ${access_token}`)
        .send({ ocupantes_maximos: 0 })
        .expect(HttpStatus.BAD_REQUEST);
      expect((invalido.body as CuerpoError).codigo).toBe(
        'CAMPOS_RESIDENCIALES_REQUERIDOS',
      );
    });

    it('unidad comercial sin campos residenciales se crea; residencial sin ellos responde 400', async () => {
      const { access_token } = await registrarArrendador(
        app,
        'Arr Uni',
        'uni-a@correo.com',
      );
      const inmueble = await crearInmueble(app, access_token);
      const ruta = `/inmuebles/${inmueble.id}/unidades`;

      await request(app.getHttpServer())
        .post(ruta)
        .set('Authorization', `Bearer ${access_token}`)
        .send(UNIDAD_COMERCIAL_MINIMA)
        .expect(HttpStatus.CREATED);

      const sinCampos = await request(app.getHttpServer())
        .post(ruta)
        .set('Authorization', `Bearer ${access_token}`)
        .send({
          nombre: 'Apto incompleto',
          tipo: 'APARTAMENTO',
          canon_base_centavos: 1,
          acepta_mascotas: false,
          uso_permitido: 'RESIDENCIAL',
        })
        .expect(HttpStatus.BAD_REQUEST);
      const cuerpo = sinCampos.body as CuerpoError;
      expect(cuerpo.codigo).toBe('CAMPOS_RESIDENCIALES_REQUERIDOS');
      expect(Array.isArray(cuerpo.detalles)).toBe(true);

      await request(app.getHttpServer())
        .post(ruta)
        .set('Authorization', `Bearer ${access_token}`)
        .send(UNIDAD_RESIDENCIAL_COMPLETA)
        .expect(HttpStatus.CREATED);
    });

    it('unidad residencial en un inmueble sin estrato responde 400 ESTRATO_REQUERIDO', async () => {
      const { access_token } = await registrarArrendador(
        app,
        'Arr Uni',
        'uni-b@correo.com',
      );
      const comercial = await crearInmuebleComercial(access_token, 'UNI-C');

      const respuesta = await request(app.getHttpServer())
        .post(`/inmuebles/${comercial.id}/unidades`)
        .set('Authorization', `Bearer ${access_token}`)
        .send(UNIDAD_RESIDENCIAL_COMPLETA)
        .expect(HttpStatus.BAD_REQUEST);

      expect((respuesta.body as CuerpoError).codigo).toBe('ESTRATO_REQUERIDO');
    });

    it('quitar el estrato de un inmueble con unidades residenciales responde 400 ESTRATO_REQUERIDO', async () => {
      const { access_token } = await registrarArrendador(
        app,
        'Arr Uni',
        'uni-c@correo.com',
      );
      const inmueble = await crearInmueble(app, access_token);

      const respuesta = await request(app.getHttpServer())
        .patch(`/inmuebles/${inmueble.id}`)
        .set('Authorization', `Bearer ${access_token}`)
        .send({ estrato: null })
        .expect(HttpStatus.BAD_REQUEST);

      expect((respuesta.body as CuerpoError).codigo).toBe('ESTRATO_REQUERIDO');
      const enBd = await prisma.inmueble.findUniqueOrThrow({
        where: { id: inmueble.id },
      });
      expect(enBd.estrato).toBe(3);
    });

    it('con contrato ACTIVO no se puede cambiar tipo ni uso (409); mismo valor y otros campos sí; sin contrato sí', async () => {
      const { access_token } = await registrarArrendador(
        app,
        'Arr Cambio',
        'cambio@correo.com',
      );
      const inmueble = await crearInmueble(app, access_token);
      const inquilino = await crearInquilino(app, access_token);
      await crearContrato(
        app,
        access_token,
        inmueble.unidades[0].id,
        inquilino.id,
      );
      const rutaOcupada = `/inmuebles/${inmueble.id}/unidades/${inmueble.unidades[0].id}`;

      for (const cambio of [{ tipo: 'CASA' }, { uso_permitido: 'COMERCIAL' }]) {
        const respuesta = await request(app.getHttpServer())
          .patch(rutaOcupada)
          .set('Authorization', `Bearer ${access_token}`)
          .send(cambio)
          .expect(HttpStatus.CONFLICT);
        expect((respuesta.body as CuerpoError).codigo).toBe(
          'UNIDAD_CON_CONTRATO_ACTIVO',
        );
      }

      await request(app.getHttpServer())
        .patch(rutaOcupada)
        .set('Authorization', `Bearer ${access_token}`)
        .send({
          tipo: 'APARTAMENTO',
          uso_permitido: 'RESIDENCIAL',
          nombre: 'X',
        })
        .expect(HttpStatus.OK);

      const libre = await request(app.getHttpServer())
        .post(`/inmuebles/${inmueble.id}/unidades`)
        .set('Authorization', `Bearer ${access_token}`)
        .send(UNIDAD_RESIDENCIAL_COMPLETA)
        .expect(HttpStatus.CREATED);
      await request(app.getHttpServer())
        .patch(
          `/inmuebles/${inmueble.id}/unidades/${(libre.body as { id: string }).id}`,
        )
        .set('Authorization', `Bearer ${access_token}`)
        .send({ tipo: 'CASA', uso_permitido: 'COMERCIAL' })
        .expect(HttpStatus.OK);
    });

    it('cambiar a RESIDENCIAL exige los campos residenciales', async () => {
      const { access_token } = await registrarArrendador(
        app,
        'Arr Cambio',
        'cambio-b@correo.com',
      );
      const inmueble = await crearInmueble(app, access_token);
      const comercial = await request(app.getHttpServer())
        .post(`/inmuebles/${inmueble.id}/unidades`)
        .set('Authorization', `Bearer ${access_token}`)
        .send(UNIDAD_COMERCIAL_MINIMA)
        .expect(HttpStatus.CREATED);
      const ruta = `/inmuebles/${inmueble.id}/unidades/${(comercial.body as { id: string }).id}`;

      const respuesta = await request(app.getHttpServer())
        .patch(ruta)
        .set('Authorization', `Bearer ${access_token}`)
        .send({ uso_permitido: 'RESIDENCIAL' })
        .expect(HttpStatus.BAD_REQUEST);
      expect((respuesta.body as CuerpoError).codigo).toBe(
        'CAMPOS_RESIDENCIALES_REQUERIDOS',
      );

      await request(app.getHttpServer())
        .patch(ruta)
        .set('Authorization', `Bearer ${access_token}`)
        .send({
          uso_permitido: 'RESIDENCIAL',
          metros_cuadrados: 40,
          numero_habitaciones: 1,
          numero_banos: 1,
          ocupantes_maximos: 2,
        })
        .expect(HttpStatus.OK);
    });

    it('una unidad o inmueble ajeno responde 404', async () => {
      const dueno = await registrarArrendador(app, 'Dueño', 'dueno@correo.com');
      const otro = await registrarArrendador(app, 'Otro', 'otro@correo.com');
      const inmueble = await crearInmueble(app, dueno.access_token);

      await request(app.getHttpServer())
        .patch(`/inmuebles/${inmueble.id}/unidades/${inmueble.unidades[0].id}`)
        .set('Authorization', `Bearer ${otro.access_token}`)
        .send({ tipo: 'CASA' })
        .expect(HttpStatus.NOT_FOUND);
    });
  });

  // ------------------------------------------------------------------
  // IPC: un solo registro por año
  // ------------------------------------------------------------------
  it('ConfiguracionIpc rechaza dos filas del mismo año', async () => {
    await prisma.configuracionIpc.create({
      data: { anio: 2025, porcentaje: 5.1 },
    });

    await expect(
      prisma.configuracionIpc.create({ data: { anio: 2025, porcentaje: 9.9 } }),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(await prisma.configuracionIpc.count()).toBe(1);
  });
});
