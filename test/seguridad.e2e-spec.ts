import { archivoDePrueba } from './helpers/archivos.helper';
import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EstadoContrato } from '@prisma/client';
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
import { esperarSinCamposSensibles } from './helpers/sin-campos-sensibles';

interface CuerpoError {
  statusCode: number;
  codigo: string;
  mensaje: string;
  message: string;
  detalles?: unknown;
}

const UUID_INEXISTENTE = '00000000-0000-4000-8000-000000000000';

describe('Seguridad (e2e)', () => {
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

  async function prepararContrato(sufijo: string) {
    const { access_token } = await registrarArrendador(
      app,
      `Arrendador ${sufijo}`,
      `seguridad-${sufijo}@correo.com`,
    );
    const inmueble = await crearInmueble(app, access_token, `SEG-${sufijo}`);
    const inquilino = await crearInquilino(app, access_token);
    const contrato = await crearContrato(
      app,
      access_token,
      inmueble.unidades[0].id,
      inquilino.id,
    );
    return { access_token, inmueble, inquilino, contrato };
  }

  async function subirFotoInventario(
    token: string,
    contratoId: string,
    momento: 'ENTREGA' | 'DEVOLUCION',
    zona: string,
  ) {
    await request(app.getHttpServer())
      .post(`/contratos/${contratoId}/fotos-inventario`)
      .set('Authorization', `Bearer ${token}`)
      .field('momento', momento)
      .field('zona', zona)
      .attach('foto', archivoDePrueba('jpeg', 'foto de prueba jpeg'), {
        filename: `${zona}.jpg`,
        contentType: 'image/jpeg',
      })
      .expect(HttpStatus.CREATED);
  }

  // a. POST /contratos, GET /contratos/:id y GET /contratos pasan el helper,
  // y el inquilino no trae correo ni foto_cedula_url.
  it('a. las respuestas de contratos no exponen campos sensibles del inquilino', async () => {
    const { access_token, contrato } = await prepararContrato('a');

    esperarSinCamposSensibles(contrato);
    const inquilinoEnContrato = contrato as unknown as {
      inquilino: Record<string, unknown>;
    };
    expect(inquilinoEnContrato.inquilino.correo).toBeUndefined();
    expect(inquilinoEnContrato.inquilino.foto_cedula_url).toBeUndefined();

    const detalle = await request(app.getHttpServer())
      .get(`/contratos/${contrato.id}`)
      .set('Authorization', `Bearer ${access_token}`)
      .expect(HttpStatus.OK);
    esperarSinCamposSensibles(detalle.body);
    const inquilinoEnDetalle = detalle.body as {
      inquilino: Record<string, unknown>;
    };
    expect(inquilinoEnDetalle.inquilino.correo).toBeUndefined();
    expect(inquilinoEnDetalle.inquilino.foto_cedula_url).toBeUndefined();

    const listado = await request(app.getHttpServer())
      .get('/contratos')
      .set('Authorization', `Bearer ${access_token}`)
      .expect(HttpStatus.OK);
    esperarSinCamposSensibles(listado.body);
  });

  // b. GET /inquilino/mi-contrato y GET /inquilino/mi-panel (token de
  // inquilino) pasan el helper.
  it('b. mi-contrato y mi-panel del inquilino no exponen campos sensibles', async () => {
    const { contrato } = await prepararContrato('b');
    const inquilinoToken = await autenticarInquilino(
      app,
      contrato.codigo_acceso?.codigo ?? '',
      'inquilino-seguridad-b@correo.com',
    );

    const miContrato = await request(app.getHttpServer())
      .get('/inquilino/mi-contrato')
      .set('Authorization', `Bearer ${inquilinoToken}`)
      .expect(HttpStatus.OK);
    esperarSinCamposSensibles(miContrato.body);

    const miPanel = await request(app.getHttpServer())
      .get('/inquilino/mi-panel')
      .set('Authorization', `Bearer ${inquilinoToken}`)
      .expect(HttpStatus.OK);
    esperarSinCamposSensibles(miPanel.body);
  });

  // c. PATCH /inmuebles/:id y PATCH de unidad con una ruta de archivo ajena
  // se ignoran en silencio (200, BD sin cambios).
  it('c. una ruta de archivo enviada por el cliente se ignora en silencio', async () => {
    const { access_token, inmueble } = await prepararContrato('c');
    const inmuebleAntes = await prisma.inmueble.findUniqueOrThrow({
      where: { id: inmueble.id },
    });
    const unidadAntes = await prisma.unidad.findUniqueOrThrow({
      where: { id: inmueble.unidades[0].id },
    });

    await request(app.getHttpServer())
      .patch(`/inmuebles/${inmueble.id}`)
      .set('Authorization', `Bearer ${access_token}`)
      .send({ foto_portada_ruta: 'contratos/otro-id/contrato.pdf' })
      .expect(HttpStatus.OK);

    await request(app.getHttpServer())
      .patch(`/inmuebles/${inmueble.id}/unidades/${inmueble.unidades[0].id}`)
      .set('Authorization', `Bearer ${access_token}`)
      .send({ foto_principal_url: 'contratos/otro-id/contrato.pdf' })
      .expect(HttpStatus.OK);

    const inmuebleDespues = await prisma.inmueble.findUniqueOrThrow({
      where: { id: inmueble.id },
    });
    const unidadDespues = await prisma.unidad.findUniqueOrThrow({
      where: { id: inmueble.unidades[0].id },
    });

    expect(inmuebleDespues.foto_portada_ruta).toBe(
      inmuebleAntes.foto_portada_ruta,
    );
    expect(unidadDespues.foto_principal_url).toBe(
      unidadAntes.foto_principal_url,
    );
  });

  // d. un id con forma inválida responde 404 NO_ENCONTRADO, nunca 500 ni 400.
  it('d. un id de ruta con forma inválida responde 404 NO_ENCONTRADO', async () => {
    const { access_token } = await prepararContrato('d');

    for (const respuesta of await Promise.all([
      request(app.getHttpServer())
        .get('/contratos/abc')
        .set('Authorization', `Bearer ${access_token}`),
      request(app.getHttpServer())
        .get('/inmuebles/abc')
        .set('Authorization', `Bearer ${access_token}`),
      request(app.getHttpServer())
        .patch('/pagos/abc/aprobar')
        .set('Authorization', `Bearer ${access_token}`),
    ])) {
      expect(respuesta.status).toBe(HttpStatus.NOT_FOUND);
      const cuerpo = respuesta.body as CuerpoError;
      expect(cuerpo.codigo).toBe('NO_ENCONTRADO');
    }
  });

  // e. un UUID válido que no existe, y un recurso de otro arrendador,
  // responden 404 NO_ENCONTRADO.
  it('e. un UUID inexistente o de otro arrendador responde 404 NO_ENCONTRADO', async () => {
    const arrendadorA = await prepararContrato('e-a');
    const arrendadorB = await registrarArrendador(
      app,
      'Arrendador e-b',
      'seguridad-e-b@correo.com',
    );

    const inexistente = await request(app.getHttpServer())
      .get(`/contratos/${UUID_INEXISTENTE}`)
      .set('Authorization', `Bearer ${arrendadorA.access_token}`)
      .expect(HttpStatus.NOT_FOUND);
    expect((inexistente.body as CuerpoError).codigo).toBe('NO_ENCONTRADO');

    const ajeno = await request(app.getHttpServer())
      .get(`/contratos/${arrendadorA.contrato.id}`)
      .set('Authorization', `Bearer ${arrendadorB.access_token}`)
      .expect(HttpStatus.NOT_FOUND);
    expect((ajeno.body as CuerpoError).codigo).toBe('NO_ENCONTRADO');
  });

  // f. un body inválido responde 400 VALIDACION con detalles como arreglo.
  it('f. un body inválido responde 400 con codigo VALIDACION y detalles', async () => {
    const { access_token, inmueble, inquilino } = await prepararContrato('f');

    const respuesta = await request(app.getHttpServer())
      .post('/contratos')
      .set('Authorization', `Bearer ${access_token}`)
      .send({
        unidad_id: inmueble.unidades[0].id,
        inquilino_id: inquilino.id,
        // faltan tipo_plantilla, canon_centavos, dia_pago, etc.
      })
      .expect(HttpStatus.BAD_REQUEST);

    const cuerpo = respuesta.body as CuerpoError;
    expect(cuerpo.codigo).toBe('VALIDACION');
    expect(Array.isArray(cuerpo.detalles)).toBe(true);
    expect((cuerpo.detalles as unknown[]).length).toBeGreaterThan(0);
  });

  // g. 6 llamadas seguidas a validar-codigo y a completar-registro:
  // la sexta responde 429 DEMASIADAS_SOLICITUDES.
  it('g. valida-codigo y completar-registro se limitan a 5 por minuto', async () => {
    let ultimaValidar: request.Response | undefined;
    for (let intento = 0; intento < 6; intento += 1) {
      ultimaValidar = await request(app.getHttpServer())
        .post('/auth/inquilino/validar-codigo')
        .send({ codigo: 'RC-9999-ABCD' });
    }
    expect(ultimaValidar?.status).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect((ultimaValidar?.body as CuerpoError).codigo).toBe(
      'DEMASIADAS_SOLICITUDES',
    );

    let ultimaCompletar: request.Response | undefined;
    for (let intento = 0; intento < 6; intento += 1) {
      ultimaCompletar = await request(app.getHttpServer())
        .post('/auth/inquilino/completar-registro')
        .send({
          codigo: 'RC-9999-ABCD',
          correo: `intento-${intento}@correo.com`,
          contrasena: 'clave1234',
        });
    }
    expect(ultimaCompletar?.status).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect((ultimaCompletar?.body as CuerpoError).codigo).toBe(
      'DEMASIADAS_SOLICITUDES',
    );
  });

  // h. toda respuesta de error trae statusCode, codigo, mensaje y message.
  it('h. toda respuesta de error trae statusCode, codigo, mensaje y message', async () => {
    const respuesta = await request(app.getHttpServer())
      .get(`/contratos/${UUID_INEXISTENTE}`)
      .expect(HttpStatus.UNAUTHORIZED);

    const cuerpo = respuesta.body as CuerpoError;
    expect(typeof cuerpo.statusCode).toBe('number');
    expect(typeof cuerpo.codigo).toBe('string');
    expect(typeof cuerpo.mensaje).toBe('string');
    expect(typeof cuerpo.message).toBe('string');
  });

  // i. B-32: datos_recaudo solo se muestra con contrato ACTIVO.
  it('i. datos_recaudo sale en null cuando el contrato no está activo', async () => {
    const { contrato } = await prepararContrato('i');
    const inquilinoToken = await autenticarInquilino(
      app,
      contrato.codigo_acceso?.codigo ?? '',
      'inquilino-seguridad-i@correo.com',
    );

    const activo = await request(app.getHttpServer())
      .get('/inquilino/mi-contrato')
      .set('Authorization', `Bearer ${inquilinoToken}`)
      .expect(HttpStatus.OK);
    const cuerpoActivo = activo.body as { datos_recaudo: unknown };
    expect(typeof cuerpoActivo.datos_recaudo).toBe('string');
    expect(cuerpoActivo.datos_recaudo).toBe('Bancolombia ahorros 123456789');

    await prisma.contrato.update({
      where: { id: contrato.id },
      data: { estado: EstadoContrato.TERMINADO_ANTICIPADAMENTE },
    });

    const noActivo = await request(app.getHttpServer())
      .get('/inquilino/mi-contrato')
      .set('Authorization', `Bearer ${inquilinoToken}`)
      .expect(HttpStatus.OK);

    expect(noActivo.body).toMatchObject({
      contratoId: contrato.id,
      canon_centavos: contrato.canon_centavos,
      dia_pago: contrato.dia_pago,
      datos_recaudo: null,
    });
  });

  // j. B-40: las fotos de entrega y devolución salen en su grupo
  // correspondiente.
  it('j. mi-contrato separa las fotos de entrega y devolución', async () => {
    const { access_token, contrato } = await prepararContrato('j');
    const inquilinoToken = await autenticarInquilino(
      app,
      contrato.codigo_acceso?.codigo ?? '',
      'inquilino-seguridad-j@correo.com',
    );

    await subirFotoInventario(access_token, contrato.id, 'ENTREGA', 'Cocina');
    await subirFotoInventario(access_token, contrato.id, 'DEVOLUCION', 'Sala');

    const respuesta = await request(app.getHttpServer())
      .get('/inquilino/mi-contrato')
      .set('Authorization', `Bearer ${inquilinoToken}`)
      .expect(HttpStatus.OK);

    const cuerpo = respuesta.body as {
      fotos_entrega: Array<{ zona: string }>;
      fotos_devolucion: Array<{ zona: string }>;
    };
    expect(cuerpo.fotos_entrega).toHaveLength(1);
    expect(cuerpo.fotos_entrega[0].zona).toBe('Cocina');
    expect(cuerpo.fotos_devolucion).toHaveLength(1);
    expect(cuerpo.fotos_devolucion[0].zona).toBe('Sala');
  });

  // B-04: sin LOG_IP_DIAGNOSTICO, el middleware no debe registrar nada
  // (verificado indirectamente: la variable no está definida en .env.test
  // y la petición responde con normalidad).
  it('el diagnóstico de IP está desactivado por defecto', async () => {
    expect(process.env.LOG_IP_DIAGNOSTICO).not.toBe('true');
    await request(app.getHttpServer()).get('/').expect(HttpStatus.OK);
  });
});
