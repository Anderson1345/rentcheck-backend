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
  reportarPago,
} from './helpers/crear-datos.helper';
import { limpiarBd } from './helpers/limpiar-bd';

interface DocumentoCreado {
  id: string;
  archivo_url: string;
  tipo: string;
}

describe('InmuebleDocumentos (e2e)', () => {
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

  it('sube un documento a Supabase, expone URL firmada y lo incluye en el ZIP', async () => {
    const { access_token } = await registrarArrendador(
      app,
      'Arrendador Doc',
      'doc@correo.com',
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
      'inquilino-doc@correo.com',
    );
    await reportarPago(app, inquilinoToken, contrato.id);

    const contenidoDocumento = Buffer.from('documento de prueba pdf');
    const respuesta = await request(app.getHttpServer())
      .post(`/inmuebles/${inmueble.id}/documentos`)
      .set('Authorization', `Bearer ${access_token}`)
      .field('tipo', 'CERTIFICADO_TRADICION_LIBERTAD')
      .attach('archivo', contenidoDocumento, {
        filename: 'certificado.pdf',
        contentType: 'application/pdf',
      })
      .expect(HttpStatus.CREATED);

    const documento = respuesta.body as DocumentoCreado;
    expect(documento.id).toBeTruthy();
    expect(documento.tipo).toBe('CERTIFICADO_TRADICION_LIBERTAD');
    expect(documento.archivo_url).toMatch(
      /^https:\/\/.*\.supabase\.co\/storage\/v1\/object\/sign\//,
    );

    const listado = await request(app.getHttpServer())
      .get(`/inmuebles/${inmueble.id}/documentos`)
      .set('Authorization', `Bearer ${access_token}`)
      .expect(HttpStatus.OK);

    expect(listado.body as DocumentoCreado[]).toHaveLength(1);
    expect((listado.body as DocumentoCreado[])[0].archivo_url).toMatch(
      /^https:\/\/.*\.supabase\.co\/storage\/v1\/object\/sign\//,
    );

    const zip = await request(app.getHttpServer())
      .get(`/inmuebles/${inmueble.id}/descargar-documentos`)
      .set('Authorization', `Bearer ${access_token}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(HttpStatus.OK)
      .expect('Content-Type', /application\/zip/);

    const cuerpoZip = zip.body as Buffer;
    expect(cuerpoZip.length).toBeGreaterThan(0);
    expect(cuerpoZip.toString('latin1').includes('documentos-inmueble/')).toBe(
      true,
    );
    expect(cuerpoZip.toString('latin1').includes('comprobantes/')).toBe(true);
  }, 30000);
});
