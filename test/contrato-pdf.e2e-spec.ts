import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createClient } from '@supabase/supabase-js';
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

interface RespuestaRenovarContrato {
  contrato: { id: string; pdf_contrato_url: string | null };
}

const PATRON_URL_FIRMADA =
  /^https:\/\/.*\.supabase\.co\/storage\/v1\/object\/sign\//;

function rutaDeUrlFirmada(url: string): string {
  return url.split('?')[0];
}

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
      `contratos/${contrato.id}/contrato.pdf`,
    );

    const buffer = await descargarUrlFirmada(
      contrato.pdf_contrato_url as string,
    );
    expect(buffer.toString('latin1').startsWith('%PDF')).toBe(true);
  }, 30000);

  it('al renovar el PDF se reemplaza en la misma ruta fija y la URL firmada sigue válida', async () => {
    const { access_token } = await registrarArrendador(
      app,
      'Arrendador PDF',
      'pdf-renovar@correo.com',
    );
    const inmueble = await crearInmueble(app, access_token);
    const inquilino = await crearInquilino(app, access_token);
    const contrato = await crearContrato(
      app,
      access_token,
      inmueble.unidades[0].id,
      inquilino.id,
    );

    const rutaFija = `contratos/${contrato.id}/contrato.pdf`;
    const bufferAntes = await descargarUrlFirmada(
      contrato.pdf_contrato_url as string,
    );

    await prisma.configuracionIpc.create({
      data: { porcentaje: 10, anio: new Date().getFullYear() },
    });

    const respuesta = await request(app.getHttpServer())
      .post(`/contratos/${contrato.id}/renovar`)
      .set('Authorization', `Bearer ${access_token}`)
      .expect(HttpStatus.CREATED);

    const renovado = (respuesta.body as RespuestaRenovarContrato).contrato;
    const registro = await prisma.contrato.findUniqueOrThrow({
      where: { id: contrato.id },
    });

    expect(renovado.pdf_contrato_url).toBeTruthy();
    expect(renovado.pdf_contrato_url).toMatch(PATRON_URL_FIRMADA);
    expect(renovado.pdf_contrato_url).not.toContain('uploads/');
    expect(rutaDeUrlFirmada(renovado.pdf_contrato_url as string)).toBe(
      rutaDeUrlFirmada(contrato.pdf_contrato_url as string),
    );
    expect(registro.pdf_contrato_ruta).toBe(rutaFija);

    const bufferDespues = await descargarUrlFirmada(
      renovado.pdf_contrato_url as string,
    );
    expect(bufferDespues.toString('latin1').startsWith('%PDF')).toBe(true);
    expect(bufferDespues.equals(bufferAntes)).toBe(false);

    const supabase = createClient(
      process.env.SUPABASE_URL ?? '',
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    );
    const listado = await supabase.storage
      .from(process.env.SUPABASE_BUCKET ?? '')
      .list(
        `${process.env.SUPABASE_PREFIJO_RUTA ?? ''}contratos/${contrato.id}/`,
      );
    expect(listado.error).toBeNull();
    expect(listado.data ?? []).toHaveLength(1);
    expect(listado.data?.[0]?.name).toBe('contrato.pdf');
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
