import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/configurar-app';
import { VinculacionContratoService } from '../src/contrato/vinculacion-contrato.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  contratoValido,
  crearInmueble,
  registrarArrendador,
} from './helpers/crear-datos.helper';
import { limpiarBd } from './helpers/limpiar-bd';

describe('completar-registro: cuenta y vínculo en una sola transacción (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let vinculacion: VinculacionContratoService;

  beforeEach(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await limpiarBd(prisma);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configurarApp(app);
    vinculacion = moduleFixture.get(VinculacionContratoService);
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

  it('si el vínculo falla después de crear la cuenta, no queda cuenta ni vínculo', async () => {
    const { access_token } = await registrarArrendador(
      app,
      'Arrendador Tx',
      'tx-vinc@correo.com',
    );
    const inmueble = await crearInmueble(app, access_token, 'TX-1');
    const contrato = (
      await request(app.getHttpServer())
        .post('/contratos')
        .set('Authorization', `Bearer ${access_token}`)
        .send({
          ...contratoValido(inmueble.unidades[0].id, 'x'),
          inquilino_id: undefined,
          inquilino_nuevo: {
            nombre: 'Transacción',
            cedula: `5${Date.now().toString().slice(-8)}`,
            telefono: '3004',
          },
        })
        .expect(HttpStatus.CREATED)
    ).body as {
      id: string;
      inquilino: { id: string };
      codigo_acceso: { codigo: string };
    };
    jest
      .spyOn(vinculacion, 'vincularEnTransaccion')
      .mockRejectedValue(new Error('falla simulada al vincular'));

    const respuesta = await request(app.getHttpServer())
      .post('/auth/inquilino/completar-registro')
      .send({
        codigo: contrato.codigo_acceso.codigo,
        correo: 'tx@correo.com',
        contrasena: 'clave1234',
      });

    expect(respuesta.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    const inquilino = await prisma.inquilino.findUniqueOrThrow({
      where: { id: contrato.inquilino.id },
    });
    expect(inquilino.correo).toBeNull();
    expect(inquilino.contrasena_hash).toBeNull();
    expect(
      (await prisma.contrato.findUniqueOrThrow({ where: { id: contrato.id } }))
        .vinculado_en,
    ).toBeNull();
  }, 90000);
});
