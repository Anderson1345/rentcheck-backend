// Alertas con destinatario arrendador O inquilino, feed por cursor, contador y "marcar todas"
// (B0.6-B1, B-18). Aquí se comprueba el comportamiento real de los endpoints nuevos y de los
// antiguos que se conservan: aislamiento entre usuarios y roles, paginación estable bajo inserciones,
// costo constante en consultas SQL, la restricción de un solo destinatario en la base y OpenAPI.
// Ninguna prueba depende de la fecha de hoy: las alertas llevan instantes explícitos (datos, no reglas).
import { HttpStatus, INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test, TestingModule } from '@nestjs/testing';
import {
  EstadoContrato,
  EstadoPago,
  Prisma,
  PrismaClient,
  TipoAlerta,
  TipoPlantillaContrato,
  TipoUnidad,
  UrgenciaMantenimiento,
  UsoPermitido,
} from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/configurar-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { registrarArrendador } from './helpers/crear-datos.helper';
import { limpiarBd } from './helpers/limpiar-bd';

const { OK, BAD_REQUEST, UNAUTHORIZED, NOT_FOUND } = HttpStatus;

// Instantes de los datos: un punto de partida cualquiera y desplazamientos en segundos.
const BASE = new Date('2031-04-01T15:00:00.000Z');
const en = (segundos: number): Date =>
  new Date(BASE.getTime() + segundos * 1000);
const dia = (texto: string): Date => new Date(`${texto}T00:00:00.000Z`);

interface AlertaApi {
  id: string;
  tipo: string;
  mensaje: string;
  leida: boolean;
  creado_en: string;
  recurso: null | {
    tipo: string;
    id: string | null;
    contrato_id: string | null;
    periodo?: string | null;
  };
}
interface FeedApi {
  items: AlertaApi[];
  siguiente_cursor: string | null;
  no_leidas: number;
}
interface ErrorApi {
  statusCode: number;
  codigo: string;
}

