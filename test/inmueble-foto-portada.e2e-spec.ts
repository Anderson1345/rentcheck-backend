import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { AlmacenamientoService } from '../src/almacenamiento/almacenamiento.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  crearInmueble,
  registrarArrendador,
  RespuestaCrearInmueble,
} from './helpers/crear-datos.helper';
import { limpiarBd } from './helpers/limpiar-bd';

interface InmuebleConFotoPortada {
  id: string;
  foto_portada_url: string;
}

const URL_FIRMADA = /^https:\/\/.*\.supabase\.co\/storage\/v1\/object\/sign\//;

describe('InmuebleFotoPortada (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let almacenamiento: AlmacenamientoService;

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
    almacenamiento = moduleFixture.get(AlmacenamientoService);
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

  function subirFoto(
    token: string,
    inmuebleId: string,
    contenido: Buffer,
    filename = 'portada.jpg',
    contentType = 'image/jpeg',
  ) {
    return request(app.getHttpServer())
      .post(`/inmuebles/${inmuebleId}/foto-portada`)
      .set('Authorization', `Bearer ${token}`)
      .attach('foto', contenido, { filename, contentType });
  }

  it('sube una foto de portada, la sobrescribe en la misma ruta y expone URL firmada', async () => {
    const { access_token } = await registrarArrendador(
      app,
      'Arrendador Portada',
      'portada@correo.com',
    );
    const inmueble = await crearInmueble(app, access_token);

    const primeraFoto = Buffer.from('foto de portada jpeg primera');
    const primera = await subirFoto(
      access_token,
      inmueble.id,
      primeraFoto,
    ).expect(HttpStatus.OK);

    const primeraRespuesta = primera.body as InmuebleConFotoPortada;
    expect(primeraRespuesta.id).toBe(inmueble.id);
    expect(primeraRespuesta.foto_portada_url).toMatch(URL_FIRMADA);
    expect(
      (primera.body as unknown as Record<string, unknown>).foto_portada_ruta,
    ).toBeUndefined();

    const segundaFoto = Buffer.from('foto de portada jpeg reemplazada');
    const segunda = await subirFoto(
      access_token,
      inmueble.id,
      segundaFoto,
    ).expect(HttpStatus.OK);

    const segundaRespuesta = segunda.body as InmuebleConFotoPortada;
    expect(segundaRespuesta.foto_portada_url).toMatch(URL_FIRMADA);

    const archivos = await almacenamiento.listar(`inmuebles/${inmueble.id}`);
    expect(archivos.filter((a) => !a.esCarpeta)).toHaveLength(1);
    expect(archivos[0].name).toBe('portada.jpg');

    const contenidoAlmacenado = await almacenamiento.descargarArchivo(
      `inmuebles/${inmueble.id}/portada.jpg`,
    );
    expect(contenidoAlmacenado.equals(segundaFoto)).toBe(true);

    const detalle = await request(app.getHttpServer())
      .get(`/inmuebles/${inmueble.id}`)
      .set('Authorization', `Bearer ${access_token}`)
      .expect(HttpStatus.OK);

    const detalleBody = detalle.body as InmuebleConFotoPortada;
    expect(detalleBody.foto_portada_url).toMatch(URL_FIRMADA);
    expect(
      (detalle.body as unknown as Record<string, unknown>).foto_portada_ruta,
    ).toBeUndefined();
  }, 30000);

  it('no permite a otro arrendador subir foto de portada al inmueble ajeno', async () => {
    const arrendadorA = await registrarArrendador(
      app,
      'Arrendador A Portada',
      'portada-a@correo.com',
    );
    const arrendadorB = await registrarArrendador(
      app,
      'Arrendador B Portada',
      'portada-b@correo.com',
    );
    const inmuebleA: RespuestaCrearInmueble = await crearInmueble(
      app,
      arrendadorA.access_token,
    );

    await subirFoto(
      arrendadorA.access_token,
      inmuebleA.id,
      Buffer.from('foto de prueba jpeg'),
    ).expect(HttpStatus.OK);

    await subirFoto(
      arrendadorB.access_token,
      inmuebleA.id,
      Buffer.from('foto ajena jpeg'),
    ).expect(HttpStatus.NOT_FOUND);
  });

  it('rechaza con 415 una foto de portada con tipo de archivo no permitido', async () => {
    const { access_token } = await registrarArrendador(
      app,
      'Arrendador Portada Pdf',
      'portada-pdf@correo.com',
    );
    const inmueble = await crearInmueble(app, access_token);

    await subirFoto(
      access_token,
      inmueble.id,
      Buffer.from('documento de prueba pdf'),
      'portada.pdf',
      'application/pdf',
    ).expect(HttpStatus.UNSUPPORTED_MEDIA_TYPE);
  });
});
