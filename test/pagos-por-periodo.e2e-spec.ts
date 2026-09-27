import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { AlertaSchedulerService } from '../src/alerta/alerta-scheduler.service';
import { configurarApp } from '../src/configurar-app';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  autenticarInquilino,
  crearContrato,
  crearInmueble,
  crearInquilino,
  registrarArrendador,
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

interface PeriodoRespuesta {
  periodo: string;
  fechaLimite: string;
  canonVigenteCentavos: number;
  estado: string;
  montoAprobadoCentavos: number;
}

interface RespuestaEstadoCuenta {
  estadoPago: 'al_dia' | 'en_mora' | 'pendiente';
  periodos: PeriodoRespuesta[];
}

function formatearFechaLocal(fecha: Date): string {
  const anio = fecha.getFullYear();
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${anio}-${mes}-${dia}`;
}

function hoyLocal(): Date {
  return new Date();
}

function sumarDiasLocal(base: Date, dias: number): Date {
  const copia = new Date(base);
  copia.setDate(copia.getDate() + dias);
  return copia;
}

describe('Pagos por período (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let alertaScheduler: AlertaSchedulerService;

  beforeEach(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await limpiarBd(prisma);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configurarApp(app);
    alertaScheduler = moduleFixture.get(AlertaSchedulerService);
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

  async function reportarPago(
    token: string,
    contratoId: string,
    opciones: {
      montoCentavos?: number;
      fechaReportada?: string;
      periodo?: string;
    } = {},
  ) {
    const peticion = request(app.getHttpServer())
      .post('/pagos')
      .set('Authorization', `Bearer ${token}`)
      .field('contratoId', contratoId)
      .field('monto_centavos', String(opciones.montoCentavos ?? 1_000_000))
      .field(
        'fecha_reportada',
        opciones.fechaReportada ?? formatearFechaLocal(hoyLocal()),
      );
    if (opciones.periodo) {
      peticion.field('periodo', opciones.periodo);
    }
    return peticion.attach(
      'comprobante',
      Buffer.from('comprobante de prueba'),
      {
        filename: 'comprobante.png',
        contentType: 'image/png',
      },
    );
  }

  async function prepararContrato(
    sufijo: string,
    overrides: Record<string, unknown>,
  ): Promise<{
    access_token: string;
    inmueble: RespuestaCrearInmueble;
    contrato: RespuestaCrearContrato;
    inquilinoToken: string;
  }> {
    const { access_token } = await registrarArrendador(
      app,
      `Arrendador ${sufijo}`,
      `periodo-${sufijo}@correo.com`,
    );
    const inmueble = await crearInmueble(app, access_token, `PER-${sufijo}`);
    const inquilino = await crearInquilino(app, access_token);
    const contrato = await crearContrato(
      app,
      access_token,
      inmueble.unidades[0].id,
      inquilino.id,
      overrides,
    );
    const inquilinoToken = await autenticarInquilino(
      app,
      contrato.codigo_acceso?.codigo ?? '',
      `inquilino-periodo-${sufijo}@correo.com`,
    );
    return { access_token, inmueble, contrato, inquilinoToken };
  }

  // ------------------------------------------------------------------
  // B-05a: un pago anticipado (reportado y aprobado antes de la fecha
  // límite) no genera mora.
  // ------------------------------------------------------------------
  it('un pago anticipado aprobado no entra en mora tras correr el cron', async () => {
    const hoy = hoyLocal();
    const { access_token, contrato, inquilinoToken } = await prepararContrato(
      'anticipado',
      { fecha_inicio: formatearFechaLocal(hoy) },
    );

    const pago = await reportarPago(inquilinoToken, contrato.id).then(
      (r) => r.body as { id: string },
    );

    await request(app.getHttpServer())
      .patch(`/pagos/${pago.id}/aprobar`)
      .set('Authorization', `Bearer ${access_token}`)
      .expect(HttpStatus.OK);

    await alertaScheduler.ejecutarInquilinoEnMora();

    const contratoEnBd = await prisma.contrato.findUnique({
      where: { id: contrato.id },
    });
    expect(contratoEnBd?.estado_pago).toBe('AL_DIA');

    const alerta = await prisma.alerta.findFirst({
      where: { tipo: 'INQUILINO_EN_MORA', contrato_id: contrato.id },
    });
    expect(alerta).toBeNull();
  });

  // ------------------------------------------------------------------
  // B-05b: un contrato recién creado no entra en mora el primer día.
  // ------------------------------------------------------------------
  it('un contrato nuevo sin pagos no entra en mora el primer día', async () => {
    const hoy = hoyLocal();
    const { contrato } = await prepararContrato('nuevo', {
      fecha_inicio: formatearFechaLocal(hoy),
    });

    await alertaScheduler.ejecutarInquilinoEnMora();

    // El único período generado está PENDIENTE (aún no vence, ninguno se ha
    // pagado ni revisado), así que el estado derivado del contrato sigue
    // siendo PENDIENTE (regla 7.2: "aún no vence ningún período, contrato
    // recién iniciado") — nunca EN_MORA el primer día.
    const contratoEnBd = await prisma.contrato.findUnique({
      where: { id: contrato.id },
    });
    expect(contratoEnBd?.estado_pago).not.toBe('EN_MORA');
    expect(contratoEnBd?.estado_pago).toBe('PENDIENTE');

    const alerta = await prisma.alerta.findFirst({
      where: { tipo: 'INQUILINO_EN_MORA', contrato_id: contrato.id },
    });
    expect(alerta).toBeNull();
  });

  // ------------------------------------------------------------------
  // B-06: el recordatorio de pago ignora un período ya cubierto.
  // ------------------------------------------------------------------
  it('el recordatorio de pago no se crea si el período próximo ya está pagado', async () => {
    const hoy = hoyLocal();
    const fechaLimiteObjetivo = sumarDiasLocal(hoy, 2);
    const diaPago = fechaLimiteObjetivo.getDate();

    const { access_token, contrato, inquilinoToken } = await prepararContrato(
      'recordatorio',
      { fecha_inicio: formatearFechaLocal(hoy), dia_pago: diaPago },
    );

    const pago = await reportarPago(inquilinoToken, contrato.id).then(
      (r) => r.body as { id: string },
    );
    await request(app.getHttpServer())
      .patch(`/pagos/${pago.id}/aprobar`)
      .set('Authorization', `Bearer ${access_token}`)
      .expect(HttpStatus.OK);

    await alertaScheduler.ejecutarRecordatorioPago();

    const alerta = await prisma.alerta.findFirst({
      where: { tipo: 'RECORDATORIO_PAGO_PROXIMO', contrato_id: contrato.id },
    });
    expect(alerta).toBeNull();
  });

  // ------------------------------------------------------------------
  // Reemplazo automático por período: dos períodos distintos reportados
  // el mismo día no se reemplazan entre sí.
  // ------------------------------------------------------------------
  it('dos pagos de períodos distintos reportados el mismo día no se reemplazan', async () => {
    const hoy = hoyLocal();
    const fechaInicio = sumarDiasLocal(hoy, -65);
    const { access_token, contrato, inquilinoToken } = await prepararContrato(
      'dos-periodos',
      { fecha_inicio: formatearFechaLocal(fechaInicio), dia_pago: 5 },
    );

    const estadoCuentaInicial = await request(app.getHttpServer())
      .get(`/contratos/${contrato.id}/estado-cuenta`)
      .set('Authorization', `Bearer ${access_token}`)
      .expect(HttpStatus.OK);
    const periodos = (estadoCuentaInicial.body as RespuestaEstadoCuenta)
      .periodos;
    expect(periodos.length).toBeGreaterThanOrEqual(2);

    const pago1 = await reportarPago(inquilinoToken, contrato.id).then(
      (r) => r.body as { id: string; estado: string },
    );
    const pago2 = await reportarPago(inquilinoToken, contrato.id, {
      periodo: periodos[1].periodo,
    }).then((r) => r.body as { id: string; estado: string });

    expect(pago1.estado).toBe('PENDIENTE');
    expect(pago2.estado).toBe('PENDIENTE');

    const pagosEnBd = await prisma.pago.findMany({
      where: { contrato_id: contrato.id },
    });
    expect(pagosEnBd).toHaveLength(2);
    expect(pagosEnBd.every((p) => p.estado === 'PENDIENTE')).toBe(true);
  });

  // ------------------------------------------------------------------
  // Aprobar un pago parcial no pone el contrato al día.
  // ------------------------------------------------------------------
  it('aprobar un pago parcial deja el período PARCIAL y el contrato EN_MORA', async () => {
    const hoy = hoyLocal();
    const fechaInicio = sumarDiasLocal(hoy, -40);
    const { access_token, contrato, inquilinoToken } = await prepararContrato(
      'parcial',
      {
        fecha_inicio: formatearFechaLocal(fechaInicio),
        dia_pago: fechaInicio.getDate(),
      },
    );

    const estadoCuentaInicial = await request(app.getHttpServer())
      .get(`/contratos/${contrato.id}/estado-cuenta`)
      .set('Authorization', `Bearer ${access_token}`)
      .expect(HttpStatus.OK);
    const primerPeriodo = (estadoCuentaInicial.body as RespuestaEstadoCuenta)
      .periodos[0];
    expect(primerPeriodo.estado).toBe('VENCIDO');

    const pago = await reportarPago(inquilinoToken, contrato.id, {
      montoCentavos: 400_000,
      periodo: primerPeriodo.periodo,
    }).then((r) => r.body as { id: string });

    await request(app.getHttpServer())
      .patch(`/pagos/${pago.id}/aprobar`)
      .set('Authorization', `Bearer ${access_token}`)
      .expect(HttpStatus.OK);

    const contratoEnBd = await prisma.contrato.findUnique({
      where: { id: contrato.id },
    });
    expect(contratoEnBd?.estado_pago).toBe('EN_MORA');

    const estadoCuentaFinal = await request(app.getHttpServer())
      .get(`/contratos/${contrato.id}/estado-cuenta`)
      .set('Authorization', `Bearer ${access_token}`)
      .expect(HttpStatus.OK);
    const periodoActualizado = (estadoCuentaFinal.body as RespuestaEstadoCuenta)
      .periodos[0];
    expect(periodoActualizado.estado).toBe('PARCIAL');
    expect(periodoActualizado.montoAprobadoCentavos).toBe(400_000);
  });

  // ------------------------------------------------------------------
  // B-38: con el contrato ya no activo, se puede reportar un pago de un
  // período que quedó VENCIDO/PARCIAL, y se rechaza cualquier otro caso.
  // ------------------------------------------------------------------
  it('B-38: contrato terminado permite reportar un período vencido explícito, no uno implícito', async () => {
    const hoy = hoyLocal();
    const fechaInicio = sumarDiasLocal(hoy, -40);
    const { access_token, contrato, inquilinoToken } = await prepararContrato(
      'b38',
      {
        fecha_inicio: formatearFechaLocal(fechaInicio),
        dia_pago: fechaInicio.getDate(),
      },
    );

    const estadoCuenta = await request(app.getHttpServer())
      .get(`/contratos/${contrato.id}/estado-cuenta`)
      .set('Authorization', `Bearer ${access_token}`)
      .expect(HttpStatus.OK);
    const periodoVencido = (estadoCuenta.body as RespuestaEstadoCuenta)
      .periodos[0];
    expect(periodoVencido.estado).toBe('VENCIDO');

    await request(app.getHttpServer())
      .post(`/contratos/${contrato.id}/solicitar-terminacion-anticipada`)
      .set('Authorization', `Bearer ${access_token}`)
      .send({ motivo: 'El inquilino se muda.' })
      .expect(HttpStatus.CREATED);
    await request(app.getHttpServer())
      .post(`/contratos/${contrato.id}/confirmar-terminacion-anticipada`)
      .set('Authorization', `Bearer ${access_token}`)
      .expect(HttpStatus.CREATED);

    const permitido = await reportarPago(inquilinoToken, contrato.id, {
      periodo: periodoVencido.periodo,
    });
    expect(permitido.status).toBe(HttpStatus.CREATED);

    const rechazado = await reportarPago(inquilinoToken, contrato.id);
    expect(rechazado.status).toBe(HttpStatus.CONFLICT);
    expect((rechazado.body as CuerpoError).codigo).toBe('CONTRATO_NO_ACTIVO');
  });

  // ------------------------------------------------------------------
  // B-39: fecha_reportada anterior a fecha_inicio del contrato.
  // ------------------------------------------------------------------
  it('B-39: fecha_reportada anterior al inicio del contrato responde 400', async () => {
    const hoy = hoyLocal();
    const { inquilinoToken, contrato } = await prepararContrato('b39', {
      fecha_inicio: formatearFechaLocal(hoy),
    });

    const respuesta = await reportarPago(inquilinoToken, contrato.id, {
      fechaReportada: formatearFechaLocal(sumarDiasLocal(hoy, -1)),
    });

    expect(respuesta.status).toBe(HttpStatus.BAD_REQUEST);
    expect((respuesta.body as CuerpoError).codigo).toBe(
      'FECHA_REPORTADA_ANTERIOR_A_INICIO',
    );
  });

  // ------------------------------------------------------------------
  // Endpoints de estado de cuenta.
  // ------------------------------------------------------------------
  it('GET /contratos/:id/estado-cuenta responde la forma esperada y 404 en recurso ajeno', async () => {
    const hoy = hoyLocal();
    const { access_token, contrato } = await prepararContrato('estado-a', {
      fecha_inicio: formatearFechaLocal(hoy),
    });

    const respuesta = await request(app.getHttpServer())
      .get(`/contratos/${contrato.id}/estado-cuenta`)
      .set('Authorization', `Bearer ${access_token}`)
      .expect(HttpStatus.OK);

    const cuerpo = respuesta.body as RespuestaEstadoCuenta;
    expect(['al_dia', 'en_mora', 'pendiente']).toContain(cuerpo.estadoPago);
    expect(Array.isArray(cuerpo.periodos)).toBe(true);
    expect(cuerpo.periodos.length).toBeGreaterThan(0);
    expect(typeof cuerpo.periodos[0].canonVigenteCentavos).toBe('number');
    expect(typeof cuerpo.periodos[0].montoAprobadoCentavos).toBe('number');

    const otroArrendador = await registrarArrendador(
      app,
      'Otro arrendador',
      'otro-estado-cuenta@correo.com',
    );
    await request(app.getHttpServer())
      .get(`/contratos/${contrato.id}/estado-cuenta`)
      .set('Authorization', `Bearer ${otroArrendador.access_token}`)
      .expect(HttpStatus.NOT_FOUND);
  });

  it('GET /inquilino/mi-contrato/estado-cuenta responde la forma esperada', async () => {
    const hoy = hoyLocal();
    const { inquilinoToken } = await prepararContrato('estado-b', {
      fecha_inicio: formatearFechaLocal(hoy),
    });

    const respuesta = await request(app.getHttpServer())
      .get('/inquilino/mi-contrato/estado-cuenta')
      .set('Authorization', `Bearer ${inquilinoToken}`)
      .expect(HttpStatus.OK);

    const cuerpo = respuesta.body as RespuestaEstadoCuenta;
    expect(['al_dia', 'en_mora', 'pendiente']).toContain(cuerpo.estadoPago);
    expect(Array.isArray(cuerpo.periodos)).toBe(true);
  });
});
