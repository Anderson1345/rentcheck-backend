import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EstadoContrato } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AlmacenamientoService } from '../src/almacenamiento/almacenamiento.service';
import { AppModule } from '../src/app.module';
import {
  sumarDiasUTC,
  sumarMesesUTC,
} from '../src/common/fechas-contrato.util';
import { hoyEnBogota } from '../src/common/hoy-bogota.util';
import { configurarApp } from '../src/configurar-app';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  crearContrato,
  crearInmueble,
  crearInquilino,
  registrarArrendador,
} from './helpers/crear-datos.helper';
import { limpiarBd } from './helpers/limpiar-bd';

interface CuerpoError {
  codigo: string;
  detalles?: Record<string, unknown>;
}

interface PeriodoRespuesta {
  periodo: string;
  fechaLimite: string;
  canonVigenteCentavos: number;
  estado: string;
  montoAprobadoCentavos: number;
}

interface EstadoCuentaRespuesta {
  estadoPago: string;
  periodos: PeriodoRespuesta[];
}

interface ContratoRespuesta {
  id: string;
  canon_centavos: number;
  fecha_fin: string;
  pdf_contrato_ruta?: string;
}

interface IncrementoRespuesta {
  canon_anterior_centavos: number;
  canon_nuevo_centavos: number;
  porcentaje_ipc_aplicado: string | number;
  ipc_referencia_anio: number | null;
  ipc_referencia_porcentaje: string | number | null;
  fecha_aplicacion: string;
}

interface ProrrogaRespuesta {
  fecha_aplicacion: string;
  fecha_fin_anterior: string;
  fecha_fin_nueva: string;
  meses: number;
  tipo: string;
}

const CREADO: number = HttpStatus.CREATED;
const CONFLICTO: number = HttpStatus.CONFLICT;

