import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AlertaSchedulerService } from '../src/alerta/alerta-scheduler.service';
import { AppModule } from '../src/app.module';
import {
  sumarDiasUTC,
  sumarMesesUTC,
} from '../src/common/fechas-contrato.util';
import { hoyEnBogota } from '../src/common/hoy-bogota.util';
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

interface CuerpoError {
  codigo: string;
  mensaje: string;
}

interface Resumen {
  estado: string;
  solicitada_por: string | null;
  fecha_efectiva: string | null;
  confirmada_por: string | null;
  puede_confirmar: boolean;
  puede_cancelar: boolean;
}

interface PeriodoRespuesta {
  periodo: string;
  fechaLimite: string;
}

const CREADO: number = HttpStatus.CREATED;
const CONFLICTO: number = HttpStatus.CONFLICT;
const PROHIBIDO: number = HttpStatus.FORBIDDEN;
const NO_ENCONTRADO: number = HttpStatus.NOT_FOUND;
const NO_AUTORIZADO: number = HttpStatus.UNAUTHORIZED;
const SOLICITUD_INVALIDA: number = HttpStatus.BAD_REQUEST;

const iso = (fecha: Date): string => fecha.toISOString().slice(0, 10);

describe('Terminación anticipada por mutuo acuerdo (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let scheduler: AlertaSchedulerService;
  let contador = 0;

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

  async function preparar(
    opciones: { inicio?: Date; fin?: Date } = {},
  ): Promise<{
    arr: string;
    inq: string;
    contratoId: string;
    inicio: Date;
    fin: Date;
    arrendadorId: string;
  }> {
    contador += 1;
    const hoy = hoyEnBogota();
    const inicio = opciones.inicio ?? sumarMesesUTC(hoy, -4);
    const fin = opciones.fin ?? sumarMesesUTC(hoy, 8);
    const { access_token, arrendador } = await registrarArrendador(
      app,
      `Arrendador ${contador}`,
      `term-${contador}@correo.com`,
    );
    const inmueble = await crearInmueble(app, access_token, `TERM-${contador}`);
    const inquilino = await crearInquilino(app, access_token);
    const contrato = await crearContrato(
      app,
      access_token,
      inmueble.unidades[0].id,
      inquilino.id,
      { fecha_inicio: iso(inicio), fecha_fin: iso(fin) },
    );
    const inq = await autenticarInquilino(
      app,
      contrato.codigo_acceso?.codigo ?? '',
      `inq-term-${contador}@correo.com`,
    );
    return {
      arr: access_token,
      inq,
      contratoId: contrato.id,
      inicio,
      fin,
      arrendadorId: arrendador.id,
    };
  }

  const solicitarArr = (
    t: string,
    id: string,
    fecha: Date,
    motivo = 'Acuerdo',
  ) =>
    request(app.getHttpServer())
      .post(`/contratos/${id}/solicitar-terminacion-anticipada`)
      .set('Authorization', `Bearer ${t}`)
      .send({ motivo, fecha_efectiva: iso(fecha) });
  const confirmarArr = (t: string, id: string) =>
    request(app.getHttpServer())
      .post(`/contratos/${id}/confirmar-terminacion-anticipada`)
      .set('Authorization', `Bearer ${t}`);
  const cancelarArr = (t: string, id: string) =>
    request(app.getHttpServer())
      .post(`/contratos/${id}/cancelar-terminacion-anticipada`)
      .set('Authorization', `Bearer ${t}`);
  const solicitarInq = (t: string, fecha: Date, motivo = 'Me mudo') =>
    request(app.getHttpServer())
      .post('/inquilino/mi-contrato/solicitar-terminacion-anticipada')
      .set('Authorization', `Bearer ${t}`)
      .send({ motivo, fecha_efectiva: iso(fecha) });
  const confirmarInq = (t: string) =>
    request(app.getHttpServer())
      .post('/inquilino/mi-contrato/confirmar-terminacion-anticipada')
      .set('Authorization', `Bearer ${t}`);
  const cancelarInq = (t: string) =>
    request(app.getHttpServer())
      .post('/inquilino/mi-contrato/cancelar-terminacion-anticipada')
      .set('Authorization', `Bearer ${t}`);

  const codigo = (r: { body: unknown }) => (r.body as CuerpoError).codigo;
  const contratoEnBd = (id: string) =>
    prisma.contrato.findUniqueOrThrow({ where: { id } });

  // ------------------------------------------------------------------
  // TEST-FIRST
  // ------------------------------------------------------------------
  it('el arrendador que solicitó no puede confirmar su propia solicitud', async () => {
    const { arr, contratoId } = await preparar();
    await solicitarArr(arr, contratoId, hoyEnBogota()).expect(CREADO);

    const respuesta = await confirmarArr(arr, contratoId);

    expect(respuesta.status).toBe(PROHIBIDO);
    expect(codigo(respuesta)).toBe('NO_PUEDE_CONFIRMAR_SU_PROPIA_SOLICITUD');
    expect((await contratoEnBd(contratoId)).estado).toBe('ACTIVO');
  }, 30000);

  it('un contrato terminado (histórico, sin fecha efectiva) no tiene períodos posteriores a su confirmación', async () => {
    const hoy = hoyEnBogota();
    const { arr, contratoId } = await preparar({
      inicio: sumarMesesUTC(hoy, -6),
    });
    const confirmadaEn = new Date(
      sumarMesesUTC(hoy, -3).getTime() + 15 * 3600_000,
    );
    await prisma.contrato.update({
      where: { id: contratoId },
      data: {
        estado: 'TERMINADO_ANTICIPADAMENTE',
        terminacionAnticipadaSolicitada: true,
        terminacionAnticipadaSolicitadaPor: 'ARRENDADOR',
        terminacionAnticipadaConfirmadaEn: confirmadaEn,
      },
    });

    const respuesta = await request(app.getHttpServer())
      .get(`/contratos/${contratoId}/estado-cuenta`)
      .set('Authorization', `Bearer ${arr}`)
      .expect(HttpStatus.OK);
    const periodos = (respuesta.body as { periodos: PeriodoRespuesta[] })
      .periodos;

    // Inicio hace 6 meses y tope hace 3: los períodos que empiezan hasta el
    // tope son 4 (sin tope serían 7).
    expect(periodos).toHaveLength(4);
  }, 30000);

  it('un contrato terminado con fecha efectiva pasada no tiene períodos posteriores a ella', async () => {
    const hoy = hoyEnBogota();
    const { arr, contratoId } = await preparar({
      inicio: sumarMesesUTC(hoy, -6),
    });
    const efectiva = sumarMesesUTC(hoy, -3);
    await prisma.contrato.update({
      where: { id: contratoId },
      data: {
        estado: 'TERMINADO_ANTICIPADAMENTE',
        terminacionAnticipadaSolicitada: true,
        terminacionAnticipadaSolicitadaPor: 'INQUILINO',
        terminacionAnticipadaConfirmadaEn: new Date(),
        terminacion_confirmada_por: 'ARRENDADOR',
        terminacion_fecha_efectiva: efectiva,
      },
    });

    const respuesta = await request(app.getHttpServer())
      .get(`/contratos/${contratoId}/estado-cuenta`)
      .set('Authorization', `Bearer ${arr}`)
      .expect(HttpStatus.OK);
    const periodos = (respuesta.body as { periodos: PeriodoRespuesta[] })
      .periodos;

    expect(periodos).toHaveLength(4);
  }, 30000);

  // ------------------------------------------------------------------
  // Flujos de mutuo acuerdo
  // ------------------------------------------------------------------
  it('inquilino solicita → arrendador confirma → TERMINADO_ANTICIPADAMENTE (fecha efectiva hoy)', async () => {
    const { arr, inq, contratoId } = await preparar();
    const hoy = hoyEnBogota();

    const solicitud = await solicitarInq(inq, hoy).expect(CREADO);
    const cuerpo = solicitud.body as {
      terminacion_anticipada: Resumen;
      pdf_contrato_ruta?: string;
    };
    expect(cuerpo.terminacion_anticipada).toMatchObject({
      estado: 'SOLICITADA',
      solicitada_por: 'INQUILINO',
      puede_confirmar: false,
      puede_cancelar: true,
    });
    expect(cuerpo).not.toHaveProperty('pdf_contrato_ruta');

    const confirmada = await confirmarArr(arr, contratoId).expect(CREADO);
    expect(
      (confirmada.body as { terminacion_anticipada: Resumen })
        .terminacion_anticipada,
    ).toMatchObject({ estado: 'CONFIRMADA', confirmada_por: 'ARRENDADOR' });

    const enBd = await contratoEnBd(contratoId);
    expect(enBd.estado).toBe('TERMINADO_ANTICIPADAMENTE');
    expect(enBd.terminacion_confirmada_por).toBe('ARRENDADOR');
    expect(enBd.terminacion_fecha_efectiva).toEqual(hoy);
  }, 30000);

  it('arrendador solicita → inquilino confirma → TERMINADO_ANTICIPADAMENTE', async () => {
    const { arr, inq, contratoId } = await preparar();

    await solicitarArr(arr, contratoId, hoyEnBogota()).expect(CREADO);
    await confirmarInq(inq).expect(CREADO);

    const enBd = await contratoEnBd(contratoId);
    expect(enBd.estado).toBe('TERMINADO_ANTICIPADAMENTE');
    expect(enBd.terminacion_confirmada_por).toBe('INQUILINO');
  }, 30000);

  it('el inquilino tampoco puede confirmar su propia solicitud', async () => {
    const { inq } = await preparar();
    await solicitarInq(inq, hoyEnBogota()).expect(CREADO);

    const respuesta = await confirmarInq(inq);

    expect(respuesta.status).toBe(PROHIBIDO);
    expect(codigo(respuesta)).toBe('NO_PUEDE_CONFIRMAR_SU_PROPIA_SOLICITUD');
  }, 30000);

  it('fecha efectiva futura: al confirmar sigue ACTIVO; el cron la aplica al llegar la fecha, recalcula estado_pago y es idempotente', async () => {
    const { arr, inq, contratoId } = await preparar();
    const hoy = hoyEnBogota();
    const futura = sumarDiasUTC(hoy, 20);

    await solicitarArr(arr, contratoId, futura).expect(CREADO);
    await confirmarInq(inq).expect(CREADO);

    let enBd = await contratoEnBd(contratoId);
    expect(enBd.estado).toBe('ACTIVO');
    expect(enBd.terminacionAnticipadaConfirmadaEn).not.toBeNull();
    expect(enBd.terminacion_fecha_efectiva).toEqual(futura);
    expect(await scheduler.ejecutarTerminacionesProgramadas(hoy)).toEqual({
      aplicadas: 0,
    });
    expect((await contratoEnBd(contratoId)).estado).toBe('ACTIVO');

    await prisma.contrato.update({
      where: { id: contratoId },
      data: { estado_pago: 'AL_DIA' },
    });
    expect(await scheduler.ejecutarTerminacionesProgramadas(futura)).toEqual({
      aplicadas: 1,
    });
    enBd = await contratoEnBd(contratoId);
    expect(enBd.estado).toBe('TERMINADO_ANTICIPADAMENTE');
    expect(enBd.estado_pago).toBe('EN_MORA');

    expect(await scheduler.ejecutarTerminacionesProgramadas(futura)).toEqual({
      aplicadas: 0,
    });
    expect(await contratoEnBd(contratoId)).toEqual(enBd);
  }, 30000);

  it('el resumen aparece en el detalle del arrendador y en mi-contrato del inquilino', async () => {
    const { arr, inq, contratoId } = await preparar();
    await solicitarInq(inq, hoyEnBogota()).expect(CREADO);

    const detalle = await request(app.getHttpServer())
      .get(`/contratos/${contratoId}`)
      .set('Authorization', `Bearer ${arr}`)
      .expect(HttpStatus.OK);
    const cuerpoDetalle = detalle.body as {
      terminacion_anticipada: Resumen;
      terminacionAnticipadaSolicitada: boolean;
    };
    expect(cuerpoDetalle.terminacionAnticipadaSolicitada).toBe(true);
    expect(cuerpoDetalle.terminacion_anticipada).toMatchObject({
      estado: 'SOLICITADA',
      solicitada_por: 'INQUILINO',
      puede_confirmar: true,
      puede_cancelar: false,
    });

    const miContrato = await request(app.getHttpServer())
      .get('/inquilino/mi-contrato')
      .set('Authorization', `Bearer ${inq}`)
      .expect(HttpStatus.OK);
    expect(
      (miContrato.body as { terminacion_anticipada: Resumen })
        .terminacion_anticipada,
    ).toMatchObject({
      estado: 'SOLICITADA',
      puede_confirmar: false,
      puede_cancelar: true,
    });
  }, 30000);

  // ------------------------------------------------------------------
  // Cancelación
  // ------------------------------------------------------------------
  it('el solicitante cancela; la contraparte no puede; una confirmada no se puede cancelar', async () => {
    const { arr, inq, contratoId } = await preparar();
    const hoy = hoyEnBogota();

    expect(codigo(await cancelarInq(inq))).toBe('TERMINACION_NO_SOLICITADA');

    await solicitarInq(inq, hoy).expect(CREADO);
    const ajena = await cancelarArr(arr, contratoId);
    expect(ajena.status).toBe(PROHIBIDO);
    expect(codigo(ajena)).toBe('NO_PUEDE_CANCELAR_SOLICITUD_AJENA');

    const propia = await cancelarInq(inq).expect(CREADO);
    expect(
      (propia.body as { terminacion_anticipada: Resumen })
        .terminacion_anticipada.estado,
    ).toBe('NINGUNA');
    const limpio = await contratoEnBd(contratoId);
    expect(limpio.terminacionAnticipadaSolicitada).toBe(false);
    expect(limpio.terminacionAnticipadaMotivo).toBeNull();
    expect(limpio.terminacion_fecha_efectiva).toBeNull();

    // Puede solicitarse de nuevo tras cancelar.
    await solicitarArr(arr, contratoId, sumarDiasUTC(hoy, 5)).expect(CREADO);
    await confirmarInq(inq).expect(CREADO);
    const tarde = await cancelarArr(arr, contratoId);
    expect(tarde.status).toBe(CONFLICTO);
    expect(codigo(tarde)).toBe('TERMINACION_YA_CONFIRMADA');
  }, 60000);

  // ------------------------------------------------------------------
  // Validaciones
  // ------------------------------------------------------------------
  it('fecha efectiva anterior a hoy, posterior al fin o anterior al inicio → 400 FECHA_EFECTIVA_INVALIDA', async () => {
    const hoy = hoyEnBogota();
    const { arr, inq, contratoId, fin } = await preparar();

    for (const fecha of [sumarDiasUTC(hoy, -1), sumarDiasUTC(fin, 1)]) {
      const respuesta = await solicitarArr(arr, contratoId, fecha);
      expect(respuesta.status).toBe(SOLICITUD_INVALIDA);
      expect(codigo(respuesta)).toBe('FECHA_EFECTIVA_INVALIDA');
    }
    const deInquilino = await solicitarInq(inq, sumarDiasUTC(hoy, -1));
    expect(deInquilino.status).toBe(SOLICITUD_INVALIDA);
    expect(codigo(deInquilino)).toBe('FECHA_EFECTIVA_INVALIDA');

    // Un ACTIVO siempre empezó; si por datos su inicio fuera futuro, la fecha
    // efectiva no puede ser anterior a él. (Un contrato con inicio futuro nace
    // PROGRAMADO y no admite terminación: B-41.)
    const futuro = await preparar();
    await prisma.contrato.update({
      where: { id: futuro.contratoId },
      data: { fecha_inicio: sumarDiasUTC(hoy, 30) },
    });
    const antesDelInicio = await solicitarArr(
      futuro.arr,
      futuro.contratoId,
      sumarDiasUTC(hoy, 5),
    );
    expect(antesDelInicio.status).toBe(SOLICITUD_INVALIDA);
    expect(codigo(antesDelInicio)).toBe('FECHA_EFECTIVA_INVALIDA');

    expect(
      (await contratoEnBd(contratoId)).terminacionAnticipadaSolicitada,
    ).toBe(false);
  }, 60000);

  it('sin fecha efectiva o sin motivo → 400', async () => {
    const { arr, contratoId } = await preparar();
    await request(app.getHttpServer())
      .post(`/contratos/${contratoId}/solicitar-terminacion-anticipada`)
      .set('Authorization', `Bearer ${arr}`)
      .send({ motivo: 'Acuerdo' })
      .expect(SOLICITUD_INVALIDA);
    await request(app.getHttpServer())
      .post(`/contratos/${contratoId}/solicitar-terminacion-anticipada`)
      .set('Authorization', `Bearer ${arr}`)
      .send({ fecha_efectiva: iso(hoyEnBogota()) })
      .expect(SOLICITUD_INVALIDA);
  }, 30000);

  it('un contrato no activo responde 409 CONTRATO_NO_ACTIVO al solicitar; una solicitud vigente, 409 TERMINACION_YA_SOLICITADA', async () => {
    const { arr, inq, contratoId } = await preparar();
    const hoy = hoyEnBogota();

    await solicitarArr(arr, contratoId, hoy).expect(CREADO);
    const doble = await solicitarInq(inq, hoy);
    expect(doble.status).toBe(CONFLICTO);
    expect(codigo(doble)).toBe('TERMINACION_YA_SOLICITADA');

    await prisma.contrato.update({
      where: { id: contratoId },
      data: { estado: 'VENCIDO' },
    });
    const inactivo = await solicitarArr(arr, contratoId, hoy);
    expect(inactivo.status).toBe(CONFLICTO);
    expect(codigo(inactivo)).toBe('CONTRATO_NO_ACTIVO');
  }, 30000);

  // ------------------------------------------------------------------
  // Concurrencia
  // ------------------------------------------------------------------
  it('dos confirmaciones simultáneas: exactamente una gana', async () => {
    const { arr, contratoId, inq } = await preparar();
    await solicitarInq(inq, hoyEnBogota()).expect(CREADO);

    const respuestas = await Promise.all([
      confirmarArr(arr, contratoId),
      confirmarArr(arr, contratoId),
    ]);

    expect(respuestas.map((r) => r.status).sort()).toEqual([CREADO, CONFLICTO]);
    expect(codigo(respuestas.find((r) => r.status === CONFLICTO)!)).toBe(
      'TERMINACION_YA_CONFIRMADA',
    );
  }, 30000);

  it('solicitudes simultáneas de arrendador e inquilino: exactamente una gana', async () => {
    const { arr, inq, contratoId } = await preparar();
    const hoy = hoyEnBogota();

    const respuestas = await Promise.all([
      solicitarArr(arr, contratoId, hoy),
      solicitarInq(inq, hoy),
    ]);

    expect(respuestas.map((r) => r.status).sort()).toEqual([CREADO, CONFLICTO]);
    expect(codigo(respuestas.find((r) => r.status === CONFLICTO)!)).toBe(
      'TERMINACION_YA_SOLICITADA',
    );
  }, 30000);

  it('cancelar y confirmar simultáneos: exactamente uno gana', async () => {
    const { arr, inq, contratoId } = await preparar();
    await solicitarInq(inq, hoyEnBogota()).expect(CREADO);

    const [cancelar, confirmar] = await Promise.all([
      cancelarInq(inq),
      confirmarArr(arr, contratoId),
    ]);

    const exitos = [cancelar, confirmar].filter((r) => r.status === CREADO);
    expect(exitos).toHaveLength(1);
    const perdedora = cancelar.status === CREADO ? confirmar : cancelar;
    expect(perdedora.status).toBe(CONFLICTO);
    expect([
      'TERMINACION_NO_SOLICITADA',
      'TERMINACION_YA_CONFIRMADA',
    ]).toContain(codigo(perdedora));
  }, 30000);

  // ------------------------------------------------------------------
  // Autorización
  // ------------------------------------------------------------------
  it('recurso ajeno o inexistente → 404; el token del otro rol → 401', async () => {
    const { arr, inq, contratoId } = await preparar();
    const { access_token: otro } = await registrarArrendador(
      app,
      'Otro',
      'otro-term@correo.com',
    );
    const hoy = hoyEnBogota();

    await solicitarArr(otro, contratoId, hoy).expect(NO_ENCONTRADO);
    await confirmarArr(otro, contratoId).expect(NO_ENCONTRADO);
    await cancelarArr(otro, contratoId).expect(NO_ENCONTRADO);
    await solicitarArr(arr, '00000000-0000-4000-8000-000000000000', hoy).expect(
      NO_ENCONTRADO,
    );
    await confirmarArr(arr, 'no-es-un-id').expect(NO_ENCONTRADO);

    await solicitarArr(inq, contratoId, hoy).expect(NO_AUTORIZADO);
    await confirmarArr(inq, contratoId).expect(NO_AUTORIZADO);
    await cancelarArr(inq, contratoId).expect(NO_AUTORIZADO);
    await solicitarInq(arr, hoy).expect(NO_AUTORIZADO);
    await confirmarInq(arr).expect(NO_AUTORIZADO);
    await cancelarInq(arr).expect(NO_AUTORIZADO);
    expect(
      (await contratoEnBd(contratoId)).terminacionAnticipadaSolicitada,
    ).toBe(false);
  }, 60000);

  // ------------------------------------------------------------------
  // Alertas
  // ------------------------------------------------------------------
  it('crea alertas al arrendador cuando el INQUILINO solicita, cancela o confirma; no cuando actúa el arrendador', async () => {
    const { arr, inq, contratoId, arrendadorId } = await preparar();
    const hoy = hoyEnBogota();
    const tipos = async () =>
      (
        await prisma.alerta.findMany({
          where: {
            arrendador_id: arrendadorId,
            contrato_id: contratoId,
            // La alerta de vinculación del registro del inquilino es aparte.
            tipo: { not: 'CONTRATO_VINCULADO_POR_INQUILINO' },
          },
          orderBy: { creado_en: 'asc' },
        })
      ).map((a) => a.tipo as string);

    await solicitarArr(arr, contratoId, hoy).expect(CREADO);
    await cancelarArr(arr, contratoId).expect(CREADO);
    expect(await tipos()).toEqual([]);

    await solicitarInq(inq, sumarDiasUTC(hoy, 3)).expect(CREADO);
    await cancelarInq(inq).expect(CREADO);
    await solicitarArr(arr, contratoId, sumarDiasUTC(hoy, 3)).expect(CREADO);
    await confirmarInq(inq).expect(CREADO);

    expect(await tipos()).toEqual([
      'TERMINACION_ANTICIPADA_SOLICITADA',
      'TERMINACION_ANTICIPADA_CANCELADA',
      'TERMINACION_ANTICIPADA_CONFIRMADA',
    ]);
  }, 60000);
});
