import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AlertaSchedulerService } from '../src/alerta/alerta-scheduler.service';
import { AppModule } from '../src/app.module';
import { sumarDiasUTC } from '../src/common/fechas-contrato.util';
import { hoyEnBogota } from '../src/common/hoy-bogota.util';
import { configurarApp } from '../src/configurar-app';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  contratoValido,
  crearContrato,
  crearInmueble,
  crearInquilino,
  registrarArrendador,
  RespuestaCrearContrato,
} from './helpers/crear-datos.helper';
import { limpiarBd } from './helpers/limpiar-bd';

interface CuerpoError {
  codigo: string;
  mensaje: string;
  detalles?: { fecha_inicio: string; fecha_fin: string };
}

const CREADO: number = HttpStatus.CREATED;
const CONFLICTO: number = HttpStatus.CONFLICT;
const NO_ENCONTRADO: number = HttpStatus.NOT_FOUND;

const iso = (fecha: Date): string => fecha.toISOString().slice(0, 10);

describe('Contrato programado, traslape y cron de estados (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let scheduler: AlertaSchedulerService;
  let contador = 0;
  const hoy = hoyEnBogota();
  const dia = (n: number) => sumarDiasUTC(hoy, n);

  beforeEach(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await limpiarBd(prisma);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configurarApp(app);
    scheduler = moduleFixture.get(AlertaSchedulerService);
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

  async function preparar() {
    contador += 1;
    const { access_token, arrendador } = await registrarArrendador(
      app,
      `Arrendador ${contador}`,
      `prog-${contador}@correo.com`,
    );
    const inmueble = await crearInmueble(app, access_token, `PROG-${contador}`);
    const inquilino = await crearInquilino(app, access_token);
    return {
      token: access_token,
      arrendadorId: arrendador.id,
      unidadId: inmueble.unidades[0].id,
      inmuebleId: inmueble.id,
      inquilinoId: inquilino.id,
    };
  }

  const postContrato = (
    token: string,
    unidadId: string,
    inquilinoId: string,
    inicio: Date,
    fin: Date,
  ) =>
    request(app.getHttpServer())
      .post('/contratos')
      .set('Authorization', `Bearer ${token}`)
      .send(
        contratoValido(unidadId, inquilinoId, {
          fecha_inicio: iso(inicio),
          fecha_fin: iso(fin),
        }),
      );

  const estadoEnBd = async (id: string) =>
    (await prisma.contrato.findUniqueOrThrow({ where: { id } }))
      .estado as string;

  const codigo = (r: { body: unknown }) => (r.body as CuerpoError).codigo;

  // ------------------------------------------------------------------
  // TEST-FIRST
  // ------------------------------------------------------------------
  it('un contrato con fecha de inicio futura nace PROGRAMADO', async () => {
    const { token, unidadId, inquilinoId } = await preparar();

    const respuesta = await postContrato(
      token,
      unidadId,
      inquilinoId,
      dia(10),
      dia(375),
    ).expect(CREADO);

    expect((respuesta.body as RespuestaCrearContrato).estado).toBe(
      'PROGRAMADO',
    );
    expect(await prisma.codigoAcceso.count()).toBe(1);
    expect(await prisma.documentoContrato.count()).toBe(1);
  }, 30000);

  it('una unidad con contrato ACTIVO que termina el día X acepta uno PROGRAMADO desde X+1', async () => {
    const { token, unidadId, inquilinoId } = await preparar();
    await postContrato(token, unidadId, inquilinoId, dia(-30), dia(20)).expect(
      CREADO,
    );

    const siguiente = await postContrato(
      token,
      unidadId,
      inquilinoId,
      dia(21),
      dia(385),
    ).expect(CREADO);

    expect((siguiente.body as RespuestaCrearContrato).estado).toBe(
      'PROGRAMADO',
    );
  }, 30000);

  it('un contrato con inicio hoy o pasado sigue naciendo ACTIVO', async () => {
    const { token, unidadId, inquilinoId } = await preparar();
    const respuesta = await postContrato(
      token,
      unidadId,
      inquilinoId,
      hoy,
      dia(365),
    ).expect(CREADO);
    expect((respuesta.body as RespuestaCrearContrato).estado).toBe('ACTIVO');
  }, 30000);

  // ------------------------------------------------------------------
  // Traslape
  // ------------------------------------------------------------------
  it('rechaza rangos que se traslapan (inclusive) y acepta el día siguiente', async () => {
    const { token, unidadId, inquilinoId } = await preparar();
    await postContrato(token, unidadId, inquilinoId, dia(10), dia(40)).expect(
      CREADO,
    );

    const conflictos: Array<[string, Date, Date]> = [
      ['mismo rango', dia(10), dia(40)],
      ['inicio dentro del rango', dia(20), dia(80)],
      ['fin dentro del rango', dia(1), dia(20)],
      ['inicio = último día del anterior', dia(40), dia(100)],
      ['contiene al anterior', dia(1), dia(100)],
    ];
    for (const [descripcion, inicio, fin] of conflictos) {
      const respuesta = await postContrato(
        token,
        unidadId,
        inquilinoId,
        inicio,
        fin,
      );
      expect([descripcion, respuesta.status, codigo(respuesta)]).toEqual([
        descripcion,
        CONFLICTO,
        'TRASLAPE_DE_CONTRATOS',
      ]);
      expect((respuesta.body as CuerpoError).detalles).toEqual({
        fecha_inicio: iso(dia(10)),
        fecha_fin: iso(dia(40)),
      });
    }

    await postContrato(token, unidadId, inquilinoId, dia(41), dia(100)).expect(
      CREADO,
    );
    expect(await prisma.contrato.count()).toBe(2);
  }, 60000);

  it('con terminación anticipada confirmada, el hueco se libera desde la fecha efectiva + 1', async () => {
    const { token, unidadId, inquilinoId } = await preparar();
    const activo = await postContrato(
      token,
      unidadId,
      inquilinoId,
      dia(-30),
      dia(60),
    ).expect(CREADO);
    await prisma.contrato.update({
      where: { id: (activo.body as RespuestaCrearContrato).id },
      data: {
        terminacionAnticipadaSolicitada: true,
        terminacionAnticipadaSolicitadaPor: 'INQUILINO',
        terminacionAnticipadaConfirmadaEn: new Date(),
        terminacion_confirmada_por: 'ARRENDADOR',
        terminacion_fecha_efectiva: dia(20),
      },
    });

    const choca = await postContrato(
      token,
      unidadId,
      inquilinoId,
      dia(20),
      dia(90),
    );
    expect(choca.status).toBe(CONFLICTO);
    expect(codigo(choca)).toBe('TRASLAPE_DE_CONTRATOS');

    await postContrato(token, unidadId, inquilinoId, dia(21), dia(90)).expect(
      CREADO,
    );
  }, 60000);

  it('una terminación solo solicitada (sin confirmar) no libera el hueco', async () => {
    const { token, unidadId, inquilinoId } = await preparar();
    const activo = await postContrato(
      token,
      unidadId,
      inquilinoId,
      dia(-30),
      dia(60),
    ).expect(CREADO);
    await prisma.contrato.update({
      where: { id: (activo.body as RespuestaCrearContrato).id },
      data: {
        terminacionAnticipadaSolicitada: true,
        terminacionAnticipadaSolicitadaPor: 'INQUILINO',
        terminacion_fecha_efectiva: dia(20),
      },
    });

    const respuesta = await postContrato(
      token,
      unidadId,
      inquilinoId,
      dia(21),
      dia(90),
    );
    expect(respuesta.status).toBe(CONFLICTO);
    expect(codigo(respuesta)).toBe('TRASLAPE_DE_CONTRATOS');
  }, 60000);

  it('dos creaciones PROGRAMADO traslapadas y simultáneas: exactamente una gana', async () => {
    const { token, unidadId, inquilinoId } = await preparar();

    const respuestas = await Promise.all([
      postContrato(token, unidadId, inquilinoId, dia(10), dia(100)),
      postContrato(token, unidadId, inquilinoId, dia(50), dia(150)),
    ]);

    expect(respuestas.map((r) => r.status).sort()).toEqual([CREADO, CONFLICTO]);
    expect(codigo(respuestas.find((r) => r.status === CONFLICTO)!)).toBe(
      'TRASLAPE_DE_CONTRATOS',
    );
    expect(await prisma.contrato.count()).toBe(1);
  }, 60000);

  it('un contrato nuevo ACTIVO sobre uno ACTIVO conserva el 409 anterior', async () => {
    const { token, unidadId, inquilinoId } = await preparar();
    await postContrato(token, unidadId, inquilinoId, dia(-30), dia(60)).expect(
      CREADO,
    );

    const respuesta = await postContrato(
      token,
      unidadId,
      inquilinoId,
      dia(-5),
      dia(300),
    );

    expect(respuesta.status).toBe(CONFLICTO);
    expect((respuesta.body as CuerpoError).mensaje).toBe(
      'Esta unidad ya tiene un contrato activo',
    );
  }, 30000);

  // ------------------------------------------------------------------
  // Cancelar
  // ------------------------------------------------------------------
  it('cancelar-programado: PROGRAMADO → CANCELADO sin borrar nada; libera el rango; ACTIVO y ajeno no', async () => {
    const { token, unidadId, inquilinoId } = await preparar();
    const { access_token: otro } = await registrarArrendador(
      app,
      'Otro',
      'otro-prog@correo.com',
    );
    const programado = (
      await postContrato(
        token,
        unidadId,
        inquilinoId,
        dia(10),
        dia(100),
      ).expect(CREADO)
    ).body as RespuestaCrearContrato;
    const cancelar = (id: string, t: string) =>
      request(app.getHttpServer())
        .post(`/contratos/${id}/cancelar-programado`)
        .set('Authorization', `Bearer ${t}`);

    await cancelar(programado.id, otro).expect(NO_ENCONTRADO);
    expect(await estadoEnBd(programado.id)).toBe('PROGRAMADO');

    const respuesta = await cancelar(programado.id, token).expect(CREADO);
    const cuerpo = respuesta.body as { estado: string; cancelado_en: string };
    expect(cuerpo.estado).toBe('CANCELADO');
    expect(cuerpo.cancelado_en).toBeTruthy();
    expect(cuerpo).not.toHaveProperty('pdf_contrato_ruta');
    expect(await prisma.contrato.count()).toBe(1);
    expect(await prisma.codigoAcceso.count()).toBe(1);
    expect(await prisma.documentoContrato.count()).toBe(1);

    const otraVez = await cancelar(programado.id, token);
    expect(otraVez.status).toBe(CONFLICTO);
    expect(codigo(otraVez)).toBe('CONTRATO_NO_PROGRAMADO');

    // Un CANCELADO no cuenta para el traslape.
    const nuevo = await postContrato(
      token,
      unidadId,
      inquilinoId,
      dia(10),
      dia(100),
    ).expect(CREADO);
    expect((nuevo.body as RespuestaCrearContrato).estado).toBe('PROGRAMADO');

    // Un ACTIVO no se cancela por este endpoint.
    const activoUnidad = await crearInmueble(app, token, 'PROG-ACT');
    const activo = await crearContrato(
      app,
      token,
      activoUnidad.unidades[0].id,
      inquilinoId,
    );
    const sobreActivo = await cancelar(activo.id, token);
    expect(sobreActivo.status).toBe(CONFLICTO);
    expect(codigo(sobreActivo)).toBe('CONTRATO_NO_PROGRAMADO');
    expect(await estadoEnBd(activo.id)).toBe('ACTIVO');
  }, 60000);

  // ------------------------------------------------------------------
  // Cron de estados
  // ------------------------------------------------------------------
  describe('cron de estados', () => {
    async function programado(
      unidadId: string,
      inquilinoId: string,
      arrendadorId: string,
      inicio: Date,
      fin: Date,
    ) {
      return prisma.contrato.create({
        data: {
          arrendador_id: arrendadorId,
          unidad_id: unidadId,
          inquilino_id: inquilinoId,
          tipo_plantilla: 'VIVIENDA_URBANA_LEY_820',
          canon_centavos: 1_000_000,
          dia_pago: 5,
          forma_pago: 'Transferencia',
          datos_recaudo: 'Bancolombia 1',
          fecha_inicio: inicio,
          fecha_fin: fin,
          estado: 'PROGRAMADO',
        },
      });
    }

    it('activa un PROGRAMADO cuya fecha llegó y es idempotente; uno vencido sin activarse pasa a VENCIDO', async () => {
      const {
        token,
        unidadId,
        inquilinoId,
        arrendadorId: arr,
      } = await preparar();
      const futuro = await programado(
        unidadId,
        inquilinoId,
        arr,
        dia(5),
        dia(300),
      );
      const { unidadId: otraUnidad } = await (async () => {
        const inm = await crearInmueble(app, token, 'PROG-OTRA');
        return { unidadId: inm.unidades[0].id };
      })();
      const perdido = await programado(
        otraUnidad,
        inquilinoId,
        arr,
        dia(-40),
        dia(-10),
      );

      expect(
        await scheduler.ejecutarActivacionContratosProgramados(dia(4)),
      ).toEqual({ activados: 0, vencidos: 1, pendientes: 0 });
      expect(await estadoEnBd(futuro.id)).toBe('PROGRAMADO');
      expect(await estadoEnBd(perdido.id)).toBe('VENCIDO');

      await prisma.contrato.update({
        where: { id: futuro.id },
        data: { estado_pago: 'AL_DIA' },
      });
      const primera = await scheduler.ejecutarActivacionContratosProgramados(
        dia(5),
      );
      expect(primera).toEqual({ activados: 1, vencidos: 0, pendientes: 0 });
      expect(await estadoEnBd(futuro.id)).toBe('ACTIVO');

      const segunda = await scheduler.ejecutarActivacionContratosProgramados(
        dia(5),
      );
      expect(segunda).toEqual({ activados: 0, vencidos: 0, pendientes: 0 });
      expect(await estadoEnBd(futuro.id)).toBe('ACTIVO');
    }, 60000);

    it('con el contrato anterior aún ACTIVO no falla y el PROGRAMADO queda para la próxima corrida', async () => {
      const {
        token,
        unidadId,
        inquilinoId,
        arrendadorId: arr,
      } = await preparar();
      const anterior = await crearContrato(app, token, unidadId, inquilinoId, {
        fecha_inicio: iso(dia(-30)),
        fecha_fin: iso(dia(20)),
      });
      const siguiente = await programado(
        unidadId,
        inquilinoId,
        arr,
        dia(21),
        dia(300),
      );

      const resultado = await scheduler.ejecutarActivacionContratosProgramados(
        dia(21),
      );

      expect(resultado).toEqual({ activados: 0, vencidos: 0, pendientes: 1 });
      expect(await estadoEnBd(siguiente.id)).toBe('PROGRAMADO');
      expect(await estadoEnBd(anterior.id)).toBe('ACTIVO');
    }, 60000);

    it('el orden terminaciones → vencimiento → activación deja terminar un contrato y activar el siguiente en la misma corrida', async () => {
      const {
        token,
        unidadId,
        inquilinoId,
        arrendadorId: arr,
      } = await preparar();
      const anterior = await crearContrato(app, token, unidadId, inquilinoId, {
        fecha_inicio: iso(dia(-30)),
        fecha_fin: iso(dia(200)),
      });
      await prisma.contrato.update({
        where: { id: anterior.id },
        data: {
          terminacionAnticipadaSolicitada: true,
          terminacionAnticipadaSolicitadaPor: 'INQUILINO',
          terminacionAnticipadaConfirmadaEn: new Date(),
          terminacion_confirmada_por: 'ARRENDADOR',
          terminacion_fecha_efectiva: dia(20),
        },
      });
      const siguiente = await programado(
        unidadId,
        inquilinoId,
        arr,
        dia(21),
        dia(300),
      );

      await scheduler.ejecutarTransicionesDeEstado(dia(21));

      expect(await estadoEnBd(anterior.id)).toBe('TERMINADO_ANTICIPADAMENTE');
      expect(await estadoEnBd(siguiente.id)).toBe('ACTIVO');
    }, 60000);

    it('un PROGRAMADO no genera alertas ni cambia estado_pago con los crons de mora, recordatorio, IPC y vencimiento', async () => {
      const { unidadId, inquilinoId, arrendadorId: arr } = await preparar();
      const creado = await programado(
        unidadId,
        inquilinoId,
        arr,
        dia(10),
        dia(20),
      );
      await prisma.contrato.update({
        where: { id: creado.id },
        data: { estado_pago: 'AL_DIA' },
      });

      await scheduler.ejecutarInquilinoEnMora();
      await scheduler.ejecutarRecordatorioPago();
      await scheduler.ejecutarAjusteIpcPendiente();
      await scheduler.ejecutarVencimiento();
      await scheduler.ejecutarTransicionVencimiento();

      const enBd = await prisma.contrato.findUniqueOrThrow({
        where: { id: creado.id },
      });
      expect(enBd.estado).toBe('PROGRAMADO');
      expect(enBd.estado_pago).toBe('AL_DIA');
      expect(
        await prisma.alerta.count({ where: { contrato_id: creado.id } }),
      ).toBe(0);
    }, 60000);
  });

  // ------------------------------------------------------------------
  // Lectores del estado
  // ------------------------------------------------------------------
  describe('lectores del estado', () => {
    async function conContratoProgramado() {
      const base = await preparar();
      const creado = (
        await postContrato(
          base.token,
          base.unidadId,
          base.inquilinoId,
          dia(10),
          dia(375),
        ).expect(CREADO)
      ).body as RespuestaCrearContrato;
      const registro = await request(app.getHttpServer())
        .post('/auth/inquilino/completar-registro')
        .send({
          codigo: creado.codigo_acceso?.codigo,
          correo: `inq-prog-${contador}@correo.com`,
          contrasena: 'clave1234',
        });
      return { ...base, contrato: creado, registro };
    }

    it('el inquilino se vincula con el código de un PROGRAMADO; el panel no lo marca finalizado y no muestra datos de recaudo', async () => {
      const { registro, contrato } = await conContratoProgramado();
      expect(registro.status).toBe(HttpStatus.OK);
      const inq = (registro.body as { access_token: string }).access_token;

      const miContrato = await request(app.getHttpServer())
        .get('/inquilino/mi-contrato')
        .set('Authorization', `Bearer ${inq}`)
        .expect(HttpStatus.OK);
      expect(miContrato.body).toMatchObject({
        contratoId: contrato.id,
        datos_recaudo: null,
        programado: true,
        estado: 'PROGRAMADO',
      });

      const panel = await request(app.getHttpServer())
        .get('/inquilino/mi-panel')
        .set('Authorization', `Bearer ${inq}`)
        .expect(HttpStatus.OK);
      expect(panel.body).toMatchObject({
        contratoFinalizado: false,
        programado: true,
      });
      expect((panel.body as { fecha_inicio: string }).fecha_inicio).toContain(
        iso(dia(10)),
      );
      expect(panel.body).not.toHaveProperty('proximoPago');
    }, 60000);

    it('un código de un contrato CANCELADO no permite vincularse', async () => {
      const base = await preparar();
      const creado = (
        await postContrato(
          base.token,
          base.unidadId,
          base.inquilinoId,
          dia(10),
          dia(375),
        ).expect(CREADO)
      ).body as RespuestaCrearContrato;
      await request(app.getHttpServer())
        .post(`/contratos/${creado.id}/cancelar-programado`)
        .set('Authorization', `Bearer ${base.token}`)
        .expect(CREADO);

      const validar = await request(app.getHttpServer())
        .post('/auth/inquilino/validar-codigo')
        .send({ codigo: creado.codigo_acceso?.codigo });
      const completar = await request(app.getHttpServer())
        .post('/auth/inquilino/completar-registro')
        .send({
          codigo: creado.codigo_acceso?.codigo,
          correo: 'cancelado@correo.com',
          contrasena: 'clave1234',
        });

      expect(validar.status).toBe(CONFLICTO);
      expect(completar.status).toBe(CONFLICTO);
      expect(codigo(completar)).toBe('CONTRATO_CANCELADO');
    }, 60000);

    it('reportar pago o crear mantenimiento con un PROGRAMADO responde 409 CONTRATO_NO_ACTIVO sin decir "terminado"', async () => {
      const { registro, contrato, unidadId } = await conContratoProgramado();
      const inq = (registro.body as { access_token: string }).access_token;

      const pago = await request(app.getHttpServer())
        .post('/pagos')
        .set('Authorization', `Bearer ${inq}`)
        .field('contratoId', contrato.id)
        .field('monto_centavos', '1000000')
        .field('fecha_reportada', iso(hoy))
        .attach('comprobante', Buffer.from('comprobante'), {
          filename: 'c.png',
          contentType: 'image/png',
        });
      expect(pago.status).toBe(CONFLICTO);
      expect(codigo(pago)).toBe('CONTRATO_NO_ACTIVO');
      expect((pago.body as CuerpoError).mensaje).not.toMatch(/terminad|ya no/i);

      const manto = await request(app.getHttpServer())
        .post('/solicitudes-mantenimiento')
        .set('Authorization', `Bearer ${inq}`)
        .field('unidadId', unidadId)
        .field('descripcion', 'Fuga')
        .field('urgencia', 'ALTO');
      expect(manto.status).toBe(CONFLICTO);
      expect(codigo(manto)).toBe('CONTRATO_NO_ACTIVO');
      expect((manto.body as CuerpoError).mensaje).not.toMatch(
        /terminad|ya no/i,
      );
    }, 60000);

    it('la terminación anticipada exige un contrato ACTIVO: con PROGRAMADO responde 409 CONTRATO_NO_ACTIVO', async () => {
      const { token, contrato, registro } = await conContratoProgramado();
      const inq = (registro.body as { access_token: string }).access_token;

      const arrendador = await request(app.getHttpServer())
        .post(`/contratos/${contrato.id}/solicitar-terminacion-anticipada`)
        .set('Authorization', `Bearer ${token}`)
        .send({ motivo: 'x', fecha_efectiva: iso(dia(20)) });
      const inquilino = await request(app.getHttpServer())
        .post('/inquilino/mi-contrato/solicitar-terminacion-anticipada')
        .set('Authorization', `Bearer ${inq}`)
        .send({ motivo: 'x', fecha_efectiva: iso(dia(20)) });

      for (const respuesta of [arrendador, inquilino]) {
        expect(respuesta.status).toBe(CONFLICTO);
        expect(codigo(respuesta)).toBe('CONTRATO_NO_ACTIVO');
      }
    }, 60000);

    it('el bloqueo de cambio de tipo/uso de la unidad también aplica con un PROGRAMADO', async () => {
      const { token, inmuebleId, unidadId } = await conContratoProgramado();

      const respuesta = await request(app.getHttpServer())
        .patch(`/inmuebles/${inmuebleId}/unidades/${unidadId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ tipo: 'CASA' });

      expect(respuesta.status).toBe(CONFLICTO);
      expect(codigo(respuesta)).toBe('UNIDAD_CON_CONTRATO_ACTIVO');
    }, 60000);

    it('un contrato CANCELADO sigue impidiendo eliminar la unidad', async () => {
      const { token, inmuebleId, unidadId, contrato } =
        await conContratoProgramado();
      await request(app.getHttpServer())
        .post(`/contratos/${contrato.id}/cancelar-programado`)
        .set('Authorization', `Bearer ${token}`)
        .expect(CREADO);

      await request(app.getHttpServer())
        .delete(`/inmuebles/${inmuebleId}/unidades/${unidadId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(CONFLICTO);
      expect(await prisma.contrato.count()).toBe(1);
    }, 60000);
  });
});
