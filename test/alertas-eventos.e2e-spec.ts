// Alertas por evento (B0.6-B2, parte 1; B-18 y B-69): cada cambio que le afecta al otro rol crea UNA alerta,
// dentro de la misma transacción y solo si el cambio ocurrió. Se comprueba con los endpoints reales y con
// los feeds de B0.6-B1: destinatario, tipo, `recurso`, que el otro rol no la ve y que una repetición, una
// transición no aplicada o un contrato sin cuenta vinculada no crean alerta.
import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EstadoPago, TipoAlerta } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AlertaSchedulerService } from '../src/alerta/alerta-scheduler.service';
import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/configurar-app';
import { formatearCentavosAPesos } from '../src/contrato/plantillas-contrato';
import {
  sumarDiasUTC,
  sumarMesesUTC,
} from '../src/common/fechas-contrato.util';
import { hoyEnBogota } from '../src/common/hoy-bogota.util';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  autenticarInquilino,
  crearContrato,
  crearInmueble,
  crearInquilino,
  registrarArrendador,
  RespuestaCrearContrato,
} from './helpers/crear-datos.helper';
import {
  enDias,
  fechaDeTexto,
  fechaISO,
  fechasMalFormadas,
} from './helpers/fechas.helper';
import { limpiarBd } from './helpers/limpiar-bd';

jest.setTimeout(240_000);

const { OK, CREATED, CONFLICT } = HttpStatus;

interface AlertaApi {
  id: string;
  tipo: string;
  mensaje: string;
  leida: boolean;
  recurso: null | {
    tipo: string;
    id: string | null;
    contrato_id: string | null;
    periodo?: string | null;
  };
}
interface FeedApi {
  items: AlertaApi[];
  no_leidas: number;
}
interface ErrorApi {
  codigo: string;
}

interface Escenario {
  tokenArrendador: string;
  arrendadorId: string;
  tokenInquilino: string | null;
  inquilinoId: string;
  contrato: RespuestaCrearContrato;
  unidadId: string;
  unidadNombre: string;
}

