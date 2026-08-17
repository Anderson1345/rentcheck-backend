import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TipoPlantillaContrato } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { limpiarBd } from './helpers/limpiar-bd';

interface RespuestaAutenticacion {
  access_token: string;
  arrendador: { id: string };
}

interface RespuestaCrearInmueble {
  id: string;
  unidades: Array<{ id: string; nombre: string }>;
}

interface RespuestaCrearInquilino {
  id: string;
}

interface RespuestaCrearContrato {
  id: string;
  canon_centavos: number;
  deposito_centavos: number;
  dia_pago: number;
  estado: string;
  fecha_inicio: string;
  fecha_fin: string;
  codigo_acceso: { codigo: string } | null;
  unidad: { id: string };
  inquilino: { id: string };
}

interface RespuestaRenovarContrato {
  contrato: { canon_centavos: number; fecha_fin: string };
  incremento_ipc: {
    canon_anterior_centavos: number;
    canon_nuevo_centavos: number;
    porcentaje_ipc_aplicado: number | string;
  };
}

interface ContratoListado {
  id: string;
}

function contratoValido(
  unidadId: string,
  inquilinoId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    unidad_id: unidadId,
    inquilino_id: inquilinoId,
    tipo_plantilla: TipoPlantillaContrato.VIVIENDA_URBANA_LEY_820,
    canon_centavos: 1000000,
    dia_pago: 5,
    forma_pago: 'Transferencia bancaria',
    deposito_centavos: 500000,
    datos_recaudo: 'Bancolombia ahorros 123456789',
    fecha_inicio: '2026-01-10',
    fecha_fin: '2026-12-31',
    ...overrides,
  };
}

async function registrarArrendador(
  app: INestApplication<App>,
  nombre: string,
  correo: string,
): Promise<RespuestaAutenticacion> {
  const respuesta = await request(app.getHttpServer())
    .post('/auth/arrendador/registro')
    .send({
      nombre,
      correo,
      telefono: '3001234567',
      contrasena: 'clave123',
    })
    .expect(HttpStatus.CREATED);
  return respuesta.body as RespuestaAutenticacion;
}

async function crearInmueble(
  app: INestApplication<App>,
  token: string,
  matricula = 'ABC-123456',
): Promise<RespuestaCrearInmueble> {
  const respuesta = await request(app.getHttpServer())
    .post('/inmuebles')
    .set('Authorization', `Bearer ${token}`)
    .send({
      direccion: 'Calle 123 # 45-67',
      ciudad: 'Bogota',
      estrato: 3,
      matricula_inmobiliaria: matricula,
    })
    .expect(HttpStatus.CREATED);
  return respuesta.body as RespuestaCrearInmueble;
}

async function crearInquilino(
  app: INestApplication<App>,
  token: string,
): Promise<RespuestaCrearInquilino> {
  const respuesta = await request(app.getHttpServer())
    .post('/inquilinos')
    .set('Authorization', `Bearer ${token}`)
    .send({
      nombre: 'Inquilino Prueba',
      cedula: '1234567890',
      telefono: '3009876543',
    })
    .expect(HttpStatus.CREATED);
  return respuesta.body as RespuestaCrearInquilino;
}

async function crearContrato(
  app: INestApplication<App>,
  token: string,
  unidadId: string,
  inquilinoId: string,
  overrides: Record<string, unknown> = {},
): Promise<RespuestaCrearContrato> {
  const respuesta = await request(app.getHttpServer())
    .post('/contratos')
    .set('Authorization', `Bearer ${token}`)
    .send(contratoValido(unidadId, inquilinoId, overrides))
    .expect(HttpStatus.CREATED);
  return respuesta.body as RespuestaCrearContrato;
}

