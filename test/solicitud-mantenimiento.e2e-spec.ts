import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  autenticarInquilino,
  crearContrato,
  crearInmueble,
  crearInquilino,
  registrarArrendador,
} from './helpers/crear-datos.helper';
import { limpiarBd } from './helpers/limpiar-bd';

interface SolicitudCreada {
  id: string;
  descripcion: string;
  urgencia: string;
  estado: string;
  adjunto_url: string | null;
}

interface SolicitudListada {
  id: string;
}

const URL_FIRMADA = /^https:\/\/.*\.supabase\.co\/storage\/v1\/object\/sign\//;

describe('SolicitudMantenimiento (e2e)', () => {
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

  async function prepararDatos() {
    const { access_token } = await registrarArrendador(
      app,
      'Arrendador Manto',
      'manto@correo.com',
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
      'inquilino-manto@correo.com',
    );
    return { access_token, inmueble, inquilino, contrato, inquilinoToken };
  }

  async function crearSolicitud(
    inquilinoToken: string,
    unidadId: string,
    conAdjunto = false,
  ): Promise<SolicitudCreada> {
    const peticion = request(app.getHttpServer())
      .post('/solicitudes-mantenimiento')
      .set('Authorization', `Bearer ${inquilinoToken}`)
      .field('unidadId', unidadId)
      .field('descripcion', 'El lavadero tiene una fuga de agua.')
      .field('urgencia', 'ALTO');
    if (conAdjunto) {
      peticion.attach('adjunto', Buffer.from('foto de evidencia jpeg'), {
        filename: 'evidencia.jpg',
        contentType: 'image/jpeg',
      });
    }
    const respuesta = await peticion.expect(HttpStatus.CREATED);
    return respuesta.body as SolicitudCreada;
  }

  it('crea una solicitud con adjunto subido a Supabase y expone adjunto_url firmada', async () => {
    const { inmueble, inquilinoToken } = await prepararDatos();

    const solicitud = await crearSolicitud(
      inquilinoToken,
      inmueble.unidades[0].id,
      true,
    );

    expect(solicitud.id).toBeTruthy();
    expect(solicitud.estado).toBe('PENDIENTE');
    expect(solicitud.adjunto_url).toMatch(URL_FIRMADA);
    expect(
      (solicitud as unknown as Record<string, unknown>).adjunto_ruta,
    ).toBeUndefined();
  });

  it('crea una solicitud sin adjunto y adjunto_url queda null', async () => {
    const { inmueble, inquilinoToken } = await prepararDatos();

    const solicitud = await crearSolicitud(
      inquilinoToken,
      inmueble.unidades[0].id,
    );

    expect(solicitud.id).toBeTruthy();
    expect(solicitud.adjunto_url).toBeNull();

    const enBd = await prisma.solicitudMantenimiento.findUnique({
      where: { id: solicitud.id },
    });
    expect(enBd?.adjunto_ruta).toBeNull();
  });

  it('rechaza con 415 un adjunto con tipo de archivo no permitido', async () => {
    const { inmueble, inquilinoToken } = await prepararDatos();

    await request(app.getHttpServer())
      .post('/solicitudes-mantenimiento')
      .set('Authorization', `Bearer ${inquilinoToken}`)
      .field('unidadId', inmueble.unidades[0].id)
      .field('descripcion', 'Fuga de agua.')
      .field('urgencia', 'MEDIO')
      .attach('adjunto', Buffer.from('texto plano no permitido'), {
        filename: 'evidencia.txt',
        contentType: 'text/plain',
      })
      .expect(HttpStatus.UNSUPPORTED_MEDIA_TYPE);
  });

  it('no permite a otro arrendador ver, modificar ni listar solicitudes ajenas', async () => {
    const arrendadorA = await registrarArrendador(
      app,
      'Arrendador A Manto',
      'aisla-manto-a@correo.com',
    );
    const arrendadorB = await registrarArrendador(
      app,
      'Arrendador B Manto',
      'aisla-manto-b@correo.com',
    );
    const inmuebleA = await crearInmueble(app, arrendadorA.access_token);
    const inquilinoA = await crearInquilino(app, arrendadorA.access_token);
    const contrato = await crearContrato(
      app,
      arrendadorA.access_token,
      inmuebleA.unidades[0].id,
      inquilinoA.id,
    );
    const inquilinoToken = await autenticarInquilino(
      app,
      contrato.codigo_acceso?.codigo ?? '',
      'inquilino-aisla-manto@correo.com',
    );
    const solicitud = await crearSolicitud(
      inquilinoToken,
      inmuebleA.unidades[0].id,
      true,
    );

    await request(app.getHttpServer())
      .get(`/solicitudes-mantenimiento/${solicitud.id}`)
      .set('Authorization', `Bearer ${arrendadorB.access_token}`)
      .expect(HttpStatus.NOT_FOUND);

    await request(app.getHttpServer())
      .patch(`/solicitudes-mantenimiento/${solicitud.id}/estado`)
      .set('Authorization', `Bearer ${arrendadorB.access_token}`)
      .send({ estado: 'EN_PROCESO' })
      .expect(HttpStatus.NOT_FOUND);

    const listado = await request(app.getHttpServer())
      .get('/solicitudes-mantenimiento')
      .set('Authorization', `Bearer ${arrendadorB.access_token}`)
      .expect(HttpStatus.OK);

    expect(listado.body as SolicitudListada[]).toHaveLength(0);
  });

  it('restringe endpoints por rol: inquilino y arrendador no se cruzan (401)', async () => {
    const { access_token, inmueble, inquilinoToken } = await prepararDatos();
    const solicitud = await crearSolicitud(
      inquilinoToken,
      inmueble.unidades[0].id,
      true,
    );

    await request(app.getHttpServer())
      .get('/solicitudes-mantenimiento')
      .set('Authorization', `Bearer ${inquilinoToken}`)
      .expect(HttpStatus.UNAUTHORIZED);

    await request(app.getHttpServer())
      .get(`/solicitudes-mantenimiento/${solicitud.id}`)
      .set('Authorization', `Bearer ${inquilinoToken}`)
      .expect(HttpStatus.UNAUTHORIZED);

    await request(app.getHttpServer())
      .patch(`/solicitudes-mantenimiento/${solicitud.id}/estado`)
      .set('Authorization', `Bearer ${inquilinoToken}`)
      .send({ estado: 'EN_PROCESO' })
      .expect(HttpStatus.UNAUTHORIZED);

    await request(app.getHttpServer())
      .post('/solicitudes-mantenimiento')
      .set('Authorization', `Bearer ${access_token}`)
      .field('unidadId', inmueble.unidades[0].id)
      .field('descripcion', 'Intento no permitido.')
      .field('urgencia', 'BAJO')
      .expect(HttpStatus.UNAUTHORIZED);

    await request(app.getHttpServer())
      .get('/solicitudes-mantenimiento/mias')
      .set('Authorization', `Bearer ${access_token}`)
      .expect(HttpStatus.UNAUTHORIZED);
  });
});