describe('Alertas por evento (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let scheduler: AlertaSchedulerService;
  let contador = 0;
  // La cuenta del inquilino se crea con el código (5 por minuto por IP): pagos, mantenimiento y
  // terminación comparten un solo escenario vinculado; terminación va al final porque cambia el contrato.
  let base: Escenario;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await limpiarBd(prisma);
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configurarApp(app);
    await app.init();
    scheduler = app.get(AlertaSchedulerService, { strict: false });
    base = await escenario({ vinculado: true });
  });

  afterAll(async () => {
    await limpiarBd(prisma);
    await app.close();
    await prisma.$disconnect();
  });

  // B-81: ninguna alerta de estos flujos (pagos, mantenimiento, terminación, aviso, prórrogas, incremento)
  // lleva una fecha AAAA-MM-DD ni d/m/aaaa sin ceros.
  afterEach(async () => {
    const alertas = await prisma.alerta.findMany({ select: { mensaje: true } });
    for (const { mensaje } of alertas) {
      expect(fechasMalFormadas(mensaje)).toEqual([]);
    }
  });

  function idDelToken(token: string): string {
    return (
      JSON.parse(
        Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
      ) as { id: string }
    ).id;
  }

  /** Arrendador + inmueble + contrato; con `vinculado` el inquilino crea su cuenta con el código. */
  async function escenario(opciones: {
    vinculado: boolean;
    contrato?: Record<string, unknown>;
  }): Promise<Escenario> {
    contador += 1;
    const n = contador;
    const { access_token } = await registrarArrendador(
      app,
      `Arrendador ${n}`,
      `eventos-${n}@correo.com`,
    );
    const inmueble = await crearInmueble(app, access_token, `EVT-${n}`);
    const inquilino = await crearInquilino(app, access_token);
    const contrato = await crearContrato(
      app,
      access_token,
      inmueble.unidades[0].id,
      inquilino.id,
      opciones.contrato ?? {},
    );
    const tokenInquilino = opciones.vinculado
      ? await autenticarInquilino(
          app,
          contrato.codigo_acceso?.codigo ?? '',
          `inquilino-eventos-${n}@correo.com`,
        )
      : null;
    return {
      tokenArrendador: access_token,
      arrendadorId: idDelToken(access_token),
      tokenInquilino,
      inquilinoId: contrato.inquilino.id,
      contrato,
      unidadId: inmueble.unidades[0].id,
      unidadNombre: inmueble.unidades[0].nombre,
    };
  }

  const auth = (token: string | null) => `Bearer ${token ?? ''}`;

  async function feedDelInquilino(e: Escenario): Promise<AlertaApi[]> {
    const r = await request(app.getHttpServer())
      .get('/inquilino/alertas?limite=50')
      .set('Authorization', auth(e.tokenInquilino))
      .expect(OK);
    return (r.body as FeedApi).items;
  }
  async function feedDelArrendador(e: Escenario): Promise<AlertaApi[]> {
    const r = await request(app.getHttpServer())
      .get('/alertas/feed?limite=50')
      .set('Authorization', auth(e.tokenArrendador))
      .expect(OK);
    return (r.body as FeedApi).items;
  }
  const deTipo = (items: AlertaApi[], tipo: TipoAlerta) =>
    items.filter((a) => a.tipo === tipo);

  const alertasEnBd = (where: object) => prisma.alerta.count({ where });

  // ---------------------------------------------------------------------------------------------
  describe('pagos (aprobar y rechazar)', () => {
    let e: Escenario;
    beforeAll(() => {
      e = base;
    });

    /** Un pago PENDIENTE del contrato, en el mes `mes` (1-12) de 2031: un dato, no una regla de fechas. */
    async function pagoPendiente(mes: number): Promise<string> {
      return (
        await prisma.pago.create({
          data: {
            arrendador_id: e.arrendadorId,
            contrato_id: e.contrato.id,
            monto_centavos: 1_000_000,
            fecha_reportada: new Date(Date.UTC(2031, mes - 1, 3)),
            periodo: new Date(Date.UTC(2031, mes - 1, 1)),
            estado: EstadoPago.PENDIENTE,
          },
          select: { id: true },
        })
      ).id;
    }
    const aprobar = (id: string) =>
      request(app.getHttpServer())
        .patch(`/pagos/${id}/aprobar`)
        .set('Authorization', auth(e.tokenArrendador));
    const rechazar = (id: string, cuerpo?: object) => {
      const peticion = request(app.getHttpServer())
        .patch(`/pagos/${id}/rechazar`)
        .set('Authorization', auth(e.tokenArrendador));
      return cuerpo ? peticion.send(cuerpo) : peticion;
    };

    it('aprobar: alerta PAGO_APROBADO al inquilino con el recurso del pago; el arrendador no la ve; repetir no crea otra', async () => {
      const id = await pagoPendiente(4);
      await aprobar(id).expect(OK);

      const alertas = deTipo(
        await feedDelInquilino(e),
        TipoAlerta.PAGO_APROBADO,
      );
      expect(alertas).toHaveLength(1);
      expect(alertas[0].mensaje).toBe('Tu pago de abril de 2031 fue aprobado.');
      expect(alertas[0].leida).toBe(false);
      expect(alertas[0].recurso).toEqual({
        tipo: 'PAGO',
        id,
        contrato_id: e.contrato.id,
        periodo: '2031-04-01',
      });
      const delArrendador = await feedDelArrendador(e);
      expect(
        delArrendador.filter((a) => a.tipo.startsWith('PAGO_')),
      ).toHaveLength(0);

      // Aprobación repetida: 409 y ninguna alerta nueva.
      const repetido = await aprobar(id).expect(CONFLICT);
      expect((repetido.body as ErrorApi).codigo).toBe('PAGO_YA_PROCESADO');
      expect(await alertasEnBd({ pago_id: id })).toBe(1);
    });

    it('rechazar con motivo y mensaje: el texto lleva el motivo en lenguaje humano y el mensaje tal cual', async () => {
      const id = await pagoPendiente(5);
      const mensaje = 'Sube una foto más clara, por favor.';
      await rechazar(id, { motivo: 'COMPROBANTE_ILEGIBLE', mensaje }).expect(
        OK,
      );

      const alertas = (await feedDelInquilino(e)).filter(
        (a) => a.recurso?.id === id,
      );
      expect(alertas).toHaveLength(1);
      expect(alertas[0].tipo).toBe(TipoAlerta.PAGO_RECHAZADO);
      expect(alertas[0].mensaje).toBe(
        `Tu pago de mayo de 2031 fue rechazado: el comprobante es ilegible. Mensaje del arrendador: ${mensaje}`,
      );
      expect(alertas[0].recurso).toEqual({
        tipo: 'PAGO',
        id,
        contrato_id: e.contrato.id,
        periodo: '2031-05-01',
      });
      expect(
        (await feedDelArrendador(e)).filter((a) => a.recurso?.id === id),
      ).toHaveLength(0);
    });

    it('rechazar sin motivo: texto genérico; rechazar de nuevo o aprobar un pago ya procesado no crea alerta', async () => {
      const id = await pagoPendiente(6);
      await rechazar(id).expect(OK);
      const alertas = (await feedDelInquilino(e)).filter(
        (a) => a.recurso?.id === id,
      );
      expect(alertas).toHaveLength(1);
      expect(alertas[0].mensaje).toBe(
        'Tu pago de junio de 2031 fue rechazado.',
      );

      await rechazar(id, { motivo: 'OTRO', mensaje: 'Otra vez' }).expect(
        CONFLICT,
      );
      await aprobar(id).expect(CONFLICT);
      expect(await alertasEnBd({ pago_id: id })).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('mantenimiento (B-69 y cambio de estado)', () => {
    let e: Escenario;
    beforeAll(() => {
      e = base;
    });

    const crearSolicitud = (clave?: string) => {
      const peticion = request(app.getHttpServer())
        .post('/solicitudes-mantenimiento')
        .set('Authorization', auth(e.tokenInquilino))
        .field('unidadId', e.unidadId)
        .field('descripcion', 'La llave del lavamanos gotea.')
        .field('urgencia', 'ALTO');
      if (clave) peticion.set('Idempotency-Key', clave);
      return peticion;
    };
    const cambiarEstado = (id: string, estado: string) =>
      request(app.getHttpServer())
        .patch(`/solicitudes-mantenimiento/${id}/estado`)
        .set('Authorization', auth(e.tokenArrendador))
        .send({ estado });

    it('crear una solicitud avisa al ARRENDADOR (B-69); el inquilino no ve esa alerta; la repetición idempotente no crea otra', async () => {
      const clave = 'clave-alertas-0001';
      const primera = await crearSolicitud(clave).expect(CREATED);
      const id = (primera.body as { id: string }).id;

      const alertas = deTipo(
        await feedDelArrendador(e),
        TipoAlerta.SOLICITUD_MANTENIMIENTO_CREADA,
      );
      expect(alertas).toHaveLength(1);
      expect(alertas[0].mensaje).toContain(e.unidadNombre);
      expect(alertas[0].recurso).toEqual({
        tipo: 'SOLICITUD_MANTENIMIENTO',
        id,
        contrato_id: null,
      });
      expect(
        deTipo(
          await feedDelInquilino(e),
          TipoAlerta.SOLICITUD_MANTENIMIENTO_CREADA,
        ),
      ).toHaveLength(0);

      // Misma Idempotency-Key y mismo contenido: devuelve la misma solicitud, sin otra alerta.
      const repetida = await crearSolicitud(clave).expect(CREATED);
      expect(repetida.headers['idempotent-replayed']).toBe('true');
      expect((repetida.body as { id: string }).id).toBe(id);
      expect(
        await alertasEnBd({
          solicitud_mantenimiento_id: id,
          tipo: TipoAlerta.SOLICITUD_MANTENIMIENTO_CREADA,
        }),
      ).toBe(1);
    });

    it('cada cambio de estado aplicado avisa al INQUILINO; una transición inválida (409) no crea alerta', async () => {
      const creada = await crearSolicitud().expect(CREATED);
      const id = (creada.body as { id: string }).id;
      const delInquilino = async () =>
        (await feedDelInquilino(e)).filter(
          (a) =>
            a.tipo === TipoAlerta.MANTENIMIENTO_CAMBIO_ESTADO &&
            a.recurso?.id === id,
        );

      await cambiarEstado(id, 'EN_PROCESO').expect(OK);
      let alertas = await delInquilino();
      expect(alertas).toHaveLength(1);
      expect(alertas[0].mensaje).toContain(e.unidadNombre);
      expect(alertas[0].mensaje).toContain('en proceso');
      expect(alertas[0].recurso).toEqual({
        tipo: 'SOLICITUD_MANTENIMIENTO',
        id,
        contrato_id: null,
      });
      expect(
        deTipo(
          await feedDelArrendador(e),
          TipoAlerta.MANTENIMIENTO_CAMBIO_ESTADO,
        ),
      ).toHaveLength(0);

      // EN_PROCESO otra vez: transición inválida.
      const invalida = await cambiarEstado(id, 'EN_PROCESO').expect(CONFLICT);
      expect((invalida.body as ErrorApi).codigo).toBe('TRANSICION_INVALIDA');
      expect(await delInquilino()).toHaveLength(1);

      await cambiarEstado(id, 'RESUELTO').expect(OK);
      alertas = await delInquilino();
      expect(alertas).toHaveLength(2);
      expect(alertas.some((a) => a.mensaje.includes('resuelta'))).toBe(true);

      // Un RESUELTO no cambia más.
      await cambiarEstado(id, 'EN_PROCESO').expect(CONFLICT);
      expect(await delInquilino()).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('terminación anticipada y aviso de no renovación: actúa el arrendador', () => {
    let e: Escenario;
    beforeAll(() => {
      e = base;
    });

    const delArrendadorHacia = (ruta: string, cuerpo: object = {}) =>
      request(app.getHttpServer())
        .post(`/contratos/${e.contrato.id}/${ruta}`)
        .set('Authorization', auth(e.tokenArrendador))
        .send(cuerpo);
    const delInquilinoHacia = (ruta: string, cuerpo: object = {}) =>
      request(app.getHttpServer())
        .post(`/inquilino/mi-contrato/${ruta}`)
        .set('Authorization', auth(e.tokenInquilino))
        .send(cuerpo);

    it('aviso de no renovación dado y cancelado por el arrendador: alertas al inquilino; repetir no crea otra', async () => {
      await delArrendadorHacia('aviso-no-renovacion').expect(CREATED);
      let alertas = deTipo(
        await feedDelInquilino(e),
        TipoAlerta.AVISO_NO_RENOVACION_DADO,
      );
      expect(alertas).toHaveLength(1);
      expect(alertas[0].mensaje).toContain(e.unidadNombre);
      expect(alertas[0].mensaje).toContain('arrendador');
      expect(alertas[0].recurso).toEqual({
        tipo: 'CONTRATO',
        id: e.contrato.id,
        contrato_id: e.contrato.id,
      });
      expect(
        deTipo(await feedDelArrendador(e), TipoAlerta.AVISO_NO_RENOVACION_DADO),
      ).toHaveLength(0);

      const repetido = await delArrendadorHacia('aviso-no-renovacion').expect(
        CONFLICT,
      );
      expect((repetido.body as ErrorApi).codigo).toBe('AVISO_YA_DADO');
      expect(
        await alertasEnBd({
          inquilino_id: e.inquilinoId,
          tipo: TipoAlerta.AVISO_NO_RENOVACION_DADO,
        }),
      ).toBe(1);

      await delArrendadorHacia('cancelar-aviso-no-renovacion').expect(CREATED);
      alertas = deTipo(
        await feedDelInquilino(e),
        TipoAlerta.AVISO_NO_RENOVACION_CANCELADO,
      );
      expect(alertas).toHaveLength(1);
      expect(alertas[0].mensaje).toContain('arrendador');
    });

    it('terminación solicitada y cancelada por el arrendador avisan al inquilino; cuando actúa el inquilino sigue avisando al arrendador', async () => {
      const cuerpo = { motivo: 'Acuerdo', fecha_efectiva: enDias(20) };
      await delArrendadorHacia(
        'solicitar-terminacion-anticipada',
        cuerpo,
      ).expect(CREATED);
      const solicitadas = deTipo(
        await feedDelInquilino(e),
        TipoAlerta.TERMINACION_ANTICIPADA_SOLICITADA,
      );
      expect(solicitadas).toHaveLength(1);
      expect(solicitadas[0].mensaje).toContain('arrendador');
      // B-81: la fecha efectiva va en dd/mm/aaaa.
      expect(solicitadas[0].mensaje).toContain(fechaDeTexto(enDias(20)));
      expect(solicitadas[0].recurso?.tipo).toBe('CONTRATO');

      // Repetir: 409 y sin alerta nueva.
      await delArrendadorHacia(
        'solicitar-terminacion-anticipada',
        cuerpo,
      ).expect(CONFLICT);
      expect(
        await alertasEnBd({
          inquilino_id: e.inquilinoId,
          tipo: TipoAlerta.TERMINACION_ANTICIPADA_SOLICITADA,
        }),
      ).toBe(1);

      await delArrendadorHacia('cancelar-terminacion-anticipada').expect(
        CREATED,
      );
      expect(
        deTipo(
          await feedDelInquilino(e),
          TipoAlerta.TERMINACION_ANTICIPADA_CANCELADA,
        ),
      ).toHaveLength(1);

      // Ahora pide el inquilino: la alerta va al ARRENDADOR (comportamiento que no cambia) y ...
      await delInquilinoHacia('solicitar-terminacion-anticipada', {
        motivo: 'Me mudo',
        fecha_efectiva: enDias(25),
      }).expect(CREATED);
      const alArrendador = deTipo(
        await feedDelArrendador(e),
        TipoAlerta.TERMINACION_ANTICIPADA_SOLICITADA,
      );
      expect(alArrendador).toHaveLength(1);
      expect(alArrendador[0].mensaje).toContain('El inquilino de la unidad');
      // ... el inquilino no recibe alerta de lo que él mismo hizo.
      expect(
        deTipo(
          await feedDelInquilino(e),
          TipoAlerta.TERMINACION_ANTICIPADA_SOLICITADA,
        ),
      ).toHaveLength(1);

      // El arrendador confirma: alerta CONFIRMADA al inquilino.
      await delArrendadorHacia('confirmar-terminacion-anticipada').expect(
        CREATED,
      );
      const confirmadas = deTipo(
        await feedDelInquilino(e),
        TipoAlerta.TERMINACION_ANTICIPADA_CONFIRMADA,
      );
      expect(confirmadas).toHaveLength(1);
      expect(confirmadas[0].mensaje).toContain('arrendador');
      expect(
        deTipo(
          await feedDelArrendador(e),
          TipoAlerta.TERMINACION_ANTICIPADA_CONFIRMADA,
        ),
      ).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('contrato sin cuenta de inquilino vinculada', () => {
    it('las acciones del arrendador funcionan y no crean alerta al inquilino (no hay a quién)', async () => {
      const e = await escenario({ vinculado: false });
      const ruta = (r: string) => `/contratos/${e.contrato.id}/${r}`;
      const arr = auth(e.tokenArrendador);

      await request(app.getHttpServer())
        .post(ruta('aviso-no-renovacion'))
        .set('Authorization', arr)
        .send({})
        .expect(CREATED);
      await request(app.getHttpServer())
        .post(ruta('cancelar-aviso-no-renovacion'))
        .set('Authorization', arr)
        .send({})
        .expect(CREATED);
      await request(app.getHttpServer())
        .post(ruta('solicitar-terminacion-anticipada'))
        .set('Authorization', arr)
        .send({ motivo: 'Acuerdo', fecha_efectiva: enDias(20) })
        .expect(CREATED);
      await request(app.getHttpServer())
        .post(ruta('cancelar-terminacion-anticipada'))
        .set('Authorization', arr)
        .send({})
        .expect(CREATED);

      expect(await alertasEnBd({ inquilino_id: e.inquilinoId })).toBe(0);
      expect(await alertasEnBd({ contrato_id: e.contrato.id })).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('prórroga manual', () => {
    it('avisa al inquilino con la nueva fecha de fin; una segunda prórroga rechazada no crea alerta', async () => {
      const hoy = hoyEnBogota();
      const inicio = sumarMesesUTC(hoy, -11);
      const fin = sumarDiasUTC(sumarMesesUTC(inicio, 12), -1);
      const e = await escenario({
        vinculado: true,
        contrato: { fecha_inicio: fechaISO(inicio), fecha_fin: fechaISO(fin) },
      });
      const prorrogar = () =>
        request(app.getHttpServer())
          .post(`/contratos/${e.contrato.id}/prorrogar`)
          .set('Authorization', auth(e.tokenArrendador))
          .send({});

      const r = await prorrogar().expect(CREATED);
      const nuevoFin = (
        r.body as { contrato: { fecha_fin: string } }
      ).contrato.fecha_fin.slice(0, 10);

      const alertas = deTipo(
        await feedDelInquilino(e),
        TipoAlerta.PRORROGA_APLICADA,
      );
      expect(alertas).toHaveLength(1);
      expect(alertas[0].mensaje).toContain(e.unidadNombre);
      // B-81: la nueva fecha de fin va en dd/mm/aaaa.
      expect(alertas[0].mensaje).toContain(fechaDeTexto(nuevoFin));
      expect(alertas[0].recurso).toEqual({
        tipo: 'CONTRATO',
        id: e.contrato.id,
        contrato_id: e.contrato.id,
      });
      expect(
        deTipo(await feedDelArrendador(e), TipoAlerta.PRORROGA_APLICADA),
      ).toHaveLength(0);

      // Fuera de la ventana: 409 y ninguna alerta nueva.
      await prorrogar().expect(CONFLICT);
      expect(
        await alertasEnBd({
          inquilino_id: e.inquilinoId,
          tipo: TipoAlerta.PRORROGA_APLICADA,
        }),
      ).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('incremento de canon', () => {
    it('avisa al inquilino con el canon nuevo; un segundo incremento rechazado no crea alerta', async () => {
      const hoy = hoyEnBogota();
      await prisma.configuracionIpc.upsert({
        where: { anio: hoy.getUTCFullYear() - 1 },
        update: {},
        create: { anio: hoy.getUTCFullYear() - 1, porcentaje: 5.1 },
      });
      const e = await escenario({
        vinculado: true,
        contrato: {
          fecha_inicio: fechaISO(sumarMesesUTC(hoy, -13)),
          fecha_fin: fechaISO(sumarMesesUTC(hoy, 11)),
        },
      });
      const aplicar = () =>
        request(app.getHttpServer())
          .post(`/contratos/${e.contrato.id}/aplicar-incremento`)
          .set('Authorization', auth(e.tokenArrendador))
          .send({});

      const r = await aplicar().expect(CREATED);
      const canonNuevo = (r.body as { contrato: { canon_centavos: number } })
        .contrato.canon_centavos;

      const alertas = deTipo(
        await feedDelInquilino(e),
        TipoAlerta.INCREMENTO_APLICADO,
      );
      expect(alertas).toHaveLength(1);
      expect(alertas[0].mensaje).toContain(e.unidadNombre);
      expect(alertas[0].mensaje).toContain(formatearCentavosAPesos(canonNuevo));
      expect(alertas[0].recurso).toEqual({
        tipo: 'CONTRATO',
        id: e.contrato.id,
        contrato_id: e.contrato.id,
      });
      expect(
        deTipo(await feedDelArrendador(e), TipoAlerta.INCREMENTO_APLICADO),
      ).toHaveLength(0);

      await aplicar().expect(CONFLICT);
      expect(
        await alertasEnBd({
          inquilino_id: e.inquilinoId,
          tipo: TipoAlerta.INCREMENTO_APLICADO,
        }),
      ).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('prórroga automática (cron)', () => {
    it('además de la alerta del arrendador hay una copia (otra fila) para el inquilino; correr de nuevo no duplica', async () => {
      const e = await escenario({ vinculado: true });
      // B-55: la API no crea contratos vencidos; se crea vigente y se vence directo en la base.
      await prisma.contrato.update({
        where: { id: e.contrato.id },
        data: { fecha_fin: sumarDiasUTC(hoyEnBogota(), -1) },
      });

      await scheduler.ejecutarVencimientosYProrrogas(hoyEnBogota());

      const alArrendador = deTipo(
        await feedDelArrendador(e),
        TipoAlerta.CONTRATO_PRORROGADO_AUTOMATICAMENTE,
      );
      const alInquilino = deTipo(
        await feedDelInquilino(e),
        TipoAlerta.CONTRATO_PRORROGADO_AUTOMATICAMENTE,
      );
      expect(alArrendador).toHaveLength(1);
      expect(alInquilino).toHaveLength(1);
      expect(alInquilino[0].id).not.toBe(alArrendador[0].id);
      expect(alInquilino[0].mensaje).toContain(e.unidadNombre);
      expect(alInquilino[0].recurso).toEqual({
        tipo: 'CONTRATO',
        id: e.contrato.id,
        contrato_id: e.contrato.id,
      });

      await scheduler.ejecutarVencimientosYProrrogas(hoyEnBogota());
      expect(
        await alertasEnBd({
          contrato_id: e.contrato.id,
          tipo: TipoAlerta.CONTRATO_PRORROGADO_AUTOMATICAMENTE,
        }),
      ).toBe(2);
    });
  });
});