function fechaISO(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

describe('Incremento de IPC y prórroga (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let almacenamiento: AlmacenamientoService;
  let contadorSufijo = 0;

  beforeEach(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await limpiarBd(prisma);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configurarApp(app);
    almacenamiento = moduleFixture.get(AlmacenamientoService);
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

  async function prepararContrato(opciones: {
    inicio: Date;
    fin: Date;
    tipoPlantilla?: string;
    canon?: number;
    diaPago?: number;
  }) {
    contadorSufijo += 1;
    const sufijo = `${contadorSufijo}`;
    const { access_token, arrendador } = await registrarArrendador(
      app,
      `Arrendador ${sufijo}`,
      `incr-${sufijo}@correo.com`,
    );
    // B-47: una plantilla de local comercial exige una unidad comercial.
    const inmueble =
      opciones.tipoPlantilla === 'LOCAL_COMERCIAL'
        ? ((
            await request(app.getHttpServer())
              .post('/inmuebles')
              .set('Authorization', `Bearer ${access_token}`)
              .send({
                direccion: 'Carrera 7 # 10-20',
                ciudad: 'Bogota',
                matricula_inmobiliaria: `INC-${sufijo}`,
                uso_unidad_principal: 'COMERCIAL',
              })
              .expect(HttpStatus.CREATED)
          ).body as Awaited<ReturnType<typeof crearInmueble>>)
        : await crearInmueble(app, access_token, `INC-${sufijo}`);
    const inquilino = await crearInquilino(app, access_token);
    const contrato = await crearContrato(
      app,
      access_token,
      inmueble.unidades[0].id,
      inquilino.id,
      {
        fecha_inicio: fechaISO(opciones.inicio),
        fecha_fin: fechaISO(opciones.fin),
        canon_centavos: opciones.canon ?? 1_000_000,
        dia_pago: opciones.diaPago ?? 5,
        ...(opciones.tipoPlantilla
          ? { tipo_plantilla: opciones.tipoPlantilla }
          : {}),
      },
    );
    return { access_token, arrendadorId: arrendador.id, contrato };
  }

  /** Contrato con 13 meses de antigüedad y término de 24 meses. */
  function contratoElegibleParaIncremento(tipoPlantilla?: string) {
    const hoy = hoyEnBogota();
    return prepararContrato({
      inicio: sumarMesesUTC(hoy, -13),
      fin: sumarMesesUTC(hoy, 11),
      tipoPlantilla,
    });
  }

  async function configurarIpcAnioAnterior(porcentaje = 5.1) {
    const hoy = hoyEnBogota();
    await prisma.configuracionIpc.create({
      data: { anio: hoy.getUTCFullYear() - 1, porcentaje },
    });
  }

  function aplicarIncremento(
    token: string,
    contratoId: string,
    cuerpo?: Record<string, unknown>,
  ) {
    const peticion = request(app.getHttpServer())
      .post(`/contratos/${contratoId}/aplicar-incremento`)
      .set('Authorization', `Bearer ${token}`);
    return cuerpo ? peticion.send(cuerpo) : peticion;
  }

  function prorrogar(
    token: string,
    contratoId: string,
    cuerpo?: Record<string, unknown>,
  ) {
    const peticion = request(app.getHttpServer())
      .post(`/contratos/${contratoId}/prorrogar`)
      .set('Authorization', `Bearer ${token}`);
    return cuerpo ? peticion.send(cuerpo) : peticion;
  }

  function espiarAlmacenamiento() {
    return {
      subir: jest.spyOn(almacenamiento, 'subirArchivo'),
      otros: [
        jest.spyOn(almacenamiento, 'eliminarArchivo'),
        jest.spyOn(almacenamiento, 'generarUrlFirmada'),
        jest.spyOn(almacenamiento, 'descargarArchivo'),
      ],
    };
  }

  // ------------------------------------------------------------------
  // B-49: el canon de un período anterior al incremento no debe cambiar.
  // El estado de la base replica lo que deja un incremento: el contrato
  // guarda el canon NUEVO (vigente hoy) y el historial guarda el anterior.
  // ------------------------------------------------------------------
  it('B-49: un período antiguo pagado por el canon original sigue PAGADO tras un incremento', async () => {
    const hoy = hoyEnBogota();
    const inicio = new Date(
      Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 14, 1),
    );
    const { access_token, arrendadorId, contrato } = await prepararContrato({
      inicio,
      fin: sumarMesesUTC(hoy, 6),
    });

    // El primer período (mes de `inicio`) se pagó completo con el canon original.
    await prisma.pago.create({
      data: {
        arrendador_id: arrendadorId,
        contrato_id: contrato.id,
        monto_centavos: 1_000_000,
        fecha_reportada: inicio,
        periodo: inicio,
        estado: 'APROBADO',
      },
    });

    // Incremento aplicado hoy: canon nuevo = 1.100.000.
    await prisma.$transaction([
      prisma.contrato.update({
        where: { id: contrato.id },
        data: { canon_centavos: 1_100_000 },
      }),
      prisma.incrementoIPC.create({
        data: {
          contrato_id: contrato.id,
          fecha_aplicacion: hoy,
          canon_anterior_centavos: 1_000_000,
          canon_nuevo_centavos: 1_100_000,
          porcentaje_ipc_aplicado: 10,
        },
      }),
    ]);

    const respuesta = await request(app.getHttpServer())
      .get(`/contratos/${contrato.id}/estado-cuenta`)
      .set('Authorization', `Bearer ${access_token}`)
      .expect(HttpStatus.OK);
    const periodos = (respuesta.body as EstadoCuentaRespuesta).periodos;

    expect(periodos[0].canonVigenteCentavos).toBe(1_000_000);
    expect(periodos[0].montoAprobadoCentavos).toBe(1_000_000);
    expect(periodos[0].estado).toBe('PAGADO');
  });

  it('B-49 de extremo a extremo: tras aplicar-incremento los períodos viejos conservan el canon original', async () => {
    const hoy = hoyEnBogota();
    const inicio = new Date(
      Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 14, 1),
    );
    const { access_token, arrendadorId, contrato } = await prepararContrato({
      inicio,
      fin: sumarMesesUTC(hoy, 6),
    });
    await prisma.pago.create({
      data: {
        arrendador_id: arrendadorId,
        contrato_id: contrato.id,
        monto_centavos: 1_000_000,
        fecha_reportada: inicio,
        periodo: inicio,
        estado: 'APROBADO',
      },
    });
    await configurarIpcAnioAnterior(5.1);

    await aplicarIncremento(access_token, contrato.id).expect(
      HttpStatus.CREATED,
    );

    const respuesta = await request(app.getHttpServer())
      .get(`/contratos/${contrato.id}/estado-cuenta`)
      .set('Authorization', `Bearer ${access_token}`)
      .expect(HttpStatus.OK);
    const periodos = (respuesta.body as EstadoCuentaRespuesta).periodos;
    const hoyISO = fechaISO(hoy);

    expect(periodos[0].canonVigenteCentavos).toBe(1_000_000);
    expect(periodos[0].estado).toBe('PAGADO');
    // Todo período con fecha límite anterior a hoy conserva el canon viejo;
    // los de fecha límite igual o posterior usan el nuevo.
    for (const periodo of periodos) {
      const limite = periodo.fechaLimite.slice(0, 10);
      expect(periodo.canonVigenteCentavos).toBe(
        limite < hoyISO ? 1_000_000 : 1_051_000,
      );
    }
  });

  // ------------------------------------------------------------------
  // POST /contratos/:id/aplicar-incremento
  // ------------------------------------------------------------------
  describe('aplicar-incremento', () => {
    it('aplica el IPC del año anterior, guarda la referencia y no toca fecha_fin ni el PDF', async () => {
      const hoy = hoyEnBogota();
      const { access_token, contrato } = await contratoElegibleParaIncremento();
      const antes = await prisma.contrato.findUniqueOrThrow({
        where: { id: contrato.id },
      });
      // El IPC de otros años (incluido el "más reciente") no se usa.
      await configurarIpcAnioAnterior(5.1);
      await prisma.configuracionIpc.create({
        data: { anio: hoy.getUTCFullYear(), porcentaje: 12 },
      });
      const espias = espiarAlmacenamiento();

      const respuesta = await aplicarIncremento(
        access_token,
        contrato.id,
      ).expect(HttpStatus.CREATED);
      const cuerpo = respuesta.body as {
        contrato: ContratoRespuesta;
        incremento_ipc: IncrementoRespuesta;
      };

      expect(cuerpo.contrato.canon_centavos).toBe(1_051_000);
      expect(cuerpo.contrato.fecha_fin.slice(0, 10)).toBe(
        fechaISO(antes.fecha_fin),
      );
      expect(cuerpo.contrato).not.toHaveProperty('pdf_contrato_ruta');
      expect(cuerpo.incremento_ipc).toMatchObject({
        canon_anterior_centavos: 1_000_000,
        canon_nuevo_centavos: 1_051_000,
        ipc_referencia_anio: hoy.getUTCFullYear() - 1,
      });
      expect(Number(cuerpo.incremento_ipc.porcentaje_ipc_aplicado)).toBe(5.1);
      expect(Number(cuerpo.incremento_ipc.ipc_referencia_porcentaje)).toBe(5.1);
      expect(cuerpo.incremento_ipc.fecha_aplicacion.slice(0, 10)).toBe(
        fechaISO(hoy),
      );

      const despues = await prisma.contrato.findUniqueOrThrow({
        where: { id: contrato.id },
      });
      expect(despues.pdf_contrato_ruta).toBe(antes.pdf_contrato_ruta);
      expect(despues.fecha_fin).toEqual(antes.fecha_fin);
      // B0.3-B: el incremento genera SOLO el otrosí (v2, sin sobrescribir el
      // original v1); no borra, no firma y no descarga nada.
      expect(espias.subir).toHaveBeenCalledTimes(1);
      expect(espias.subir.mock.calls[0][1]).toBe(
        `contratos/${contrato.id}/v2-OTROSI_INCREMENTO.pdf`,
      );
      expect(espias.subir.mock.calls[0][3]).toBe(false);
      for (const espia of espias.otros) {
        expect(espia).not.toHaveBeenCalled();
      }
      expect(await prisma.incrementoIPC.count()).toBe(1);
    });

    it('un segundo incremento inmediato responde 409 INCREMENTO_ANTES_DE_12_MESES con la fecha desde la que se puede', async () => {
      const hoy = hoyEnBogota();
      const { access_token, contrato } = await contratoElegibleParaIncremento();
      await configurarIpcAnioAnterior();
      await aplicarIncremento(access_token, contrato.id).expect(
        HttpStatus.CREATED,
      );

      const respuesta = await aplicarIncremento(
        access_token,
        contrato.id,
      ).expect(HttpStatus.CONFLICT);
      const cuerpo = respuesta.body as CuerpoError;

      expect(cuerpo.codigo).toBe('INCREMENTO_ANTES_DE_12_MESES');
      expect(cuerpo.detalles?.puede_aplicarse_desde).toBe(
        fechaISO(sumarMesesUTC(hoy, 12)),
      );
      expect(await prisma.incrementoIPC.count()).toBe(1);
    });

    it('un contrato de menos de 12 meses responde 409 INCREMENTO_ANTES_DE_12_MESES', async () => {
      const hoy = hoyEnBogota();
      const { access_token, contrato } = await prepararContrato({
        inicio: sumarMesesUTC(hoy, -6),
        fin: sumarMesesUTC(hoy, 18),
      });
      await configurarIpcAnioAnterior();

      const respuesta = await aplicarIncremento(
        access_token,
        contrato.id,
      ).expect(HttpStatus.CONFLICT);

      expect((respuesta.body as CuerpoError).codigo).toBe(
        'INCREMENTO_ANTES_DE_12_MESES',
      );
      expect(
        (respuesta.body as CuerpoError).detalles?.puede_aplicarse_desde,
      ).toBe(fechaISO(sumarMesesUTC(sumarMesesUTC(hoy, -6), 12)));
    });

    it('vivienda: un porcentaje mayor al IPC responde 400 y uno menor se acepta', async () => {
      const { access_token, contrato } = await contratoElegibleParaIncremento();
      await configurarIpcAnioAnterior(5.1);

      const rechazado = await aplicarIncremento(access_token, contrato.id, {
        porcentaje: 7,
      }).expect(HttpStatus.BAD_REQUEST);
      expect((rechazado.body as CuerpoError).codigo).toBe(
        'PORCENTAJE_SUPERIOR_AL_IPC',
      );
      expect(await prisma.incrementoIPC.count()).toBe(0);

      const aceptado = await aplicarIncremento(access_token, contrato.id, {
        porcentaje: 3.5,
      }).expect(HttpStatus.CREATED);
      expect(
        (aceptado.body as { contrato: ContratoRespuesta }).contrato
          .canon_centavos,
      ).toBe(1_035_000);
    });

    it('local: un porcentaje pactado mayor al IPC se acepta', async () => {
      const { access_token, contrato } =
        await contratoElegibleParaIncremento('LOCAL_COMERCIAL');
      await configurarIpcAnioAnterior(5.1);

      const respuesta = await aplicarIncremento(access_token, contrato.id, {
        porcentaje: 8,
      }).expect(HttpStatus.CREATED);
      const cuerpo = respuesta.body as {
        contrato: ContratoRespuesta;
        incremento_ipc: IncrementoRespuesta;
      };

      expect(cuerpo.contrato.canon_centavos).toBe(1_080_000);
      expect(Number(cuerpo.incremento_ipc.porcentaje_ipc_aplicado)).toBe(8);
      expect(Number(cuerpo.incremento_ipc.ipc_referencia_porcentaje)).toBe(5.1);
    });

    it('sin IPC del año anterior responde 409 IPC_NO_CONFIGURADO (no usa otro año)', async () => {
      const hoy = hoyEnBogota();
      const { access_token, contrato } = await contratoElegibleParaIncremento();
      await prisma.configuracionIpc.create({
        data: { anio: hoy.getUTCFullYear() - 2, porcentaje: 9 },
      });

      const respuesta = await aplicarIncremento(
        access_token,
        contrato.id,
      ).expect(HttpStatus.CONFLICT);
      const cuerpo = respuesta.body as CuerpoError;

      expect(cuerpo.codigo).toBe('IPC_NO_CONFIGURADO');
      expect(cuerpo.detalles?.anio).toBe(hoy.getUTCFullYear() - 1);
      expect(await prisma.incrementoIPC.count()).toBe(0);
    });

    it('valida el porcentaje del cuerpo (VALIDACION)', async () => {
      const { access_token, contrato } = await contratoElegibleParaIncremento();
      await configurarIpcAnioAnterior();

      for (const porcentaje of [0, -1, 101, 5.123]) {
        const respuesta = await aplicarIncremento(access_token, contrato.id, {
          porcentaje,
        }).expect(HttpStatus.BAD_REQUEST);
        expect((respuesta.body as CuerpoError).codigo).toBe('VALIDACION');
      }
    });

    it('un contrato no ACTIVO responde 409 CONTRATO_NO_ACTIVO', async () => {
      const { access_token, contrato } = await contratoElegibleParaIncremento();
      await configurarIpcAnioAnterior();
      await prisma.contrato.update({
        where: { id: contrato.id },
        data: { estado: EstadoContrato.VENCIDO },
      });

      const respuesta = await aplicarIncremento(
        access_token,
        contrato.id,
      ).expect(HttpStatus.CONFLICT);

      expect((respuesta.body as CuerpoError).codigo).toBe('CONTRATO_NO_ACTIVO');
    });

    it('un contrato ajeno o inexistente responde 404', async () => {
      const { contrato } = await contratoElegibleParaIncremento();
      await configurarIpcAnioAnterior();
      const otro = await registrarArrendador(
        app,
        'Otro',
        'otro-incr@correo.com',
      );

      await aplicarIncremento(otro.access_token, contrato.id).expect(
        HttpStatus.NOT_FOUND,
      );
      await aplicarIncremento(
        otro.access_token,
        '00000000-0000-4000-8000-000000000000',
      ).expect(HttpStatus.NOT_FOUND);
    });

    it('dos peticiones simultáneas: exactamente una tiene éxito', async () => {
      const { access_token, contrato } = await contratoElegibleParaIncremento();
      await configurarIpcAnioAnterior();

      const [r1, r2] = await Promise.all([
        aplicarIncremento(access_token, contrato.id),
        aplicarIncremento(access_token, contrato.id),
      ]);

      expect([r1, r2].filter((r) => r.status === CREADO)).toHaveLength(1);
      const perdedora = [r1, r2].find((r) => r.status !== CREADO);
      expect(perdedora?.status).toBe(CONFLICTO);
      expect([
        'INCREMENTO_YA_APLICADO',
        'INCREMENTO_ANTES_DE_12_MESES',
      ]).toContain((perdedora?.body as CuerpoError).codigo);

      expect(await prisma.incrementoIPC.count()).toBe(1);
      const enBd = await prisma.contrato.findUniqueOrThrow({
        where: { id: contrato.id },
      });
      expect(enBd.canon_centavos).toBe(1_051_000);
    });
  });

  // ------------------------------------------------------------------
  // POST /contratos/:id/prorrogar
  // ------------------------------------------------------------------
  describe('prorrogar', () => {
    /** Término inicial de 12 meses que vence dentro de un mes (ventana abierta). */
    function contratoEnVentana() {
      const hoy = hoyEnBogota();
      const inicio = sumarMesesUTC(hoy, -11);
      const fin = sumarDiasUTC(sumarMesesUTC(inicio, 12), -1);
      return prepararContrato({ inicio, fin });
    }

    it('prorroga por el término inicial: nueva fecha_fin, canon igual, fila Prorroga y sin tocar el PDF', async () => {
      const hoy = hoyEnBogota();
      const { access_token, contrato } = await contratoEnVentana();
      const antes = await prisma.contrato.findUniqueOrThrow({
        where: { id: contrato.id },
      });
      const espias = espiarAlmacenamiento();

      const respuesta = await prorrogar(access_token, contrato.id).expect(
        HttpStatus.CREATED,
      );
      const cuerpo = respuesta.body as {
        contrato: ContratoRespuesta;
        prorroga: ProrrogaRespuesta;
      };
      const esperada = sumarMesesUTC(antes.fecha_fin, 12);

      expect(cuerpo.contrato.fecha_fin.slice(0, 10)).toBe(fechaISO(esperada));
      expect(esperada.getUTCFullYear()).toBe(
        antes.fecha_fin.getUTCFullYear() + 1,
      );
      expect(cuerpo.contrato.canon_centavos).toBe(antes.canon_centavos);
      expect(cuerpo.contrato).not.toHaveProperty('pdf_contrato_ruta');
      expect(cuerpo.prorroga).toMatchObject({ meses: 12, tipo: 'MANUAL' });
      expect(cuerpo.prorroga.fecha_fin_anterior.slice(0, 10)).toBe(
        fechaISO(antes.fecha_fin),
      );
      expect(cuerpo.prorroga.fecha_fin_nueva.slice(0, 10)).toBe(
        fechaISO(esperada),
      );
      expect(cuerpo.prorroga.fecha_aplicacion.slice(0, 10)).toBe(fechaISO(hoy));

      const despues = await prisma.contrato.findUniqueOrThrow({
        where: { id: contrato.id },
      });
      expect(despues.pdf_contrato_ruta).toBe(antes.pdf_contrato_ruta);
      expect(despues.canon_centavos).toBe(antes.canon_centavos);
      // B0.3-B: la prórroga genera SOLO el otrosí (v2, sin sobrescribir el
      // original v1); no borra, no firma y no descarga nada.
      expect(espias.subir).toHaveBeenCalledTimes(1);
      expect(espias.subir.mock.calls[0][1]).toBe(
        `contratos/${contrato.id}/v2-OTROSI_PRORROGA.pdf`,
      );
      expect(espias.subir.mock.calls[0][3]).toBe(false);
      for (const espia of espias.otros) {
        expect(espia).not.toHaveBeenCalled();
      }
      expect(await prisma.prorroga.count()).toBe(1);
    });

    it('la ventana es de 90 días antes del vencimiento, ambos extremos inclusive', async () => {
      const hoy = hoyEnBogota();
      const dentro = await prepararContrato({
        inicio: sumarMesesUTC(hoy, -12),
        fin: sumarDiasUTC(hoy, 90),
      });
      await prorrogar(dentro.access_token, dentro.contrato.id).expect(
        HttpStatus.CREATED,
      );

      const ultimoDia = await prepararContrato({
        inicio: sumarMesesUTC(hoy, -12),
        fin: hoy,
      });
      await prorrogar(ultimoDia.access_token, ultimoDia.contrato.id).expect(
        HttpStatus.CREATED,
      );

      const fuera = await prepararContrato({
        inicio: sumarMesesUTC(hoy, -12),
        fin: sumarDiasUTC(hoy, 91),
      });
      const respuesta = await prorrogar(
        fuera.access_token,
        fuera.contrato.id,
      ).expect(HttpStatus.CONFLICT);
      const cuerpo = respuesta.body as CuerpoError;

      expect(cuerpo.codigo).toBe('PRORROGA_FUERA_DE_VENTANA');
      expect(cuerpo.detalles?.puede_prorrogarse_desde).toBe(
        fechaISO(sumarDiasUTC(hoy, 1)),
      );
      expect(cuerpo.detalles?.puede_prorrogarse_hasta).toBe(
        fechaISO(sumarDiasUTC(hoy, 91)),
      );
      expect(
        await prisma.prorroga.count({
          where: { contrato_id: fuera.contrato.id },
        }),
      ).toBe(0);
    });

    it('un contrato lejos del vencimiento responde 409 PRORROGA_FUERA_DE_VENTANA', async () => {
      const hoy = hoyEnBogota();
      const { access_token, contrato } = await prepararContrato({
        inicio: sumarMesesUTC(hoy, -2),
        fin: sumarMesesUTC(hoy, 10),
      });

      const respuesta = await prorrogar(access_token, contrato.id).expect(
        HttpStatus.CONFLICT,
      );

      expect((respuesta.body as CuerpoError).codigo).toBe(
        'PRORROGA_FUERA_DE_VENTANA',
      );
    });

    it('la segunda prórroga usa el término inicial, no el ya alargado', async () => {
      const hoy = hoyEnBogota();
      // Término inicial de 12 meses, ya prorrogado una vez por otros 12:
      // hoy vence de nuevo dentro de 20 días (término total actual: 24).
      const finActual = sumarDiasUTC(hoy, 20);
      const inicio = sumarMesesUTC(sumarDiasUTC(finActual, 1), -24);
      const { access_token, contrato } = await prepararContrato({
        inicio,
        fin: finActual,
      });
      await prisma.prorroga.create({
        data: {
          contrato_id: contrato.id,
          fecha_aplicacion: sumarMesesUTC(hoy, -12),
          fecha_fin_anterior: sumarDiasUTC(sumarMesesUTC(inicio, 12), -1),
          fecha_fin_nueva: finActual,
          meses: 12,
          tipo: 'MANUAL',
        },
      });

      const respuesta = await prorrogar(access_token, contrato.id).expect(
        HttpStatus.CREATED,
      );
      const prorroga = (respuesta.body as { prorroga: ProrrogaRespuesta })
        .prorroga;

      expect(prorroga.meses).toBe(12);
      expect(prorroga.fecha_fin_nueva.slice(0, 10)).toBe(
        fechaISO(sumarMesesUTC(finActual, 12)),
      );
    });

    it('acepta meses explícitos y valida el rango 1 a 60', async () => {
      const { access_token, contrato } = await contratoEnVentana();

      for (const meses of [0, 61, 1.5]) {
        const respuesta = await prorrogar(access_token, contrato.id, {
          meses,
        }).expect(HttpStatus.BAD_REQUEST);
        expect((respuesta.body as CuerpoError).codigo).toBe('VALIDACION');
      }

      const antes = await prisma.contrato.findUniqueOrThrow({
        where: { id: contrato.id },
      });
      const respuesta = await prorrogar(access_token, contrato.id, {
        meses: 6,
      }).expect(HttpStatus.CREATED);
      const prorroga = (respuesta.body as { prorroga: ProrrogaRespuesta })
        .prorroga;

      expect(prorroga.meses).toBe(6);
      expect(prorroga.fecha_fin_nueva.slice(0, 10)).toBe(
        fechaISO(sumarMesesUTC(antes.fecha_fin, 6)),
      );
    });

    it('un contrato no ACTIVO responde 409 y uno ajeno 404', async () => {
      const { access_token, contrato } = await contratoEnVentana();
      const otro = await registrarArrendador(
        app,
        'Otro',
        'otro-pro@correo.com',
      );

      await prorrogar(otro.access_token, contrato.id).expect(
        HttpStatus.NOT_FOUND,
      );

      await prisma.contrato.update({
        where: { id: contrato.id },
        data: { estado: EstadoContrato.VENCIDO },
      });
      const respuesta = await prorrogar(access_token, contrato.id).expect(
        HttpStatus.CONFLICT,
      );
      expect((respuesta.body as CuerpoError).codigo).toBe('CONTRATO_NO_ACTIVO');
    });

    it('dos peticiones simultáneas: exactamente una tiene éxito', async () => {
      const { access_token, contrato } = await contratoEnVentana();
      const antes = await prisma.contrato.findUniqueOrThrow({
        where: { id: contrato.id },
      });

      const [r1, r2] = await Promise.all([
        prorrogar(access_token, contrato.id),
        prorrogar(access_token, contrato.id),
      ]);

      expect([r1, r2].filter((r) => r.status === CREADO)).toHaveLength(1);
      const perdedora = [r1, r2].find((r) => r.status !== CREADO);
      expect(perdedora?.status).toBe(CONFLICTO);
      expect(['PRORROGA_YA_APLICADA', 'PRORROGA_FUERA_DE_VENTANA']).toContain(
        (perdedora?.body as CuerpoError).codigo,
      );

      expect(await prisma.prorroga.count()).toBe(1);
      const despues = await prisma.contrato.findUniqueOrThrow({
        where: { id: contrato.id },
      });
      expect(despues.fecha_fin).toEqual(sumarMesesUTC(antes.fecha_fin, 12));
    });
  });

  it('POST /contratos/:id/renovar ya no existe (404)', async () => {
    const { access_token, contrato } = await contratoElegibleParaIncremento();

    await request(app.getHttpServer())
      .post(`/contratos/${contrato.id}/renovar`)
      .set('Authorization', `Bearer ${access_token}`)
      .expect(HttpStatus.NOT_FOUND);
  });
});
