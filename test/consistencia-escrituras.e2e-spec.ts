import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EstadoContrato, EstadoSolicitudMantenimiento } from '@prisma/client';
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
  RespuestaCrearContrato,
  RespuestaCrearInmueble,
} from './helpers/crear-datos.helper';
import { limpiarBd } from './helpers/limpiar-bd';

interface CuerpoError {
  statusCode: number;
  codigo: string;
  mensaje: string;
  message: string;
}

interface SolicitudCreada {
  id: string;
  estado: string;
}

// Se guarda como `number` (no como el enum) para poder comparar contra
// `response.status` (siempre `number`) sin disparar no-unsafe-enum-comparison.
const CONFLICTO: number = HttpStatus.CONFLICT;

describe('Consistencia de escrituras (e2e)', () => {
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

  function contarStatus(
    respuestas: request.Response[],
    status: number,
  ): number {
    return respuestas.filter((r) => r.status === status).length;
  }

  // ------------------------------------------------------------------
  // B-33: eliminar un inmueble con documentos (sin unidades)
  // ------------------------------------------------------------------
  describe('DELETE /inmuebles/:id con documentos asociados', () => {
    async function prepararInmuebleConDocumentoSinUnidades(sufijo: string) {
      const { access_token } = await registrarArrendador(
        app,
        `Arrendador Doc ${sufijo}`,
        `doc-${sufijo}@correo.com`,
      );
      const inmueble = await crearInmueble(app, access_token, `DOC-${sufijo}`);

      // Quitar la unidad principal autogenerada para dejar el inmueble sin
      // unidades, y así aislar el caso de "solo documentos".
      await request(app.getHttpServer())
        .delete(`/inmuebles/${inmueble.id}/unidades/${inmueble.unidades[0].id}`)
        .set('Authorization', `Bearer ${access_token}`)
        .expect(HttpStatus.OK);

      await request(app.getHttpServer())
        .post(`/inmuebles/${inmueble.id}/documentos`)
        .set('Authorization', `Bearer ${access_token}`)
        .field('tipo', 'CERTIFICADO_TRADICION_LIBERTAD')
        .attach('archivo', Buffer.from('documento de prueba pdf'), {
          filename: 'certificado.pdf',
          contentType: 'application/pdf',
        })
        .expect(HttpStatus.CREATED);

      return { access_token, inmueble };
    }

    it('responde 409 INMUEBLE_CON_DOCUMENTOS en vez de 500', async () => {
      const { access_token, inmueble } =
        await prepararInmuebleConDocumentoSinUnidades('a');

      const respuesta = await request(app.getHttpServer())
        .delete(`/inmuebles/${inmueble.id}`)
        .set('Authorization', `Bearer ${access_token}`)
        .expect(HttpStatus.CONFLICT);

      expect((respuesta.body as CuerpoError).codigo).toBe(
        'INMUEBLE_CON_DOCUMENTOS',
      );

      const enBd = await prisma.inmueble.findUnique({
        where: { id: inmueble.id },
      });
      expect(enBd).not.toBeNull();
    });

    it('dos borrados simultáneos de un inmueble sin hijos: exactamente uno tiene éxito', async () => {
      const { access_token } = await registrarArrendador(
        app,
        'Arrendador Doc Race',
        'doc-race@correo.com',
      );
      const inmueble = await crearInmueble(app, access_token, 'DOC-RACE');
      await request(app.getHttpServer())
        .delete(`/inmuebles/${inmueble.id}/unidades/${inmueble.unidades[0].id}`)
        .set('Authorization', `Bearer ${access_token}`)
        .expect(HttpStatus.OK);

      const [r1, r2] = await Promise.all([
        request(app.getHttpServer())
          .delete(`/inmuebles/${inmueble.id}`)
          .set('Authorization', `Bearer ${access_token}`),
        request(app.getHttpServer())
          .delete(`/inmuebles/${inmueble.id}`)
          .set('Authorization', `Bearer ${access_token}`),
      ]);

      expect(contarStatus([r1, r2], HttpStatus.OK)).toBe(1);
      expect(contarStatus([r1, r2], HttpStatus.NOT_FOUND)).toBe(1);
      for (const respuesta of [r1, r2]) {
        expect(respuesta.status).not.toBe(500);
      }

      const enBd = await prisma.inmueble.findUnique({
        where: { id: inmueble.id },
      });
      expect(enBd).toBeNull();
    });
  });

  // ------------------------------------------------------------------
  // B-36: aprobar/rechazar un pago
  // ------------------------------------------------------------------
  describe('PATCH /pagos/:id/aprobar y /rechazar', () => {
    async function prepararPagoPendiente(sufijo: string) {
      const { access_token } = await registrarArrendador(
        app,
        `Arrendador Pago ${sufijo}`,
        `pago-consist-${sufijo}@correo.com`,
      );
      const inmueble = await crearInmueble(app, access_token, `PAG-${sufijo}`);
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
        `inquilino-pago-consist-${sufijo}@correo.com`,
      );
      const pago = await reportarPago(app, inquilinoToken, contrato.id);
      return { access_token, contrato, pago };
    }

    it('una segunda aprobación después de que la primera ya cerró el pago responde 409', async () => {
      const { access_token, pago } = await prepararPagoPendiente('seq');

      await request(app.getHttpServer())
        .patch(`/pagos/${pago.id}/aprobar`)
        .set('Authorization', `Bearer ${access_token}`)
        .expect(HttpStatus.OK);

      const segunda = await request(app.getHttpServer())
        .patch(`/pagos/${pago.id}/aprobar`)
        .set('Authorization', `Bearer ${access_token}`)
        .expect(HttpStatus.CONFLICT);

      expect((segunda.body as CuerpoError).codigo).toBe('PAGO_YA_PROCESADO');
    });

    it('dos aprobaciones simultáneas: exactamente una tiene éxito y el contrato queda AL_DIA una sola vez', async () => {
      const { access_token, contrato, pago } =
        await prepararPagoPendiente('race');

      const [r1, r2] = await Promise.all([
        request(app.getHttpServer())
          .patch(`/pagos/${pago.id}/aprobar`)
          .set('Authorization', `Bearer ${access_token}`),
        request(app.getHttpServer())
          .patch(`/pagos/${pago.id}/aprobar`)
          .set('Authorization', `Bearer ${access_token}`),
      ]);

      expect(contarStatus([r1, r2], HttpStatus.OK)).toBe(1);
      expect(contarStatus([r1, r2], HttpStatus.CONFLICT)).toBe(1);
      for (const respuesta of [r1, r2]) {
        expect(respuesta.status).not.toBe(500);
      }
      const perdedora = [r1, r2].find((r) => r.status === CONFLICTO);
      expect((perdedora?.body as CuerpoError).codigo).toBe('PAGO_YA_PROCESADO');

      const pagoEnBd = await prisma.pago.findUnique({ where: { id: pago.id } });
      expect(pagoEnBd?.estado).toBe('APROBADO');

      const contratoEnBd = await prisma.contrato.findUnique({
        where: { id: contrato.id },
      });
      expect(contratoEnBd?.estado_pago).toBe('AL_DIA');
    });

    it('dos rechazos simultáneos: exactamente uno tiene éxito', async () => {
      const { access_token, pago } = await prepararPagoPendiente('race-rech');

      const [r1, r2] = await Promise.all([
        request(app.getHttpServer())
          .patch(`/pagos/${pago.id}/rechazar`)
          .set('Authorization', `Bearer ${access_token}`),
        request(app.getHttpServer())
          .patch(`/pagos/${pago.id}/rechazar`)
          .set('Authorization', `Bearer ${access_token}`),
      ]);

      expect(contarStatus([r1, r2], HttpStatus.OK)).toBe(1);
      expect(contarStatus([r1, r2], HttpStatus.CONFLICT)).toBe(1);

      const pagoEnBd = await prisma.pago.findUnique({ where: { id: pago.id } });
      expect(pagoEnBd?.estado).toBe('RECHAZADO');
    });
  });

  // ------------------------------------------------------------------
  // B-36: confirmar terminación anticipada de un contrato
  // ------------------------------------------------------------------
  describe('POST /contratos/:id/confirmar-terminacion-anticipada', () => {
    async function prepararContratoConSolicitud(sufijo: string) {
      const { access_token } = await registrarArrendador(
        app,
        `Arrendador Term ${sufijo}`,
        `term-${sufijo}@correo.com`,
      );
      const inmueble = await crearInmueble(app, access_token, `TER-${sufijo}`);
      const inquilino = await crearInquilino(app, access_token);
      const contrato = await crearContrato(
        app,
        access_token,
        inmueble.unidades[0].id,
        inquilino.id,
      );

      await request(app.getHttpServer())
        .post(`/contratos/${contrato.id}/solicitar-terminacion-anticipada`)
        .set('Authorization', `Bearer ${access_token}`)
        .send({ motivo: 'El inquilino se muda de ciudad.' })
        .expect(HttpStatus.CREATED);

      return { access_token, contrato, inmueble };
    }

    it('confirma exitosamente y dos confirmaciones simultáneas dejan exactamente una en TERMINADO_ANTICIPADAMENTE', async () => {
      const { access_token, contrato } =
        await prepararContratoConSolicitud('race');

      const [r1, r2] = await Promise.all([
        request(app.getHttpServer())
          .post(`/contratos/${contrato.id}/confirmar-terminacion-anticipada`)
          .set('Authorization', `Bearer ${access_token}`),
        request(app.getHttpServer())
          .post(`/contratos/${contrato.id}/confirmar-terminacion-anticipada`)
          .set('Authorization', `Bearer ${access_token}`),
      ]);

      expect(contarStatus([r1, r2], HttpStatus.CREATED)).toBe(1);
      expect(contarStatus([r1, r2], HttpStatus.CONFLICT)).toBe(1);
      for (const respuesta of [r1, r2]) {
        expect(respuesta.status).not.toBe(500);
      }
      const perdedora = [r1, r2].find((r) => r.status === CONFLICTO);
      expect((perdedora?.body as CuerpoError).codigo).toBe(
        'TERMINACION_YA_CONFIRMADA',
      );

      const contratoEnBd = await prisma.contrato.findUnique({
        where: { id: contrato.id },
      });
      expect(contratoEnBd?.estado).toBe(
        EstadoContrato.TERMINADO_ANTICIPADAMENTE,
      );
    });

    it('una segunda confirmación después de que la primera ya cerró el contrato responde 409 TERMINACION_YA_CONFIRMADA', async () => {
      const { access_token, contrato } =
        await prepararContratoConSolicitud('seq');

      await request(app.getHttpServer())
        .post(`/contratos/${contrato.id}/confirmar-terminacion-anticipada`)
        .set('Authorization', `Bearer ${access_token}`)
        .expect(HttpStatus.CREATED);

      const segunda = await request(app.getHttpServer())
        .post(`/contratos/${contrato.id}/confirmar-terminacion-anticipada`)
        .set('Authorization', `Bearer ${access_token}`)
        .expect(HttpStatus.CONFLICT);

      expect((segunda.body as CuerpoError).codigo).toBe(
        'TERMINACION_YA_CONFIRMADA',
      );
    });

    it('confirmar sin solicitud previa responde 409 TERMINACION_NO_SOLICITADA', async () => {
      const { access_token } = await registrarArrendador(
        app,
        'Arrendador Term Sin Solicitud',
        'term-sin-solicitud@correo.com',
      );
      const inmueble = await crearInmueble(app, access_token, 'TER-NOSOL');
      const inquilino = await crearInquilino(app, access_token);
      const contrato = await crearContrato(
        app,
        access_token,
        inmueble.unidades[0].id,
        inquilino.id,
      );

      const respuesta = await request(app.getHttpServer())
        .post(`/contratos/${contrato.id}/confirmar-terminacion-anticipada`)
        .set('Authorization', `Bearer ${access_token}`)
        .expect(HttpStatus.CONFLICT);

      expect((respuesta.body as CuerpoError).codigo).toBe(
        'TERMINACION_NO_SOLICITADA',
      );
    });

    it('confirmar con el contrato ya no activo responde 409 CONTRATO_NO_ACTIVO', async () => {
      const { access_token, contrato } =
        await prepararContratoConSolicitud('no-activo');

      await prisma.contrato.update({
        where: { id: contrato.id },
        data: { estado: EstadoContrato.VENCIDO },
      });

      const respuesta = await request(app.getHttpServer())
        .post(`/contratos/${contrato.id}/confirmar-terminacion-anticipada`)
        .set('Authorization', `Bearer ${access_token}`)
        .expect(HttpStatus.CONFLICT);

      expect((respuesta.body as CuerpoError).codigo).toBe('CONTRATO_NO_ACTIVO');
    });
  });

  // ------------------------------------------------------------------
  // B-36: cambiar el estado de una solicitud de mantenimiento
  // ------------------------------------------------------------------
  describe('PATCH /solicitudes-mantenimiento/:id/estado', () => {
    async function prepararSolicitudPendiente(sufijo: string): Promise<{
      access_token: string;
      inmueble: RespuestaCrearInmueble;
      solicitud: SolicitudCreada;
    }> {
      const { access_token } = await registrarArrendador(
        app,
        `Arrendador Manto ${sufijo}`,
        `manto-consist-${sufijo}@correo.com`,
      );
      const inmueble = await crearInmueble(app, access_token, `MAN-${sufijo}`);
      const inquilino = await crearInquilino(app, access_token);
      const contrato: RespuestaCrearContrato = await crearContrato(
        app,
        access_token,
        inmueble.unidades[0].id,
        inquilino.id,
      );
      const inquilinoToken = await autenticarInquilino(
        app,
        contrato.codigo_acceso?.codigo ?? '',
        `inquilino-manto-consist-${sufijo}@correo.com`,
      );

      const respuesta = await request(app.getHttpServer())
        .post('/solicitudes-mantenimiento')
        .set('Authorization', `Bearer ${inquilinoToken}`)
        .field('unidadId', inmueble.unidades[0].id)
        .field('descripcion', 'El calentador no enciende.')
        .field('urgencia', 'ALTO')
        .expect(HttpStatus.CREATED);

      return {
        access_token,
        inmueble,
        solicitud: respuesta.body as SolicitudCreada,
      };
    }

    it('dos cambios de estado simultáneos a EN_PROCESO: exactamente uno tiene éxito', async () => {
      const { access_token, solicitud } =
        await prepararSolicitudPendiente('race');

      const [r1, r2] = await Promise.all([
        request(app.getHttpServer())
          .patch(`/solicitudes-mantenimiento/${solicitud.id}/estado`)
          .set('Authorization', `Bearer ${access_token}`)
          .send({ estado: 'EN_PROCESO' }),
        request(app.getHttpServer())
          .patch(`/solicitudes-mantenimiento/${solicitud.id}/estado`)
          .set('Authorization', `Bearer ${access_token}`)
          .send({ estado: 'EN_PROCESO' }),
      ]);

      expect(contarStatus([r1, r2], HttpStatus.OK)).toBe(1);
      expect(contarStatus([r1, r2], HttpStatus.CONFLICT)).toBe(1);
      for (const respuesta of [r1, r2]) {
        expect(respuesta.status).not.toBe(500);
      }
      const perdedora = [r1, r2].find((r) => r.status === CONFLICTO);
      expect((perdedora?.body as CuerpoError).codigo).toBe(
        'TRANSICION_INVALIDA',
      );

      const enBd = await prisma.solicitudMantenimiento.findUnique({
        where: { id: solicitud.id },
      });
      expect(enBd?.estado).toBe(EstadoSolicitudMantenimiento.EN_PROCESO);
    });

    it('no permite salir de RESUELTO ni "cambiar" de EN_PROCESO a EN_PROCESO', async () => {
      const { access_token, solicitud } =
        await prepararSolicitudPendiente('reglas');

      await request(app.getHttpServer())
        .patch(`/solicitudes-mantenimiento/${solicitud.id}/estado`)
        .set('Authorization', `Bearer ${access_token}`)
        .send({ estado: 'EN_PROCESO' })
        .expect(HttpStatus.OK);

      const enProcesoOtraVez = await request(app.getHttpServer())
        .patch(`/solicitudes-mantenimiento/${solicitud.id}/estado`)
        .set('Authorization', `Bearer ${access_token}`)
        .send({ estado: 'EN_PROCESO' })
        .expect(HttpStatus.CONFLICT);
      expect((enProcesoOtraVez.body as CuerpoError).codigo).toBe(
        'TRANSICION_INVALIDA',
      );

      await request(app.getHttpServer())
        .patch(`/solicitudes-mantenimiento/${solicitud.id}/estado`)
        .set('Authorization', `Bearer ${access_token}`)
        .send({ estado: 'RESUELTO' })
        .expect(HttpStatus.OK);

      const salirDeResuelto = await request(app.getHttpServer())
        .patch(`/solicitudes-mantenimiento/${solicitud.id}/estado`)
        .set('Authorization', `Bearer ${access_token}`)
        .send({ estado: 'EN_PROCESO' })
        .expect(HttpStatus.CONFLICT);
      expect((salirDeResuelto.body as CuerpoError).codigo).toBe(
        'TRANSICION_INVALIDA',
      );
    });

    it('una segunda resolución después de que la primera ya la resolvió responde 409', async () => {
      const { access_token, solicitud } =
        await prepararSolicitudPendiente('seq');

      await request(app.getHttpServer())
        .patch(`/solicitudes-mantenimiento/${solicitud.id}/estado`)
        .set('Authorization', `Bearer ${access_token}`)
        .send({ estado: 'RESUELTO' })
        .expect(HttpStatus.OK);

      const segunda = await request(app.getHttpServer())
        .patch(`/solicitudes-mantenimiento/${solicitud.id}/estado`)
        .set('Authorization', `Bearer ${access_token}`)
        .send({ estado: 'RESUELTO' })
        .expect(HttpStatus.CONFLICT);

      expect((segunda.body as CuerpoError).codigo).toBe('TRANSICION_INVALIDA');
    });
  });
});
