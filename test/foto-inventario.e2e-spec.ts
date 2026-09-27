import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
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
} from './helpers/crear-datos.helper';
import { limpiarBd } from './helpers/limpiar-bd';

interface FotoInventarioCreada {
  id: string;
  momento: string;
  zona: string;
  foto_url: string;
}

interface FotoInventarioListada {
  id: string;
  momento: string;
  zona: string;
  foto_url: string;
}

const URL_FIRMADA = /^https:\/\/.*\.supabase\.co\/storage\/v1\/object\/sign\//;

describe('FotoInventario (e2e)', () => {
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

  async function prepararContrato() {
    const { access_token } = await registrarArrendador(
      app,
      'Arrendador Fotos',
      'fotos@correo.com',
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
      'inquilino-fotos@correo.com',
    );
    return { access_token, contrato, inquilinoToken };
  }

  async function subirFoto(
    token: string,
    contratoId: string,
    momento = 'ENTREGA',
    zona = 'Cocina',
  ): Promise<FotoInventarioCreada> {
    const respuesta = await request(app.getHttpServer())
      .post(`/contratos/${contratoId}/fotos-inventario`)
      .set('Authorization', `Bearer ${token}`)
      .field('momento', momento)
      .field('zona', zona)
      .attach('foto', Buffer.from('foto de prueba jpeg'), {
        filename: 'cocina.jpg',
        contentType: 'image/jpeg',
      })
      .expect(HttpStatus.CREATED);
    return respuesta.body as FotoInventarioCreada;
  }

  it('sube una foto de inventario a Supabase y expone foto_url firmada', async () => {
    const { access_token, contrato } = await prepararContrato();

    const foto = await subirFoto(access_token, contrato.id);

    expect(foto.id).toBeTruthy();
    expect(foto.momento).toBe('ENTREGA');
    expect(foto.zona).toBe('Cocina');
    expect(foto.foto_url).toMatch(URL_FIRMADA);
    expect(
      (foto as unknown as Record<string, unknown>).foto_ruta,
    ).toBeUndefined();
  });

  it('rechaza con 415 una foto con tipo de archivo no permitido', async () => {
    const { access_token, contrato } = await prepararContrato();

    await request(app.getHttpServer())
      .post(`/contratos/${contrato.id}/fotos-inventario`)
      .set('Authorization', `Bearer ${access_token}`)
      .field('momento', 'ENTREGA')
      .field('zona', 'Cocina')
      .attach('foto', Buffer.from('documento de prueba pdf'), {
        filename: 'foto.pdf',
        contentType: 'application/pdf',
      })
      .expect(HttpStatus.UNSUPPORTED_MEDIA_TYPE);
  });

  it('no permite a otro arrendador subir ni listar fotos de un contrato ajeno', async () => {
    const arrendadorA = await registrarArrendador(
      app,
      'Arrendador A Fotos',
      'aisla-foto-a@correo.com',
    );
    const arrendadorB = await registrarArrendador(
      app,
      'Arrendador B Fotos',
      'aisla-foto-b@correo.com',
    );
    const inmuebleA = await crearInmueble(app, arrendadorA.access_token);
    const inquilinoA = await crearInquilino(app, arrendadorA.access_token);
    const contrato = await crearContrato(
      app,
      arrendadorA.access_token,
      inmuebleA.unidades[0].id,
      inquilinoA.id,
    );
    await subirFoto(arrendadorA.access_token, contrato.id);

    await request(app.getHttpServer())
      .post(`/contratos/${contrato.id}/fotos-inventario`)
      .set('Authorization', `Bearer ${arrendadorB.access_token}`)
      .field('momento', 'ENTREGA')
      .field('zona', 'Bano')
      .attach('foto', Buffer.from('foto de prueba jpeg'), {
        filename: 'bano.jpg',
        contentType: 'image/jpeg',
      })
      .expect(HttpStatus.NOT_FOUND);

    await request(app.getHttpServer())
      .get(`/contratos/${contrato.id}/fotos-inventario`)
      .set('Authorization', `Bearer ${arrendadorB.access_token}`)
      .expect(HttpStatus.NOT_FOUND);
  });

  it('lista las fotos con URL firmada y respeta el filtro ?momento=', async () => {
    const { access_token, contrato } = await prepararContrato();

    await subirFoto(access_token, contrato.id, 'ENTREGA', 'Cocina');
    await subirFoto(access_token, contrato.id, 'DEVOLUCION', 'Cocina');

    const todas = await request(app.getHttpServer())
      .get(`/contratos/${contrato.id}/fotos-inventario`)
      .set('Authorization', `Bearer ${access_token}`)
      .expect(HttpStatus.OK);

    const fotos = todas.body as FotoInventarioListada[];
    expect(fotos).toHaveLength(2);
    for (const foto of fotos) {
      expect(foto.foto_url).toMatch(URL_FIRMADA);
      expect(
        (foto as unknown as Record<string, unknown>).foto_ruta,
      ).toBeUndefined();
    }

    const entrega = await request(app.getHttpServer())
      .get(`/contratos/${contrato.id}/fotos-inventario?momento=ENTREGA`)
      .set('Authorization', `Bearer ${access_token}`)
      .expect(HttpStatus.OK);

    const fotosEntrega = entrega.body as FotoInventarioListada[];
    expect(fotosEntrega).toHaveLength(1);
    expect(fotosEntrega[0].momento).toBe('ENTREGA');
  });

  it('no permite a un inquilino usar los endpoints del arrendador (401)', async () => {
    const { access_token, contrato, inquilinoToken } = await prepararContrato();
    await subirFoto(access_token, contrato.id);

    await request(app.getHttpServer())
      .post(`/contratos/${contrato.id}/fotos-inventario`)
      .set('Authorization', `Bearer ${inquilinoToken}`)
      .field('momento', 'ENTREGA')
      .field('zona', 'Bano')
      .attach('foto', Buffer.from('foto de prueba jpeg'), {
        filename: 'bano.jpg',
        contentType: 'image/jpeg',
      })
      .expect(HttpStatus.UNAUTHORIZED);

    await request(app.getHttpServer())
      .get(`/contratos/${contrato.id}/fotos-inventario`)
      .set('Authorization', `Bearer ${inquilinoToken}`)
      .expect(HttpStatus.UNAUTHORIZED);
  });
});