describe('Alertas: modelo con destinatario y feed por cursor (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let prismaDeLaApp: PrismaClient<Prisma.PrismaClientOptions, 'query'>;
  const consultas: string[] = [];

  let tokenA: string;
  let tokenB: string;
  let idA: string;
  let idB: string;
  let inquilino1: string;
  let inquilino2: string;
  let tokenI1: string;
  let tokenI2: string;

  const get = (ruta: string, token?: string) => {
    const peticion = request(app.getHttpServer()).get(ruta);
    return token ? peticion.set('Authorization', `Bearer ${token}`) : peticion;
  };
  const patch = (ruta: string, token?: string) => {
    const peticion = request(app.getHttpServer()).patch(ruta);
    return token ? peticion.set('Authorization', `Bearer ${token}`) : peticion;
  };

  function idDelToken(token: string): string {
    return (
      JSON.parse(
        Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
      ) as { id: string }
    ).id;
  }

  let contadorCedula = 7_000_000_000;
  async function nuevoInquilino(): Promise<string> {
    contadorCedula += 1;
    return (
      await prisma.inquilino.create({
        data: {
          nombre: 'Persona Prueba',
          cedula: String(contadorCedula),
          telefono: '3001112233',
        },
        select: { id: true },
      })
    ).id;
  }
  const tokenDeInquilino = (inquilinoId: string): string =>
    app.get(JwtService, { strict: false }).sign({ inquilinoId });

  /** Una alerta con destinatario y hora explícitos (no lee el reloj). */
  async function alerta(
    destino: { arrendador_id?: string; inquilino_id?: string },
    segundos: number,
    extra: Partial<Prisma.AlertaUncheckedCreateInput> = {},
  ): Promise<string> {
    return (
      await prisma.alerta.create({
        data: {
          tipo: TipoAlerta.CONTRATO_PROXIMO_A_VENCER,
          mensaje: `Alerta de prueba ${segundos}`,
          creado_en: en(segundos),
          ...destino,
          ...extra,
        },
        select: { id: true },
      })
    ).id;
  }

  async function alertasDe(
    destino: { arrendador_id?: string; inquilino_id?: string },
    cantidad: number,
    desde = 0,
  ): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < cantidad; i++) {
      ids.push(await alerta(destino, desde + i));
    }
    return ids;
  }

  const idsDe = (cuerpo: FeedApi): string[] => cuerpo.items.map((a) => a.id);

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await limpiarBd(prisma);

    // El cliente de Prisma de la APP registra cada consulta SQL (para contarlas).
    prismaDeLaApp = new PrismaClient<Prisma.PrismaClientOptions, 'query'>({
      adapter: new PrismaPg({
        connectionString: process.env.DATABASE_URL ?? '',
      }),
      log: [{ emit: 'event', level: 'query' }],
    });
    prismaDeLaApp.$on('query', (evento) => {
      consultas.push(evento.query);
    });
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaDeLaApp)
      .compile();
    app = moduleFixture.createNestApplication();
    configurarApp(app);
    await app.init();

    const a = await registrarArrendador(app, 'Arrendador A', 'al-a@correo.com');
    const b = await registrarArrendador(app, 'Arrendador B', 'al-b@correo.com');
    tokenA = a.access_token;
    tokenB = b.access_token;
    idA = idDelToken(tokenA);
    idB = idDelToken(tokenB);
    inquilino1 = await nuevoInquilino();
    inquilino2 = await nuevoInquilino();
    tokenI1 = tokenDeInquilino(inquilino1);
    tokenI2 = tokenDeInquilino(inquilino2);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // Cada prueba parte de cero alertas (los usuarios se conservan).
  beforeEach(async () => {
    await prisma.alerta.deleteMany();
  });

  describe('aislamiento', () => {
    it('cada arrendador y cada inquilino ve SOLO sus alertas, con su contador', async () => {
      const deA = await alertasDe({ arrendador_id: idA }, 3);
      const deB = await alertasDe({ arrendador_id: idB }, 2, 10);
      const deI1 = await alertasDe({ inquilino_id: inquilino1 }, 2, 20);
      const deI2 = await alertasDe({ inquilino_id: inquilino2 }, 1, 30);

      const feedA = (await get('/alertas/feed', tokenA).expect(OK))
        .body as FeedApi;
      expect(idsDe(feedA).sort()).toEqual([...deA].sort());
      expect(feedA.no_leidas).toBe(3);

      const feedB = (await get('/alertas/feed', tokenB).expect(OK))
        .body as FeedApi;
      expect(idsDe(feedB).sort()).toEqual([...deB].sort());

      const feedI1 = (await get('/inquilino/alertas', tokenI1).expect(OK))
        .body as FeedApi;
      expect(idsDe(feedI1).sort()).toEqual([...deI1].sort());
      expect(feedI1.no_leidas).toBe(2);

      const feedI2 = (await get('/inquilino/alertas', tokenI2).expect(OK))
        .body as FeedApi;
      expect(idsDe(feedI2)).toEqual(deI2);
    });

    it('un usuario sin alertas recibe el feed vacío', async () => {
      const feed = (await get('/alertas/feed', tokenA).expect(OK))
        .body as FeedApi;
      expect(feed).toEqual({ items: [], siguiente_cursor: null, no_leidas: 0 });
    });

    it('sin token: 401 en todas las rutas nuevas', async () => {
      await get('/alertas/feed').expect(UNAUTHORIZED);
      await get('/alertas/conteo').expect(UNAUTHORIZED);
      await patch('/alertas/leidas').expect(UNAUTHORIZED);
      await get('/inquilino/alertas').expect(UNAUTHORIZED);
      await get('/inquilino/alertas/conteo').expect(UNAUTHORIZED);
      await patch('/inquilino/alertas/leidas').expect(UNAUTHORIZED);
      await patch(
        '/inquilino/alertas/11111111-1111-4111-8111-111111111111/leida',
      ).expect(UNAUTHORIZED);
    });

    it('el token del otro rol recibe 401 (el patrón de los guards del repo)', async () => {
      await get('/alertas/feed', tokenI1).expect(UNAUTHORIZED);
      await get('/alertas/conteo', tokenI1).expect(UNAUTHORIZED);
      await patch('/alertas/leidas', tokenI1).expect(UNAUTHORIZED);
      await get('/inquilino/alertas', tokenA).expect(UNAUTHORIZED);
      await get('/inquilino/alertas/conteo', tokenA).expect(UNAUTHORIZED);
      await patch('/inquilino/alertas/leidas', tokenA).expect(UNAUTHORIZED);
    });

    it('lo ajeno o inexistente es 404: el inquilino no lee ni marca alertas del arrendador ni de otro inquilino', async () => {
      const deA = await alerta({ arrendador_id: idA }, 1);
      const deI2 = await alerta({ inquilino_id: inquilino2 }, 2);
      const propia = await alerta({ inquilino_id: inquilino1 }, 3);

      await patch(`/inquilino/alertas/${deA}/leida`, tokenI1).expect(NOT_FOUND);
      await patch(`/inquilino/alertas/${deI2}/leida`, tokenI1).expect(
        NOT_FOUND,
      );
      await patch(
        '/inquilino/alertas/99999999-9999-4999-8999-999999999999/leida',
        tokenI1,
      ).expect(NOT_FOUND);
      // El arrendador B tampoco marca la de A (ruta antigua, mismo comportamiento).
      await patch(`/alertas/${deA}/leida`, tokenB).expect(NOT_FOUND);
      // Y el inquilino no marca la suya como si fuera de otro.
      await patch(`/inquilino/alertas/${propia}/leida`, tokenI2).expect(
        NOT_FOUND,
      );

      const intactas = await prisma.alerta.findMany({
        where: { id: { in: [deA, deI2, propia] } },
        select: { leida: true },
      });
      expect(intactas.map((a) => a.leida)).toEqual([false, false, false]);

      const cuerpo = (
        await patch(`/inquilino/alertas/${deA}/leida`, tokenI1).expect(
          NOT_FOUND,
        )
      ).body as ErrorApi;
      expect(cuerpo.codigo).toBe('NO_ENCONTRADO');
    });

    it('un id que no es uuid es 404, como en el resto del repo (ParseIdPipe)', async () => {
      await patch('/inquilino/alertas/no-es-uuid/leida', tokenI1).expect(
        NOT_FOUND,
      );
    });
  });

  describe('paginación por cursor', () => {
    it('es estable con inserciones entre páginas: sin repetidos ni saltos, incluso con la misma hora', async () => {
      const destino = { inquilino_id: inquilino1 };
      // 7 alertas; las de los segundos 3, 4 y 5 comparten el mismo instante.
      const originales: string[] = [];
      for (const segundos of [1, 2, 3, 3, 3, 6, 7]) {
        originales.push(await alerta(destino, segundos));
      }
      const esperado = (
        await prisma.alerta.findMany({
          where: { inquilino_id: inquilino1 },
          orderBy: [{ creado_en: 'desc' }, { id: 'desc' }],
          select: { id: true },
        })
      ).map((a) => a.id);
      expect([...esperado].sort()).toEqual([...originales].sort());

      const pagina1 = (
        await get('/inquilino/alertas?limite=3', tokenI1).expect(OK)
      ).body as FeedApi;
      expect(idsDe(pagina1)).toEqual(esperado.slice(0, 3));
      expect(pagina1.siguiente_cursor).not.toBeNull();
      expect(pagina1.no_leidas).toBe(7);

      // Entre páginas entran alertas nuevas (más recientes) y una más vieja.
      await alerta(destino, 100);
      await alerta(destino, 101);
      await alerta(destino, 0);

      const pagina2 = (
        await get(
          `/inquilino/alertas?limite=3&cursor=${pagina1.siguiente_cursor}`,
          tokenI1,
        ).expect(OK)
      ).body as FeedApi;
      expect(idsDe(pagina2)).toEqual(esperado.slice(3, 6));
      expect(pagina2.siguiente_cursor).not.toBeNull();
      // El contador sí refleja lo nuevo.
      expect(pagina2.no_leidas).toBe(10);

      const pagina3 = (
        await get(
          `/inquilino/alertas?limite=3&cursor=${pagina2.siguiente_cursor}`,
          tokenI1,
        ).expect(OK)
      ).body as FeedApi;
      // Queda la última original y la más vieja que entró después (segundo 0).
      expect(idsDe(pagina3).slice(0, 1)).toEqual(esperado.slice(6, 7));
      expect(pagina3.items).toHaveLength(2);
      expect(pagina3.siguiente_cursor).toBeNull();

      const vistos = [...idsDe(pagina1), ...idsDe(pagina2), ...idsDe(pagina3)];
      expect(new Set(vistos).size).toBe(vistos.length);
      for (const id of originales) {
        expect(vistos).toContain(id);
      }
    });

    it('el arrendador pagina igual (misma lógica)', async () => {
      const ids = await alertasDe({ arrendador_id: idA }, 5);
      const pagina1 = (await get('/alertas/feed?limite=2', tokenA).expect(OK))
        .body as FeedApi;
      const pagina2 = (
        await get(
          `/alertas/feed?limite=2&cursor=${pagina1.siguiente_cursor}`,
          tokenA,
        ).expect(OK)
      ).body as FeedApi;
      const pagina3 = (
        await get(
          `/alertas/feed?limite=2&cursor=${pagina2.siguiente_cursor}`,
          tokenA,
        ).expect(OK)
      ).body as FeedApi;
      const todos = [...idsDe(pagina1), ...idsDe(pagina2), ...idsDe(pagina3)];
      expect(todos).toHaveLength(5);
      expect(todos.sort()).toEqual([...ids].sort());
      expect(pagina3.siguiente_cursor).toBeNull();
    });

    it('sin `limite` devuelve 20; con 50 acepta; con exactamente `limite` alertas no hay cursor', async () => {
      await alertasDe({ arrendador_id: idA }, 25);
      const porDefecto = (await get('/alertas/feed', tokenA).expect(OK))
        .body as FeedApi;
      expect(porDefecto.items).toHaveLength(20);
      expect(porDefecto.siguiente_cursor).not.toBeNull();
      const cincuenta = (
        await get('/alertas/feed?limite=50', tokenA).expect(OK)
      ).body as FeedApi;
      expect(cincuenta.items).toHaveLength(25);
      expect(cincuenta.siguiente_cursor).toBeNull();
      const justo = (await get('/alertas/feed?limite=25', tokenA).expect(OK))
        .body as FeedApi;
      expect(justo.items).toHaveLength(25);
      expect(justo.siguiente_cursor).toBeNull();
    });

    it('límite fuera de rango o cursor inválido: 400 VALIDACION', async () => {
      await alertasDe({ arrendador_id: idA }, 1);
      for (const consulta of [
        'limite=51',
        'limite=0',
        'limite=-1',
        'limite=abc',
        'limite=2.5',
        'cursor=',
        'cursor=esto-no-es-un-cursor',
        `cursor=${Buffer.from('{"creado_en":"ayer","id":"x"}').toString('base64url')}`,
        'leida=quizas',
      ]) {
        const respuesta = await get(`/alertas/feed?${consulta}`, tokenA).expect(
          BAD_REQUEST,
        );
        expect((respuesta.body as ErrorApi).codigo).toBe('VALIDACION');
        await get(`/inquilino/alertas?${consulta}`, tokenI1).expect(
          BAD_REQUEST,
        );
      }
    });
  });

  describe('filtro `leida` y contador', () => {
    it('`leida=false` y `leida=true` filtran los items; `no_leidas` cuenta siempre todas las no leídas', async () => {
      const ids = await alertasDe({ inquilino_id: inquilino1 }, 4);
      // B-80: leída ahora (con su `leida_en`, como la marca el servicio), así se sigue viendo.
      await prisma.alerta.updateMany({
        where: { id: { in: ids.slice(0, 1) } },
        data: { leida: true, leida_en: new Date() },
      });

      const sinLeer = (
        await get('/inquilino/alertas?leida=false', tokenI1).expect(OK)
      ).body as FeedApi;
      expect(sinLeer.items).toHaveLength(3);
      expect(sinLeer.items.every((a) => !a.leida)).toBe(true);
      expect(sinLeer.no_leidas).toBe(3);

      const leidas = (
        await get('/inquilino/alertas?leida=true', tokenI1).expect(OK)
      ).body as FeedApi;
      expect(idsDe(leidas)).toEqual([ids[0]]);
      expect(leidas.items[0].leida).toBe(true);
      expect(leidas.no_leidas).toBe(3);

      const todas = (await get('/inquilino/alertas', tokenI1).expect(OK))
        .body as FeedApi;
      expect(todas.items).toHaveLength(4);
      expect(todas.no_leidas).toBe(3);
    });

    it('GET .../conteo devuelve { no_leidas } para cada rol', async () => {
      const deA = await alertasDe({ arrendador_id: idA }, 3);
      await alertasDe({ inquilino_id: inquilino1 }, 2, 10);
      await prisma.alerta.update({
        where: { id: deA[0] },
        data: { leida: true },
      });
      expect((await get('/alertas/conteo', tokenA).expect(OK)).body).toEqual({
        no_leidas: 2,
      });
      expect(
        (await get('/inquilino/alertas/conteo', tokenI1).expect(OK)).body,
      ).toEqual({ no_leidas: 2 });
      expect(
        (await get('/inquilino/alertas/conteo', tokenI2).expect(OK)).body,
      ).toEqual({ no_leidas: 0 });
    });
  });

  describe('marcar como leída', () => {
    it('una alerta: devuelve la alerta con leida true y es idempotente', async () => {
      const id = await alerta({ inquilino_id: inquilino1 }, 1);
      const primera = (
        await patch(`/inquilino/alertas/${id}/leida`, tokenI1).expect(OK)
      ).body as AlertaApi;
      expect(primera.id).toBe(id);
      expect(primera.leida).toBe(true);
      expect(Object.keys(primera).sort()).toEqual(
        ['creado_en', 'id', 'leida', 'mensaje', 'recurso', 'tipo'].sort(),
      );
      const segunda = (
        await patch(`/inquilino/alertas/${id}/leida`, tokenI1).expect(OK)
      ).body as AlertaApi;
      expect(segunda).toEqual(primera);
      expect(
        (await get('/inquilino/alertas/conteo', tokenI1).expect(OK)).body,
      ).toEqual({ no_leidas: 0 });
    });

    it('todas: solo las propias y solo las no leídas; la segunda vez marca 0', async () => {
      await alertasDe({ arrendador_id: idA }, 3);
      await alertasDe({ arrendador_id: idB }, 2, 10);
      await alertasDe({ inquilino_id: inquilino1 }, 4, 20);
      await alertasDe({ inquilino_id: inquilino2 }, 1, 30);
      await prisma.alerta.updateMany({
        where: { arrendador_id: idA },
        data: { leida: true },
      });
      await alerta({ arrendador_id: idA }, 50);

      expect((await patch('/alertas/leidas', tokenA).expect(OK)).body).toEqual({
        marcadas: 1,
      });
      expect((await patch('/alertas/leidas', tokenA).expect(OK)).body).toEqual({
        marcadas: 0,
      });
      // Nada de lo ajeno se tocó.
      expect(await prisma.alerta.count({ where: { leida: false } })).toBe(
        2 + 4 + 1,
      );

      expect(
        (await patch('/inquilino/alertas/leidas', tokenI1).expect(OK)).body,
      ).toEqual({ marcadas: 4 });
      expect(await prisma.alerta.count({ where: { leida: false } })).toBe(
        2 + 1,
      );
      expect((await get('/alertas/conteo', tokenB).expect(OK)).body).toEqual({
        no_leidas: 2,
      });
      expect(
        (await get('/inquilino/alertas/conteo', tokenI2).expect(OK)).body,
      ).toEqual({ no_leidas: 1 });
    });
  });

  describe('campo derivado `recurso`', () => {
    it('el feed entrega el recurso de cada alerta con la prioridad pago > solicitud > período > contrato', async () => {
      const arrendador = idA;
      const inmueble = await prisma.inmueble.create({
        data: {
          arrendador_id: arrendador,
          direccion: 'Calle Recurso 1',
          ciudad: 'Bogotá',
          estrato: 3,
          matricula_inmobiliaria: 'M-RECURSO-1',
        },
        select: { id: true },
      });
      const unidad = await prisma.unidad.create({
        data: {
          inmueble_id: inmueble.id,
          nombre: 'Apto Recurso',
          tipo: TipoUnidad.APARTAMENTO,
          canon_base_centavos: 1_000_000,
          acepta_mascotas: false,
          uso_permitido: UsoPermitido.RESIDENCIAL,
        },
        select: { id: true },
      });
      const contrato = await prisma.contrato.create({
        data: {
          arrendador_id: arrendador,
          unidad_id: unidad.id,
          inquilino_id: inquilino1,
          inquilino_nombre: 'Persona Prueba',
          inquilino_cedula: '1020304050',
          inquilino_telefono: '3001112233',
          tipo_plantilla: TipoPlantillaContrato.VIVIENDA_URBANA_LEY_820,
          canon_centavos: 1_000_000,
          dia_pago: 5,
          forma_pago: 'Transferencia',
          datos_recaudo: 'Cuenta de prueba',
          fecha_inicio: dia('2031-01-01'),
          fecha_fin: dia('2031-12-31'),
          estado: EstadoContrato.ACTIVO,
        },
        select: { id: true },
      });
      const pago = await prisma.pago.create({
        data: {
          arrendador_id: arrendador,
          contrato_id: contrato.id,
          monto_centavos: 1_000_000,
          fecha_reportada: dia('2031-04-03'),
          periodo: dia('2031-04-01'),
          estado: EstadoPago.APROBADO,
        },
        select: { id: true },
      });
      const solicitud = await prisma.solicitudMantenimiento.create({
        data: {
          arrendador_id: arrendador,
          unidad_id: unidad.id,
          inquilino_id: inquilino1,
          descripcion: 'Fuga de agua',
          urgencia: UrgenciaMantenimiento.ALTO,
        },
        select: { id: true },
      });
      const destino = { inquilino_id: inquilino1 };
      const conPago = await alerta(destino, 5, {
        tipo: TipoAlerta.PAGO_APROBADO,
        pago_id: pago.id,
        contrato_id: contrato.id,
        solicitud_mantenimiento_id: solicitud.id,
        periodo: dia('2031-04-01'),
      });
      const conSolicitud = await alerta(destino, 4, {
        tipo: TipoAlerta.MANTENIMIENTO_CAMBIO_ESTADO,
        solicitud_mantenimiento_id: solicitud.id,
        contrato_id: contrato.id,
      });
      const conPeriodo = await alerta(destino, 3, {
        tipo: TipoAlerta.RECORDATORIO_PAGO_PROXIMO,
        contrato_id: contrato.id,
        periodo: dia('2031-05-01'),
      });
      const conContrato = await alerta(destino, 2, {
        contrato_id: contrato.id,
      });
      const sinRecurso = await alerta(destino, 1);

      const feed = (await get('/inquilino/alertas', tokenI1).expect(OK))
        .body as FeedApi;
      const porId = new Map(feed.items.map((a) => [a.id, a]));
      expect(porId.get(conPago)?.tipo).toBe('PAGO_APROBADO');
      expect(porId.get(conPago)?.recurso).toEqual({
        tipo: 'PAGO',
        id: pago.id,
        contrato_id: contrato.id,
        periodo: '2031-04-01',
      });
      expect(porId.get(conSolicitud)?.recurso).toEqual({
        tipo: 'SOLICITUD_MANTENIMIENTO',
        id: solicitud.id,
        contrato_id: null,
      });
      expect(porId.get(conPeriodo)?.recurso).toEqual({
        tipo: 'PERIODO',
        id: null,
        contrato_id: contrato.id,
        periodo: '2031-05-01',
      });
      expect(porId.get(conContrato)?.recurso).toEqual({
        tipo: 'CONTRATO',
        id: contrato.id,
        contrato_id: contrato.id,
      });
      expect(porId.get(sinRecurso)?.recurso).toBeNull();
    });
  });

  describe('costo en consultas SQL', () => {
    it('el feed hace las mismas consultas con 3 que con 30 alertas (arrendador e inquilino)', async () => {
      const medir = async (ruta: string, token: string): Promise<number> => {
        consultas.length = 0;
        await get(ruta, token).expect(OK);
        return consultas.length;
      };

      await alertasDe({ arrendador_id: idA }, 3);
      await alertasDe({ inquilino_id: inquilino1 }, 3, 100);
      const arrendadorCon3 = await medir('/alertas/feed?limite=50', tokenA);
      const inquilinoCon3 = await medir(
        '/inquilino/alertas?limite=50',
        tokenI1,
      );

      await alertasDe({ arrendador_id: idA }, 27, 200);
      await alertasDe({ inquilino_id: inquilino1 }, 27, 300);
      const arrendadorCon30 = await medir('/alertas/feed?limite=50', tokenA);
      const inquilinoCon30 = await medir(
        '/inquilino/alertas?limite=50',
        tokenI1,
      );

      expect(arrendadorCon30).toBe(arrendadorCon3);
      expect(inquilinoCon30).toBe(inquilinoCon3);
      expect(arrendadorCon3).toBeLessThanOrEqual(3);
      expect(inquilinoCon3).toBeLessThanOrEqual(3);
    });
  });

  describe('restricción de un solo destinatario en la base', () => {
    it('un insert sin destinatario o con los dos falla', async () => {
      await expect(
        prisma.alerta.create({
          data: { tipo: TipoAlerta.PAGO_APROBADO, mensaje: 'Sin destinatario' },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.alerta.create({
          data: {
            tipo: TipoAlerta.PAGO_APROBADO,
            mensaje: 'Con los dos',
            arrendador_id: idA,
            inquilino_id: inquilino1,
          },
        }),
      ).rejects.toThrow();
      expect(await prisma.alerta.count()).toBe(0);
    });

    it('la restricción CHECK existe en la base con su nombre', async () => {
      const filas = await prisma.$queryRaw<Array<{ conname: string }>>`
        SELECT conname FROM pg_constraint
        WHERE conrelid = '"Alerta"'::regclass AND contype = 'c'`;
      expect(filas.map((f) => f.conname)).toContain(
        'alerta_un_solo_destinatario',
      );
    });
  });

  describe('rutas antiguas del arrendador (obsoletas, sin cambios)', () => {
    const CLAVES_ANTIGUAS = [
      'arrendador_id',
      'contrato_id',
      'creado_en',
      'id',
      'leida',
      'mensaje',
      'solicitud_mantenimiento_id',
      'tipo',
    ];

    it('GET /alertas devuelve el mismo arreglo de siempre: solo las del arrendador, recientes primero y filtro `leida`', async () => {
      const ids = await alertasDe({ arrendador_id: idA }, 3);
      await alertasDe({ arrendador_id: idB }, 2, 10);
      await alertasDe({ inquilino_id: inquilino1 }, 2, 20);
      await prisma.alerta.update({
        where: { id: ids[0] },
        data: { leida: true },
      });

      const todas = (await get('/alertas', tokenA).expect(OK)).body as Array<
        Record<string, unknown>
      >;
      expect(Array.isArray(todas)).toBe(true);
      expect(todas.map((a) => a.id)).toEqual([ids[2], ids[1], ids[0]]);
      for (const item of todas) {
        expect(Object.keys(item).sort()).toEqual(CLAVES_ANTIGUAS);
        expect(item.arrendador_id).toBe(idA);
      }
      const sinLeer = (await get('/alertas?leida=false', tokenA).expect(OK))
        .body as Array<{ id: string }>;
      expect(sinLeer.map((a) => a.id)).toEqual([ids[2], ids[1]]);
    });

    it('PATCH /alertas/:id/leida devuelve la alerta con las mismas claves de siempre', async () => {
      const id = await alerta({ arrendador_id: idA }, 1);
      const cuerpo = (await patch(`/alertas/${id}/leida`, tokenA).expect(OK))
        .body as Record<string, unknown>;
      expect(Object.keys(cuerpo).sort()).toEqual(CLAVES_ANTIGUAS);
      expect(cuerpo.leida).toBe(true);
    });

    it('no chocan con las rutas nuevas: /alertas/leidas y /alertas/:id/leida son distintas', async () => {
      const id = await alerta({ arrendador_id: idA }, 1);
      await alerta({ arrendador_id: idA }, 2);
      expect((await patch('/alertas/leidas', tokenA).expect(OK)).body).toEqual({
        marcadas: 2,
      });
      await patch(`/alertas/${id}/leida`, tokenA).expect(OK);
    });
  });

  describe('OpenAPI', () => {
    interface Esquema {
      $ref?: string;
      type?: string;
      enum?: string[];
      properties?: Record<string, Esquema>;
      items?: Esquema;
      allOf?: Esquema[];
    }
    interface Operacion {
      deprecated?: boolean;
      description?: string;
      summary?: string;
      responses: Record<
        string,
        { content?: Record<string, { schema?: Esquema }> }
      >;
    }
    interface Documento {
      paths: Record<string, Record<string, Operacion>>;
      components: { schemas: Record<string, Esquema> };
    }
    let documento: Documento;
    beforeAll(() => {
      documento = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('t').build(),
      ) as unknown as Documento;
    });

    const refDe = (
      operacion: Operacion,
      codigo: string,
    ): string | undefined => {
      const esquema =
        operacion.responses[codigo]?.content?.['application/json']?.schema;
      return esquema?.$ref ?? esquema?.allOf?.[0]?.$ref;
    };

    it('las 7 rutas nuevas existen y devuelven su esquema, con 401 documentado', () => {
      const casos: Array<[string, string, string, string[]]> = [
        ['/alertas/feed', 'get', 'FeedAlertasDto', ['400', '401']],
        ['/alertas/conteo', 'get', 'ConteoAlertasDto', ['401']],
        ['/alertas/leidas', 'patch', 'MarcadasDto', ['401']],
        ['/inquilino/alertas', 'get', 'FeedAlertasDto', ['400', '401']],
        ['/inquilino/alertas/conteo', 'get', 'ConteoAlertasDto', ['401']],
        ['/inquilino/alertas/leidas', 'patch', 'MarcadasDto', ['401']],
        ['/inquilino/alertas/{id}/leida', 'patch', 'AlertaDto', ['401', '404']],
      ];
      for (const [ruta, metodo, esquema, codigos] of casos) {
        const operacion = documento.paths[ruta]?.[metodo];
        expect(operacion).toBeDefined();
        expect(
          refDe(operacion, '200') ?? operacion.responses['200']?.content,
        ).toBeDefined();
        expect(refDe(operacion, '200')).toBe(`#/components/schemas/${esquema}`);
        for (const codigo of codigos) {
          expect(Object.keys(operacion.responses)).toContain(codigo);
        }
      }
    });

    it('los esquemas nuevos existen, con sus campos, y los enums de tipo y de recurso están documentados', () => {
      const esquemas = documento.components.schemas;
      for (const nombre of [
        'AlertaDto',
        'AlertaRecursoDto',
        'FeedAlertasDto',
        'ConteoAlertasDto',
        'MarcadasDto',
      ]) {
        expect(
          Object.keys(esquemas[nombre]?.properties ?? {}),
        ).not.toHaveLength(0);
      }
      expect(Object.keys(esquemas.FeedAlertasDto.properties ?? {})).toEqual(
        expect.arrayContaining(['items', 'siguiente_cursor', 'no_leidas']),
      );
      expect(Object.keys(esquemas.AlertaDto.properties ?? {})).toEqual(
        expect.arrayContaining([
          'id',
          'tipo',
          'mensaje',
          'leida',
          'creado_en',
          'recurso',
        ]),
      );
      // Con enumName el enum sale como esquema propio (TipoAlerta, TipoRecursoAlerta) y la propiedad lo referencia.
      const enumDe = (propiedad?: Esquema): string[] => {
        const ref = propiedad?.$ref ?? propiedad?.allOf?.[0]?.$ref ?? '';
        return (
          propiedad?.enum ?? esquemas[ref.split('/').pop() ?? '']?.enum ?? []
        );
      };
      const tipos = enumDe(esquemas.AlertaDto.properties?.tipo);
      for (const valor of [
        'PAGO_APROBADO',
        'PAGO_RECHAZADO',
        'PAGO_ANULADO',
        'SOLICITUD_MANTENIMIENTO_CREADA',
        'MANTENIMIENTO_CAMBIO_ESTADO',
        'PRORROGA_APLICADA',
        'INCREMENTO_APLICADO',
        'TERMINACION_ANTICIPADA_SOLICITADA',
      ]) {
        expect(tipos).toContain(valor);
      }
      expect(enumDe(esquemas.AlertaRecursoDto.properties?.tipo)).toEqual([
        'PAGO',
        'SOLICITUD_MANTENIMIENTO',
        'PERIODO',
        'CONTRATO',
      ]);
    });

    it('GET /alertas queda marcada como obsoleta y remite a /alertas/feed', () => {
      const antigua = documento.paths['/alertas'].get;
      expect(antigua.deprecated).toBe(true);
      expect(antigua.description ?? '').toContain('/alertas/feed');
      expect(documento.paths['/alertas/{id}/leida'].patch.deprecated).not.toBe(
        true,
      );
    });

    it('cuenta de rutas y esquemas (antes: 74 rutas, 86 operaciones, 60 esquemas; ahora 81, 93 y 67)', () => {
      const rutas = Object.keys(documento.paths);
      const operaciones = rutas.reduce(
        (n, ruta) => n + Object.keys(documento.paths[ruta]).length,
        0,
      );
      const esquemas = Object.keys(documento.components.schemas).length;
      // Nuevas: 7 rutas con 7 operaciones y 7 esquemas (los 5 DTO y los enums TipoAlerta y TipoRecursoAlerta).
      expect(rutas).toHaveLength(74 + 7);
      expect(operaciones).toBe(86 + 7);
      // B0.7-B agregó 10 esquemas del Panel (9 DTO y el enum EstadoOcupacionUnidad), sin rutas nuevas.
      // B0.7-C documentó GET /contratos: 4 DTO y los enums EstadoPagoContrato y RolSolicitante.
      expect(esquemas).toBe(60 + 7 + 10 + 6);
    });
  });
});