describe('ContratoController (e2e)', () => {
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

  it('crea un contrato activo con su código de acceso', async () => {
    const { access_token } = await registrarArrendador(
      app,
      'Arrendador A',
      'feliz@correo.com',
    );
    const inmueble = await crearInmueble(app, access_token);
    const inquilino = await crearInquilino(app, access_token);

    const contrato = await crearContrato(
      app,
      access_token,
      inmueble.unidades[0].id,
      inquilino.id,
    );

    expect(contrato.canon_centavos).toBe(1000000);
    expect(contrato.deposito_centavos).toBe(500000);
    expect(contrato.dia_pago).toBe(5);
    expect(contrato.estado).toBe('ACTIVO');
    expect(contrato.codigo_acceso?.codigo).toMatch(/^RC-\d{4}-[A-Z0-9]{4}$/);
    expect(contrato.unidad.id).toBe(inmueble.unidades[0].id);
    expect(contrato.inquilino.id).toBe(inquilino.id);
    expect(contrato.fecha_inicio).toContain('2026-01-10');
    expect(contrato.fecha_fin).toContain('2026-12-31');
  });

  it('rechaza con 400 cuando fecha_fin no es posterior a fecha_inicio', async () => {
    const { access_token } = await registrarArrendador(
      app,
      'Arrendador A',
      'fechas@correo.com',
    );
    const inmueble = await crearInmueble(app, access_token);
    const inquilino = await crearInquilino(app, access_token);

    await request(app.getHttpServer())
      .post('/contratos')
      .set('Authorization', `Bearer ${access_token}`)
      .send(
        contratoValido(inmueble.unidades[0].id, inquilino.id, {
          fecha_inicio: '2026-12-31',
          fecha_fin: '2026-01-10',
        }),
      )
      .expect(HttpStatus.BAD_REQUEST);
  });

  it('rechaza con 400 cánones o depósitos no positivos', async () => {
    const { access_token } = await registrarArrendador(
      app,
      'Arrendador A',
      'montos@correo.com',
    );
    const inmueble = await crearInmueble(app, access_token);
    const inquilino = await crearInquilino(app, access_token);

    await request(app.getHttpServer())
      .post('/contratos')
      .set('Authorization', `Bearer ${access_token}`)
      .send(
        contratoValido(inmueble.unidades[0].id, inquilino.id, {
          canon_centavos: 0,
        }),
      )
      .expect(HttpStatus.BAD_REQUEST);

    await request(app.getHttpServer())
      .post('/contratos')
      .set('Authorization', `Bearer ${access_token}`)
      .send(
        contratoValido(inmueble.unidades[0].id, inquilino.id, {
          deposito_centavos: -1,
        }),
      )
      .expect(HttpStatus.BAD_REQUEST);
  });

  it('no permite a otro arrendador ver o usar el contrato', async () => {
    const arrendadorA = await registrarArrendador(
      app,
      'Arrendador A',
      'aislamiento-a@correo.com',
    );
    const arrendadorB = await registrarArrendador(
      app,
      'Arrendador B',
      'aislamiento-b@correo.com',
    );

    const inmuebleA = await crearInmueble(app, arrendadorA.access_token);
    const inquilinoA = await crearInquilino(app, arrendadorA.access_token);
    const contrato = await crearContrato(
      app,
      arrendadorA.access_token,
      inmuebleA.unidades[0].id,
      inquilinoA.id,
    );
    const inquilinoB = await crearInquilino(app, arrendadorB.access_token);

    await request(app.getHttpServer())
      .get(`/contratos/${contrato.id}`)
      .set('Authorization', `Bearer ${arrendadorB.access_token}`)
      .expect(HttpStatus.NOT_FOUND);

    await request(app.getHttpServer())
      .post(`/contratos/${contrato.id}/renovar`)
      .set('Authorization', `Bearer ${arrendadorB.access_token}`)
      .expect(HttpStatus.NOT_FOUND);

    await request(app.getHttpServer())
      .post('/contratos')
      .set('Authorization', `Bearer ${arrendadorB.access_token}`)
      .send(contratoValido(inmuebleA.unidades[0].id, inquilinoB.id))
      .expect(HttpStatus.NOT_FOUND);
  });

  it('lista solo los contratos del arrendador autenticado', async () => {
    const arrendadorA = await registrarArrendador(
      app,
      'Arrendador A',
      'listado-a@correo.com',
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

    const arrendadorB = await registrarArrendador(
      app,
      'Arrendador B',
      'listado-b@correo.com',
    );
    const inmuebleB = await crearInmueble(
      app,
      arrendadorB.access_token,
      'ABC-112233',
    );
    const inquilinoB = await crearInquilino(app, arrendadorB.access_token);
    await crearContrato(
      app,
      arrendadorB.access_token,
      inmuebleB.unidades[0].id,
      inquilinoB.id,
    );

    const respuesta = await request(app.getHttpServer())
      .get('/contratos')
      .set('Authorization', `Bearer ${arrendadorA.access_token}`)
      .expect(HttpStatus.OK);

    const ids = (respuesta.body as ContratoListado[]).map(
      (contrato) => contrato.id,
    );
    expect(ids).toHaveLength(2);
    expect(ids).toEqual(expect.arrayContaining([contratoA1.id, contratoA2.id]));
  });

  it('renueva un contrato activo aplicando el IPC configurado', async () => {
    const { access_token } = await registrarArrendador(
      app,
      'Arrendador A',
      'ipc@correo.com',
    );
    const inmueble = await crearInmueble(app, access_token);
    const inquilino = await crearInquilino(app, access_token);
    const contrato = await crearContrato(
      app,
      access_token,
      inmueble.unidades[0].id,
      inquilino.id,
    );

    await prisma.configuracionIpc.create({
      data: { porcentaje: 10, anio: new Date().getFullYear() },
    });

    const respuesta = await request(app.getHttpServer())
      .post(`/contratos/${contrato.id}/renovar`)
      .set('Authorization', `Bearer ${access_token}`)
      .expect(HttpStatus.CREATED);

    const resultado = respuesta.body as RespuestaRenovarContrato;
    expect(resultado.contrato.canon_centavos).toBe(1100000);
    expect(resultado.contrato.fecha_fin).toContain('2027-12-31');
    expect(resultado.incremento_ipc.canon_anterior_centavos).toBe(1000000);
    expect(resultado.incremento_ipc.canon_nuevo_centavos).toBe(1100000);
    expect(String(resultado.incremento_ipc.porcentaje_ipc_aplicado)).toBe('10');
  });

  it('rechaza con 409 un segundo contrato activo en la misma unidad', async () => {
    const { access_token } = await registrarArrendador(
      app,
      'Arrendador A',
      'duplicado@correo.com',
    );
    const inmueble = await crearInmueble(app, access_token);
    const inquilino = await crearInquilino(app, access_token);

    await crearContrato(
      app,
      access_token,
      inmueble.unidades[0].id,
      inquilino.id,
    );

    await request(app.getHttpServer())
      .post('/contratos')
      .set('Authorization', `Bearer ${access_token}`)
      .send(contratoValido(inmueble.unidades[0].id, inquilino.id))
      .expect(HttpStatus.CONFLICT);
  });
});
