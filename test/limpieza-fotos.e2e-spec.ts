import { HttpStatus, INestApplication, Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { dirname, basename } from 'path';
import request from 'supertest';
import { App } from 'supertest/types';
import { AlmacenamientoService } from '../src/almacenamiento/almacenamiento.service';
import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/configurar-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { archivoDePrueba } from './helpers/archivos.helper';
import {
  crearContrato,
  crearInmueble,
  crearInquilino,
  registrarArrendador,
} from './helpers/crear-datos.helper';
import { limpiarBd } from './helpers/limpiar-bd';

const OK: number = HttpStatus.OK;
const CONFLICTO: number = HttpStatus.CONFLICT;

const URL_FIRMADA = /^https?:\/\//;

describe('Limpieza de fotos al eliminar inmueble o unidad (B-42 parcial, e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let almacenamiento: AlmacenamientoService;
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
    almacenamiento = modulo.get(AlmacenamientoService);
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

  /** Arrendador con un inmueble que tiene portada y una unidad con foto. */
  async function escenario() {
    contador += 1;
    const { access_token } = await registrarArrendador(
      app,
      `Arrendador Limpieza ${contador}`,
      `limpieza-${contador}@correo.com`,
    );
    const inmueble = await crearInmueble(app, access_token, `LIM-${contador}`);
    const unidadId = inmueble.unidades[0].id;
    await request(app.getHttpServer())
      .post(`/inmuebles/${inmueble.id}/foto-portada`)
      .set('Authorization', `Bearer ${access_token}`)
      .attach('foto', archivoDePrueba('png', ' portada'), {
        filename: 'portada.png',
        contentType: 'image/png',
      })
      .expect(OK);
    await request(app.getHttpServer())
      .post(`/inmuebles/${inmueble.id}/unidades/${unidadId}/foto-principal`)
      .set('Authorization', `Bearer ${access_token}`)
      .attach('foto', archivoDePrueba('jpeg', ' unidad'), {
        filename: 'unidad.jpg',
        contentType: 'image/jpeg',
      })
      .expect(OK);
    const i = await prisma.inmueble.findUniqueOrThrow({
      where: { id: inmueble.id },
    });
    const u = await prisma.unidad.findUniqueOrThrow({
      where: { id: unidadId },
    });
    return {
      token: access_token,
      inmuebleId: inmueble.id,
      unidadId,
      portada: i.foto_portada_ruta as string,
      fotoUnidad: u.foto_principal_url as string,
    };
  }

  /** Existencia real en el bucket por listado (la descarga puede salir de la caché del CDN). */
  async function existe(ruta: string): Promise<boolean> {
    const items = await almacenamiento.listar(dirname(ruta));
    return items.some((item) => item.name === basename(ruta));
  }

  const eliminarInmueble = (token: string, id: string) =>
    request(app.getHttpServer())
      .delete(`/inmuebles/${id}`)
      .set('Authorization', `Bearer ${token}`);

  const eliminarUnidad = (
    token: string,
    inmuebleId: string,
    unidadId: string,
  ) =>
    request(app.getHttpServer())
      .delete(`/inmuebles/${inmuebleId}/unidades/${unidadId}`)
      .set('Authorization', `Bearer ${token}`);

  function capturarAvisos(): string[] {
    const avisos: string[] = [];
    jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation((mensaje: unknown) => {
        avisos.push(String(mensaje));
      });
    return avisos;
  }

  it('eliminar una unidad borra su foto del bucket; eliminar después el inmueble borra su portada; la respuesta conserva su forma', async () => {
    const e = await escenario();
    expect(await existe(e.fotoUnidad)).toBe(true);
    expect(await existe(e.portada)).toBe(true);

    const u = await eliminarUnidad(e.token, e.inmuebleId, e.unidadId).expect(
      OK,
    );
    expect(
      (u.body as { foto_principal_url: string }).foto_principal_url,
    ).toMatch(URL_FIRMADA);
    expect(await existe(e.fotoUnidad)).toBe(false);
    expect(await existe(e.portada)).toBe(true);

    const i = await eliminarInmueble(e.token, e.inmuebleId).expect(OK);
    expect((i.body as { foto_portada_url: string }).foto_portada_url).toMatch(
      URL_FIRMADA,
    );
    expect(await existe(e.portada)).toBe(false);
    expect(await prisma.inmueble.count()).toBe(0);
  }, 180000);

  it('un 409 no borra ninguna foto (inmueble con unidades, con documentos; unidad con contratos)', async () => {
    const e = await escenario();

    // Inmueble con unidades -> 409: la portada y la foto de la unidad siguen.
    expect((await eliminarInmueble(e.token, e.inmuebleId)).status).toBe(
      CONFLICTO,
    );
    expect(await existe(e.portada)).toBe(true);
    expect(await existe(e.fotoUnidad)).toBe(true);

    // Unidad con contrato -> 409: su foto sigue.
    const ficha = await crearInquilino(app, e.token);
    await crearContrato(app, e.token, e.unidadId, ficha.id);
    expect(
      (await eliminarUnidad(e.token, e.inmuebleId, e.unidadId)).status,
    ).toBe(CONFLICTO);
    expect(await existe(e.fotoUnidad)).toBe(true);
    expect(await prisma.unidad.count({ where: { id: e.unidadId } })).toBe(1);
  }, 180000);

  it('un inmueble sin unidades pero con documentos responde 409 y conserva la portada', async () => {
    const e = await escenario();
    await request(app.getHttpServer())
      .post(`/inmuebles/${e.inmuebleId}/documentos`)
      .set('Authorization', `Bearer ${e.token}`)
      .field('tipo', 'RECIBO_PREDIAL')
      .attach('archivo', archivoDePrueba('pdf'), {
        filename: 'predial.pdf',
        contentType: 'application/pdf',
      })
      .expect(HttpStatus.CREATED);
    await eliminarUnidad(e.token, e.inmuebleId, e.unidadId).expect(OK);

    const r = await eliminarInmueble(e.token, e.inmuebleId);

    expect(r.status).toBe(CONFLICTO);
    expect(await existe(e.portada)).toBe(true);
    // Los documentos (valor legal) no se tocan.
    expect(await prisma.documentoInmueble.count()).toBe(1);
  }, 180000);

  it('si el bucket falla al borrar, igual responde éxito, no se revierte la base y queda un warn sin URL ni ruta', async () => {
    const e = await escenario();
    await eliminarUnidad(e.token, e.inmuebleId, e.unidadId).expect(OK);
    const avisos = capturarAvisos();
    const borrar = jest
      .spyOn(almacenamiento, 'eliminarArchivo')
      .mockRejectedValue(new Error('bucket caído (simulado)'));

    const r = await eliminarInmueble(e.token, e.inmuebleId);

    expect(r.status).toBe(OK);
    expect(borrar).toHaveBeenCalled();
    expect(await prisma.inmueble.count()).toBe(0);
    const propios = avisos.filter((a) => /No se pudo eliminar/.test(a));
    expect(propios.length).toBeGreaterThan(0);
    for (const aviso of propios) {
      expect(aviso).not.toMatch(/https?:\/\//);
      expect(aviso).not.toContain(e.portada);
    }
  }, 180000);

  it('si el bucket falla al borrar la foto de una unidad, eliminar la unidad igual responde éxito', async () => {
    const e = await escenario();
    capturarAvisos();
    jest
      .spyOn(almacenamiento, 'eliminarArchivo')
      .mockRejectedValue(new Error('bucket caído (simulado)'));

    const r = await eliminarUnidad(e.token, e.inmuebleId, e.unidadId);

    expect(r.status).toBe(OK);
    expect(await prisma.unidad.count({ where: { id: e.unidadId } })).toBe(0);
  }, 180000);

  it('una ruta que no empieza por el prefijo propio (heredada, data: o de otra entidad) no se borra', async () => {
    const e = await escenario();
    const borrar = jest.spyOn(almacenamiento, 'eliminarArchivo');
    const ajena =
      'inmuebles/00000000-0000-4000-8000-000000000000/unidades/x/foto.jpg';
    await prisma.unidad.update({
      where: { id: e.unidadId },
      data: { foto_principal_url: ajena },
    });
    await eliminarUnidad(e.token, e.inmuebleId, e.unidadId).expect(OK);
    // Con la ruta ajena no se llamó al bucket para esa ruta.
    expect(borrar.mock.calls.map((c) => c[0])).not.toContain(ajena);
    borrar.mockClear();

    for (const heredada of [
      'contratos/algun-contrato/v1-CONTRATO_ORIGINAL.pdf',
      'uploads/portada.jpg',
      'data:image/png;base64,AAAA',
      `inmuebles/${e.inmuebleId}/unidades/otra/foto.jpg`,
    ]) {
      const otro = await crearInmueble(app, e.token, `HER-${++contador}`);
      await eliminarUnidad(e.token, otro.id, otro.unidades[0].id).expect(OK);
      await prisma.inmueble.update({
        where: { id: otro.id },
        data: { foto_portada_ruta: heredada },
      });
      borrar.mockClear();
      const nuevo = await eliminarInmueble(e.token, otro.id);
      expect([heredada, nuevo.status]).toEqual([heredada, OK]);
      expect([heredada, borrar.mock.calls.length]).toEqual([heredada, 0]);
    }
  }, 240000);

  it('el archivo de otro inmueble con la misma forma de ruta no se toca al eliminar uno propio', async () => {
    const a = await escenario();
    const b = await escenario();
    await eliminarUnidad(a.token, a.inmuebleId, a.unidadId).expect(OK);
    await eliminarInmueble(a.token, a.inmuebleId).expect(OK);

    expect(await existe(a.portada)).toBe(false);
    expect(await existe(b.portada)).toBe(true);
    expect(await existe(b.fotoUnidad)).toBe(true);
  }, 240000);
});
