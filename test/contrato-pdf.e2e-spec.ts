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

interface RespuestaContratoPdf {
  id: string;
  pdf_contrato_url: string | null;
  codigo_acceso: { codigo: string } | null;
}

const PATRON_URL_FIRMADA =
  /^https:\/\/.*\.supabase\.co\/storage\/v1\/object\/sign\//;

async function descargarUrlFirmada(url: string): Promise<Buffer> {
  const respuesta = await fetch(url);
  if (!respuesta.ok) {
    throw new Error(
      `No se pudo descargar la URL firmada (${respuesta.status})`,
    );
  }
  return Buffer.from(await respuesta.arrayBuffer());
}

describe('Contrato PDF (e2e)', () => {
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

  it('al crear un contrato expone una URL firmada de Supabase para el PDF', async () => {
    const { access_token } = await registrarArrendador(
      app,
      'Arrendador PDF',
      'pdf-crear@correo.com',
    );
    const inmueble = await crearInmueble(app, access_token);
    const inquilino = await crearInquilino(app, access_token);

    const contrato = await crearContrato(
      app,
      access_token,
      inmueble.unidades[0].id,
      inquilino.id,
    );

    const registro = await prisma.contrato.findUniqueOrThrow({
      where: { id: contrato.id },
    });

    expect(contrato.pdf_contrato_url).toBeTruthy();
    expect(contrato.pdf_contrato_url).toMatch(PATRON_URL_FIRMADA);
    expect(contrato.pdf_contrato_url).not.toContain('uploads/');
    expect(registro.pdf_contrato_ruta).toBe(
      `contratos/${contrato.id}/v1-CONTRATO_ORIGINAL.pdf`,
    );

    const buffer = await descargarUrlFirmada(
      contrato.pdf_contrato_url as string,
    );
    expect(buffer.toString('latin1').startsWith('%PDF')).toBe(true);
  }, 30000);

  it('GET /inquilino/mi-contrato expone la URL firmada del PDF', async () => {
    const { access_token } = await registrarArrendador(
      app,
      'Arrendador PDF',
      'pdf-inquilino@correo.com',
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
      'inquilino-pdf@correo.com',
    );

    const respuesta = await request(app.getHttpServer())
      .get('/inquilino/mi-contrato')
      .set('Authorization', `Bearer ${inquilinoToken}`)
      .expect(HttpStatus.OK);

    const miContrato = respuesta.body as RespuestaContratoPdf;
    expect(miContrato.pdf_contrato_url).toBeTruthy();
    expect(miContrato.pdf_contrato_url).toMatch(PATRON_URL_FIRMADA);
    expect(miContrato.pdf_contrato_url).not.toContain('uploads/');

    const buffer = await descargarUrlFirmada(
      miContrato.pdf_contrato_url as string,
    );
    expect(buffer.toString('latin1').startsWith('%PDF')).toBe(true);
  }, 30000);
});
