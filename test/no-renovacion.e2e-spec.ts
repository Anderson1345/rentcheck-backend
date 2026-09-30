import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AlertaSchedulerService } from '../src/alerta/alerta-scheduler.service';
import { AppModule } from '../src/app.module';
import {
  mesesDeTermino,
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

interface ResumenAviso {
  estado: string;
  dado_por: string | null;
  puede_dar: boolean;
  puede_cancelar: boolean;
}

const CREADO: number = HttpStatus.CREATED;
const CONFLICTO: number = HttpStatus.CONFLICT;
const PROHIBIDO: number = HttpStatus.FORBIDDEN;
const NO_ENCONTRADO: number = HttpStatus.NOT_FOUND;
const NO_AUTORIZADO: number = HttpStatus.UNAUTHORIZED;

const iso = (fecha: Date): string => fecha.toISOString().slice(0, 10);

describe('Aviso de no renovación y prórroga automática (e2e)', () => {
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
    jest.restoreAllMocks();
    await app.close();
    await prisma.$disconnect();
  });

  afterAll(async () => {
    await prisma.$connect();
    await limpiarBd(prisma);
    await prisma.$disconnect();
  });

  /** Arrendador, inquilino con cuenta y un contrato con las fechas dadas. */
  async function preparar(inicio: Date, fin: Date) {
    contador += 1;
    const { access_token, arrendador } = await registrarArrendador(
      app,
      `Arrendador ${contador}`,
      `noren-${contador}@correo.com`,
    );
    const inmueble = await crearInmueble(
      app,
      access_token,
      `NOREN-${contador}`,
    );
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
      `inq-noren-${contador}@correo.com`,
    );
    return {
      arr: access_token,
      inq,
      arrendadorId: arrendador.id,
      contratoId: contrato.id,
      unidadId: inmueble.unidades[0].id,
      inquilinoId: inquilino.id,
    };
  }

  /** Contrato de 12 meses que venció ayer. */
  const vencidoAyer = () => preparar(sumarMesesUTC(hoy, -12), dia(-1));
  /** Contrato vigente por 300 días más. */
  const vigente = () => preparar(dia(-30), dia(300));

  const contratoEnBd = (id: string) =>
    prisma.contrato.findUniqueOrThrow({ where: { id } });
  const prorrogasDe = (id: string) =>
    prisma.prorroga.findMany({
      where: { contrato_id: id },
      orderBy: { creado_en: 'asc' },
    });
  const documentosDe = (id: string) =>
    prisma.documentoContrato.findMany({
      where: { contrato_id: id },
      orderBy: { version: 'asc' },
    });
  const codigo = (r: { body: unknown }) => (r.body as CuerpoError).codigo;

  const darArr = (t: string, id: string, motivo?: string) =>
    request(app.getHttpServer())
      .post(`/contratos/${id}/aviso-no-renovacion`)
      .set('Authorization', `Bearer ${t}`)
      .send(motivo ? { motivo } : {});
  const cancelarArr = (t: string, id: string) =>
    request(app.getHttpServer())
      .post(`/contratos/${id}/cancelar-aviso-no-renovacion`)
      .set('Authorization', `Bearer ${t}`);
  const darInq = (t: string, motivo?: string) =>
    request(app.getHttpServer())
      .post('/inquilino/mi-contrato/aviso-no-renovacion')
      .set('Authorization', `Bearer ${t}`)
      .send(motivo ? { motivo } : {});
  const cancelarInq = (t: string) =>
    request(app.getHttpServer())
      .post('/inquilino/mi-contrato/cancelar-aviso-no-renovacion')
      .set('Authorization', `Bearer ${t}`);

  // ------------------------------------------------------------------
  // TEST-FIRST: prórroga automática (D-1)
  // ------------------------------------------------------------------
  it('sin aviso, un ACTIVO que llegó a su fecha de fin se prorroga automáticamente con su otrosí (y es idempotente)', async () => {
    const { contratoId, arrendadorId } = await vencidoAyer();
    const finAnterior = dia(-1);
    await prisma.contrato.update({
      where: { id: contratoId },
      data: { estado_pago: 'AL_DIA' },
    });

    await scheduler.ejecutarTransicionesDeEstado(hoy);

    const contrato = await contratoEnBd(contratoId);
    const esperada = sumarMesesUTC(finAnterior, 12);
    expect(contrato.estado).toBe('ACTIVO');
    expect(contrato.fecha_fin).toEqual(esperada);
    const prorrogas = await prorrogasDe(contratoId);
    expect(prorrogas).toHaveLength(1);
    expect(prorrogas[0]).toMatchObject({
      tipo: 'AUTOMATICA',
      meses: 12,
      fecha_fin_anterior: finAnterior,
      fecha_fin_nueva: esperada,
      fecha_aplicacion: hoy,
    });
    const documentos = await documentosDe(contratoId);
    expect(documentos.map((d) => [d.version, d.tipo])).toEqual([
      [1, 'CONTRATO_ORIGINAL'],
      [2, 'OTROSI_PRORROGA'],
    ]);
    expect(documentos[1].prorroga_id).toBe(prorrogas[0].id);
    expect(contrato.estado_pago).not.toBe('AL_DIA');
    const alertas = await prisma.alerta.findMany({
      where: { contrato_id: contratoId, arrendador_id: arrendadorId },
    });
    expect(alertas.map((a) => a.tipo as string)).toEqual([
      'CONTRATO_PRORROGADO_AUTOMATICAMENTE',
    ]);

    const segunda = await scheduler.ejecutarVencimientosYProrrogas(hoy);
    expect(segunda).toEqual({ vencidos: 0, prorrogados: 0, errores: 0 });
    expect(await prorrogasDe(contratoId)).toHaveLength(1);
    expect(await contratoEnBd(contratoId)).toEqual(contrato);
  }, 60000);

  it('con aviso vigente, el contrato pasa a VENCIDO sin prórroga', async () => {
    const { contratoId } = await vencidoAyer();
    await prisma.avisoNoRenovacion.create({
      data: { contrato_id: contratoId, dado_por: 'INQUILINO' },
    });

    const resultado = await scheduler.ejecutarVencimientosYProrrogas(hoy);

    expect(resultado).toEqual({ vencidos: 1, prorrogados: 0, errores: 0 });
    expect((await contratoEnBd(contratoId)).estado).toBe('VENCIDO');
    expect(await prorrogasDe(contratoId)).toHaveLength(0);
    expect(await documentosDe(contratoId)).toHaveLength(1);
  }, 60000);

  it('un aviso dado y luego cancelado no impide la prórroga', async () => {
    const { contratoId } = await vencidoAyer();
    await prisma.avisoNoRenovacion.create({
      data: {
        contrato_id: contratoId,
        dado_por: 'ARRENDADOR',
        cancelado_en: new Date(),
      },
    });

    await scheduler.ejecutarVencimientosYProrrogas(hoy);

    expect((await contratoEnBd(contratoId)).estado).toBe('ACTIVO');
    expect(await prorrogasDe(contratoId)).toHaveLength(1);
  }, 60000);

  it('no prorroga un VENCIDO ni un TERMINADO_ANTICIPADAMENTE', async () => {
    const vencido = await vencidoAyer();
    const terminado = await vencidoAyer();
    await prisma.contrato.update({
      where: { id: vencido.contratoId },
      data: { estado: 'VENCIDO' },
    });
    await prisma.contrato.update({
      where: { id: terminado.contratoId },
      data: { estado: 'TERMINADO_ANTICIPADAMENTE' },
    });

    const resultado = await scheduler.ejecutarVencimientosYProrrogas(hoy);

    expect(resultado).toEqual({ vencidos: 0, prorrogados: 0, errores: 0 });
    expect(await prisma.prorroga.count()).toBe(0);
  }, 60000);

  it('usa el término inicial (no el ya prorrogado) y respeta el 29 de febrero', async () => {
    // Contrato de 12 meses ya prorrogado una vez: su término inicial sigue siendo 12.
    const previo = await preparar(sumarMesesUTC(hoy, -24), dia(-1));
    const finOriginal = sumarDiasUTC(sumarMesesUTC(hoy, -12), -1);
    expect(mesesDeTermino(sumarMesesUTC(hoy, -24), finOriginal)).toBe(12);
    await prisma.prorroga.create({
      data: {
        contrato_id: previo.contratoId,
        fecha_aplicacion: sumarMesesUTC(hoy, -12),
        fecha_fin_anterior: finOriginal,
        fecha_fin_nueva: dia(-1),
        meses: 12,
        tipo: 'MANUAL',
      },
    });

    await scheduler.ejecutarVencimientosYProrrogas(hoy);
    const auto = (await prorrogasDe(previo.contratoId)).find(
      (p) => p.tipo === 'AUTOMATICA',
    );
    expect(auto?.meses).toBe(12);

    // 29 de febrero: 2027-03-01..2028-02-29 (12 meses) + 12 = 2029-02-28.
    const bisiesto = await vigente();
    await prisma.contrato.update({
      where: { id: bisiesto.contratoId },
      data: {
        fecha_inicio: new Date(Date.UTC(2027, 2, 1)),
        fecha_fin: new Date(Date.UTC(2028, 1, 29)),
      },
    });
    const hoyBisiesto = new Date(Date.UTC(2028, 2, 1));
    await scheduler.ejecutarVencimientosYProrrogas(hoyBisiesto);
    expect((await contratoEnBd(bisiesto.contratoId)).fecha_fin).toEqual(
      new Date(Date.UTC(2029, 1, 28)),
    );
  }, 90000);

  it('dos corridas simultáneas del cron sobre el mismo contrato: exactamente una prórroga', async () => {
    const { contratoId } = await vencidoAyer();

    const resultados = await Promise.all([
      scheduler.ejecutarVencimientosYProrrogas(hoy),
      scheduler.ejecutarVencimientosYProrrogas(hoy),
    ]);

    expect(resultados.reduce((suma, r) => suma + r.prorrogados, 0)).toBe(1);
    expect(await prorrogasDe(contratoId)).toHaveLength(1);
    expect(
      await prisma.alerta.count({ where: { contrato_id: contratoId } }),
    ).toBe(1);
  }, 60000);

  it('recuperación: si el cron perdió días aplica las prórrogas necesarias, cada una con su otrosí', async () => {
    const { contratoId } = await preparar(sumarMesesUTC(hoy, -12), dia(-1));
    // Vencido hace ~2 años y 2 meses: hacen falta 3 prórrogas de 12 meses.
    const fin = sumarDiasUTC(sumarMesesUTC(hoy, -26), 0);
    await prisma.contrato.update({
      where: { id: contratoId },
      data: { fecha_inicio: sumarMesesUTC(fin, -12), fecha_fin: fin },
    });

    const resultado = await scheduler.ejecutarVencimientosYProrrogas(hoy);

    expect(resultado).toEqual({ vencidos: 0, prorrogados: 1, errores: 0 });
    const contrato = await contratoEnBd(contratoId);
    expect(contrato.fecha_fin.getTime()).toBeGreaterThanOrEqual(hoy.getTime());
    const prorrogas = await prorrogasDe(contratoId);
    expect(prorrogas).toHaveLength(3);
    expect(prorrogas.every((p) => p.tipo === 'AUTOMATICA')).toBe(true);
    const documentos = await documentosDe(contratoId);
    expect(documentos.filter((d) => d.tipo === 'OTROSI_PRORROGA')).toHaveLength(
      3,
    );
    // Una sola alerta por corrida y contrato.
    expect(
      await prisma.alerta.count({ where: { contrato_id: contratoId } }),
    ).toBe(1);
  }, 120000);

  it('tope de 12 prórrogas por contrato y corrida; la siguiente corrida continúa', async () => {
    const { contratoId } = await preparar(sumarMesesUTC(hoy, -12), dia(-1));
    const fin = dia(-900);
    await prisma.contrato.update({
      where: { id: contratoId },
      data: { fecha_inicio: sumarDiasUTC(fin, -29), fecha_fin: fin },
    });
    expect(mesesDeTermino(sumarDiasUTC(fin, -29), fin)).toBe(1);

    await scheduler.ejecutarVencimientosYProrrogas(hoy);

    const contrato = await contratoEnBd(contratoId);
    expect(await prorrogasDe(contratoId)).toHaveLength(12);
    expect(contrato.estado).toBe('ACTIVO');
    expect(contrato.fecha_fin.getTime()).toBeLessThan(hoy.getTime());
  }, 180000);

  it('una falla en un contrato no detiene a los demás y se cuenta en errores', async () => {
    const a = await vencidoAyer();
    const b = await vencidoAyer();
    jest
      .spyOn(scheduler, 'prorrogarAutomaticamente')
      .mockRejectedValueOnce(new Error('falla simulada'));

    const resultado = await scheduler.ejecutarVencimientosYProrrogas(hoy);

    expect(resultado).toEqual({ vencidos: 0, prorrogados: 1, errores: 1 });
    const avanzados = [a, b].filter((c) => c !== undefined);
    const fines = await Promise.all(
      avanzados.map(async (c) => (await contratoEnBd(c.contratoId)).fecha_fin),
    );
    expect(fines.filter((f) => f.getTime() >= hoy.getTime())).toHaveLength(1);
  }, 90000);

  it('un contrato PROGRAMADO que empieza al día siguiente del fin se activa en la misma corrida (con o sin aviso)', async () => {
    for (const conAviso of [false, true]) {
      const anterior = await vencidoAyer();
      if (conAviso) {
        await prisma.avisoNoRenovacion.create({
          data: { contrato_id: anterior.contratoId, dado_por: 'ARRENDADOR' },
        });
      }
      const siguiente = await prisma.contrato.create({
        data: {
          arrendador_id: anterior.arrendadorId,
          unidad_id: anterior.unidadId,
          inquilino_id: anterior.inquilinoId,
          tipo_plantilla: 'VIVIENDA_URBANA_LEY_820',
          canon_centavos: 1_000_000,
          dia_pago: 5,
          forma_pago: 'Transferencia',
          datos_recaudo: 'Bancolombia 1',
          fecha_inicio: hoy,
          fecha_fin: dia(365),
          estado: 'PROGRAMADO',
        },
      });

      await scheduler.ejecutarTransicionesDeEstado(hoy);

      expect((await contratoEnBd(anterior.contratoId)).estado).toBe('VENCIDO');
      expect((await contratoEnBd(siguiente.id)).estado).toBe('ACTIVO');
      expect(await prorrogasDe(anterior.contratoId)).toHaveLength(0);
      await limpiarBd(prisma);
    }
  }, 120000);

  it('una terminación anticipada confirmada con fecha efectiva alcanzada se termina y no se prorroga', async () => {
    const { contratoId } = await preparar(dia(-60), dia(20));
    await prisma.contrato.update({
      where: { id: contratoId },
      data: {
        terminacionAnticipadaSolicitada: true,
        terminacionAnticipadaSolicitadaPor: 'INQUILINO',
        terminacionAnticipadaConfirmadaEn: new Date(),
        terminacion_confirmada_por: 'ARRENDADOR',
        terminacion_fecha_efectiva: dia(20),
      },
    });

    await scheduler.ejecutarTransicionesDeEstado(dia(21));

    expect((await contratoEnBd(contratoId)).estado).toBe(
      'TERMINADO_ANTICIPADAMENTE',
    );
    expect(await prorrogasDe(contratoId)).toHaveLength(0);
  }, 60000);

  it('un aviso posterior a una prórroga automática aplica a la fecha de fin nueva', async () => {
    const { contratoId, arr } = await vencidoAyer();
    await scheduler.ejecutarVencimientosYProrrogas(hoy);
    expect((await contratoEnBd(contratoId)).estado).toBe('ACTIVO');

    await darArr(arr, contratoId).expect(CREADO);
    const finNueva = (await contratoEnBd(contratoId)).fecha_fin;

    const siguiente = sumarDiasUTC(finNueva, 1);
    await scheduler.ejecutarVencimientosYProrrogas(siguiente);

    expect((await contratoEnBd(contratoId)).estado).toBe('VENCIDO');
    expect(await prorrogasDe(contratoId)).toHaveLength(1);
  }, 90000);

  it('la alerta de próximo a vencer usa el día calendario de Bogotá (30 días o menos)', async () => {
    const dentro = await preparar(dia(-100), dia(30));
    const fuera = await preparar(dia(-100), dia(31));

    await scheduler.ejecutarVencimiento();

    const alertas = await prisma.alerta.findMany({
      where: { tipo: 'CONTRATO_PROXIMO_A_VENCER' },
    });
    expect(alertas.map((a) => a.contrato_id)).toEqual([dentro.contratoId]);
    expect(fuera.contratoId).not.toBe(dentro.contratoId);
  }, 60000);

  // ------------------------------------------------------------------
  // Aviso de no renovación
  // ------------------------------------------------------------------
  describe('aviso de no renovación', () => {
    it('dar, repetir, cancelar por el otro rol, cancelar por quien lo dio y volver a dar', async () => {
      const { arr, inq, contratoId } = await vigente();

      const dado = await darArr(arr, contratoId, 'No renovamos').expect(CREADO);
      const cuerpo = dado.body as {
        aviso_no_renovacion: ResumenAviso;
        pdf_contrato_ruta?: string;
      };
      expect(cuerpo.aviso_no_renovacion).toMatchObject({
        estado: 'DADO',
        dado_por: 'ARRENDADOR',
        puede_dar: false,
        puede_cancelar: true,
      });
      expect(cuerpo).not.toHaveProperty('pdf_contrato_ruta');

      const repetido = await darInq(inq);
      expect(repetido.status).toBe(CONFLICTO);
      expect(codigo(repetido)).toBe('AVISO_YA_DADO');

      const ajeno = await cancelarInq(inq);
      expect(ajeno.status).toBe(PROHIBIDO);
      expect(codigo(ajeno)).toBe('NO_PUEDE_CANCELAR_AVISO_AJENO');

      const cancelado = await cancelarArr(arr, contratoId).expect(CREADO);
      expect(
        (cancelado.body as { aviso_no_renovacion: ResumenAviso })
          .aviso_no_renovacion,
      ).toMatchObject({ estado: 'NINGUNO', puede_dar: true });

      const otraVez = await darInq(inq).expect(CREADO);
      expect(
        (otraVez.body as { aviso_no_renovacion: ResumenAviso })
          .aviso_no_renovacion,
      ).toMatchObject({ estado: 'DADO', dado_por: 'INQUILINO' });
      expect(await prisma.avisoNoRenovacion.count()).toBe(1);

      const sinAviso = await cancelarArr(arr, contratoId);
      expect(sinAviso.status).toBe(PROHIBIDO);
    }, 60000);

    it('cancelar sin aviso vigente responde 409 AVISO_NO_DADO', async () => {
      const { arr, inq, contratoId } = await vigente();
      const a = await cancelarArr(arr, contratoId);
      const b = await cancelarInq(inq);
      expect([a.status, b.status]).toEqual([CONFLICTO, CONFLICTO]);
      expect(codigo(a)).toBe('AVISO_NO_DADO');
      expect(codigo(b)).toBe('AVISO_NO_DADO');
    }, 60000);

    it('el último día (hoy = fecha_fin) responde 409 AVISO_FUERA_DE_PLAZO; con el contrato no activo, CONTRATO_NO_ACTIVO', async () => {
      const ultimo = await preparar(dia(-30), hoy);
      const fuera = await darArr(ultimo.arr, ultimo.contratoId);
      expect(fuera.status).toBe(CONFLICTO);
      expect(codigo(fuera)).toBe('AVISO_FUERA_DE_PLAZO');
      expect(codigo(await darInq(ultimo.inq))).toBe('AVISO_FUERA_DE_PLAZO');

      const { arr, inq, contratoId } = await vigente();
      await prisma.contrato.update({
        where: { id: contratoId },
        data: { estado: 'VENCIDO' },
      });
      expect(codigo(await darArr(arr, contratoId))).toBe('CONTRATO_NO_ACTIVO');
      expect(codigo(await darInq(inq))).toBe('CONTRATO_NO_ACTIVO');
      expect(await prisma.avisoNoRenovacion.count()).toBe(0);
    }, 60000);

    it('ajeno o inexistente → 404; el token del otro rol → 401', async () => {
      const { arr, inq, contratoId } = await vigente();
      const { access_token: otro } = await registrarArrendador(
        app,
        'Otro',
        'otro-noren@correo.com',
      );

      await darArr(otro, contratoId).expect(NO_ENCONTRADO);
      await cancelarArr(otro, contratoId).expect(NO_ENCONTRADO);
      await darArr(arr, '00000000-0000-4000-8000-000000000000').expect(
        NO_ENCONTRADO,
      );
      await darArr(arr, 'no-es-un-id').expect(NO_ENCONTRADO);
      await darArr(inq, contratoId).expect(NO_AUTORIZADO);
      await cancelarArr(inq, contratoId).expect(NO_AUTORIZADO);
      await darInq(arr).expect(NO_AUTORIZADO);
      await cancelarInq(arr).expect(NO_AUTORIZADO);
      expect(await prisma.avisoNoRenovacion.count()).toBe(0);
    }, 60000);

    it('dos "dar" simultáneos: exactamente uno gana', async () => {
      const { arr, inq, contratoId } = await vigente();

      const respuestas = await Promise.all([
        darArr(arr, contratoId),
        darInq(inq),
      ]);

      expect(respuestas.map((r) => r.status).sort()).toEqual([
        CREADO,
        CONFLICTO,
      ]);
      expect(codigo(respuestas.find((r) => r.status === CONFLICTO)!)).toBe(
        'AVISO_YA_DADO',
      );
      expect(await prisma.avisoNoRenovacion.count()).toBe(1);
    }, 60000);

    it('"dar" y "cancelar" simultáneos dejan un resultado consistente', async () => {
      const { arr, inq, contratoId } = await vigente();
      await darInq(inq).expect(CREADO);

      const [cancelar, dar] = await Promise.all([
        cancelarInq(inq),
        darArr(arr, contratoId),
      ]);

      expect(cancelar.status).toBe(CREADO);
      const aviso = await prisma.avisoNoRenovacion.findUniqueOrThrow({
        where: { contrato_id: contratoId },
      });
      if (dar.status === CREADO) {
        // cancelar ocurrió primero y "dar" reactivó el aviso.
        expect(aviso.cancelado_en).toBeNull();
        expect(aviso.dado_por).toBe('ARRENDADOR');
      } else {
        expect(dar.status).toBe(CONFLICTO);
        expect(codigo(dar)).toBe('AVISO_YA_DADO');
        expect(aviso.cancelado_en).not.toBeNull();
      }
    }, 60000);

    it('crea alertas al arrendador solo cuando el inquilino da o cancela el aviso', async () => {
      const { arr, inq, contratoId } = await vigente();
      const tipos = async () =>
        (
          await prisma.alerta.findMany({
            where: { contrato_id: contratoId },
            orderBy: { creado_en: 'asc' },
          })
        ).map((a) => a.tipo as string);

      await darArr(arr, contratoId).expect(CREADO);
      await cancelarArr(arr, contratoId).expect(CREADO);
      expect(await tipos()).toEqual([]);

      await darInq(inq).expect(CREADO);
      await cancelarInq(inq).expect(CREADO);
      expect(await tipos()).toEqual([
        'AVISO_NO_RENOVACION_DADO',
        'AVISO_NO_RENOVACION_CANCELADO',
      ]);
    }, 60000);

    it('el resumen aparece en el detalle del arrendador y en mi-contrato', async () => {
      const { arr, inq, contratoId } = await vigente();
      await darInq(inq, 'Me mudo').expect(CREADO);

      const detalle = await request(app.getHttpServer())
        .get(`/contratos/${contratoId}`)
        .set('Authorization', `Bearer ${arr}`)
        .expect(HttpStatus.OK);
      expect(
        (detalle.body as { aviso_no_renovacion: ResumenAviso })
          .aviso_no_renovacion,
      ).toMatchObject({
        estado: 'DADO',
        dado_por: 'INQUILINO',
        puede_dar: false,
        puede_cancelar: false,
      });

      const mi = await request(app.getHttpServer())
        .get('/inquilino/mi-contrato')
        .set('Authorization', `Bearer ${inq}`)
        .expect(HttpStatus.OK);
      expect(
        (mi.body as { aviso_no_renovacion: ResumenAviso }).aviso_no_renovacion,
      ).toMatchObject({ estado: 'DADO', puede_cancelar: true });
    }, 60000);
  });
});
