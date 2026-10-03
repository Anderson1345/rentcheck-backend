// B0.7-A: retención de alertas leídas (B-80), mora como máximo semanal y vencimiento una sola vez (B-79) y
// fechas dd/mm/aaaa en los textos (B-81). Las pruebas del feed usan fechas relativas al reloj real (hace N
// días), y las del cron un día simulado (15/03/2031) que se pasa a cada tarea: nada depende de la fecha
// de hoy.
import { HttpStatus, INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import {
  EstadoContrato,
  Prisma,
  TipoAlerta,
  TipoPlantillaContrato,
  TipoUnidad,
  UsoPermitido,
} from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AlertaSchedulerService } from '../src/alerta/alerta-scheduler.service';
import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/configurar-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { fechasMalFormadas } from './helpers/fechas.helper';
import { registrarArrendador } from './helpers/crear-datos.helper';
import { limpiarBd } from './helpers/limpiar-bd';

jest.setTimeout(120_000);

const { OK } = HttpStatus;
const DIA = 24 * 60 * 60 * 1000;
const MILLON = 1_000_000;
// 15/03/2031, 12:00 en Bogotá: el "hoy" simulado de las pruebas del cron.
const AHORA = new Date('2031-03-15T17:00:00.000Z');
const dia = (texto: string): Date => new Date(`${texto}T00:00:00.000Z`);
const haceDias = (dias: number, desde: Date = new Date()): Date =>
  new Date(desde.getTime() - dias * DIA);

interface AlertaApi {
  id: string;
  tipo: string;
  mensaje: string;
  leida: boolean;
}
interface FeedApi {
  items: AlertaApi[];
  siguiente_cursor: string | null;
  no_leidas: number;
}

describe('Alertas: retención, mora semanal, vencimiento único y fechas (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let scheduler: AlertaSchedulerService;
  let tokenA: string;
  let idA: string;
  let inquilinoId: string;
  let tokenI: string;
  let contadorCedula = 6_000_000_000;
  let contadorUnidad = 0;
  let inmuebleId: string | null = null;

  const get = (ruta: string, token: string) =>
    request(app.getHttpServer())
      .get(ruta)
      .set('Authorization', `Bearer ${token}`);
  const patch = (ruta: string, token: string) =>
    request(app.getHttpServer())
      .patch(ruta)
      .set('Authorization', `Bearer ${token}`);

  async function nuevoInquilino(): Promise<{ id: string; token: string }> {
    contadorCedula += 1;
    const { id } = await prisma.inquilino.create({
      data: {
        nombre: 'Persona Prueba',
        cedula: String(contadorCedula),
        telefono: '3001112233',
      },
      select: { id: true },
    });
    return {
      id,
      token: app.get(JwtService, { strict: false }).sign({ inquilinoId: id }),
    };
  }

  /** Una alerta del inquilino con creación y lectura explícitas (no lee el reloj del servidor). */
  async function alerta(datos: {
    creado: Date;
    leidaEn?: Date | null;
    destino?: { arrendador_id?: string; inquilino_id?: string };
  }): Promise<string> {
    return (
      await prisma.alerta.create({
        data: {
          tipo: TipoAlerta.CONTRATO_PROXIMO_A_VENCER,
          mensaje: 'Alerta de prueba',
          creado_en: datos.creado,
          leida: datos.leidaEn !== undefined && datos.leidaEn !== null,
          leida_en: datos.leidaEn ?? null,
          ...(datos.destino ?? { inquilino_id: inquilinoId }),
        },
        select: { id: true },
      })
    ).id;
  }

  async function feed(query = '', token = tokenI): Promise<FeedApi> {
    return (await get(`/inquilino/alertas${query}`, token).expect(OK))
      .body as FeedApi;
  }
  const ids = (f: FeedApi) => f.items.map((a) => a.id);

  async function nuevaUnidad(): Promise<{ id: string; nombre: string }> {
    if (!inmuebleId) {
      inmuebleId = (
        await prisma.inmueble.create({
          data: {
            arrendador_id: idA,
            direccion: 'Calle Retención 1',
            ciudad: 'Bogotá',
            estrato: 3,
            matricula_inmobiliaria: 'M-RET-1',
          },
          select: { id: true },
        })
      ).id;
    }
    contadorUnidad += 1;
    const nombre = `Apto R${contadorUnidad}`;
    const { id } = await prisma.unidad.create({
      data: {
        inmueble_id: inmuebleId,
        nombre,
        tipo: TipoUnidad.APARTAMENTO,
        canon_base_centavos: MILLON,
        acepta_mascotas: false,
        uso_permitido: UsoPermitido.RESIDENCIAL,
      },
      select: { id: true },
    });
    return { id, nombre };
  }

  /** Contrato ACTIVO con inquilino vinculado (para el cron). */
  async function nuevoContrato(opciones: {
    inicio: string;
    fin: string;
    extra?: Partial<Prisma.ContratoUncheckedCreateInput>;
  }) {
    const unidad = await nuevaUnidad();
    const inquilino = await nuevoInquilino();
    const { id } = await prisma.contrato.create({
      data: {
        arrendador_id: idA,
        unidad_id: unidad.id,
        inquilino_id: inquilino.id,
        inquilino_nombre: 'Persona Prueba',
        inquilino_cedula: '1020304050',
        inquilino_telefono: '3001112233',
        tipo_plantilla: TipoPlantillaContrato.VIVIENDA_URBANA_LEY_820,
        canon_centavos: MILLON,
        dia_pago: 5,
        forma_pago: 'Transferencia',
        datos_recaudo: 'Cuenta de prueba',
        fecha_inicio: dia(opciones.inicio),
        fecha_fin: dia(opciones.fin),
        estado: EstadoContrato.ACTIVO,
        vinculado_en: AHORA,
        ...opciones.extra,
      },
      select: { id: true },
    });
    return { contratoId: id, inquilinoId: inquilino.id, unidad: unidad.nombre };
  }

  const filas = (tipo: TipoAlerta, contratoId: string) =>
    prisma.alerta.findMany({
      where: { tipo, contrato_id: contratoId },
      select: {
        id: true,
        arrendador_id: true,
        inquilino_id: true,
        mensaje: true,
        creado_en: true,
      },
      orderBy: { creado_en: 'asc' },
    });

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

    const a = await registrarArrendador(
      app,
      'Arrendador Retención',
      'retencion-alertas@correo.com',
    );
    tokenA = a.access_token;
    idA = a.arrendador.id;
    const i = await nuevoInquilino();
    inquilinoId = i.id;
    tokenI = i.token;
  });

  afterAll(async () => {
    await limpiarBd(prisma);
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    await prisma.alerta.deleteMany();
    await prisma.pago.deleteMany();
    await prisma.incrementoIPC.deleteMany();
    await prisma.prorroga.deleteMany();
    await prisma.contrato.deleteMany();
  });

  // Ninguna alerta creada en estas pruebas lleva una fecha AAAA-MM-DD ni d/m/aaaa sin ceros (B-81).
  afterEach(async () => {
    const mensajes = (
      await prisma.alerta.findMany({ select: { mensaje: true } })
    ).map((a) => a.mensaje);
    for (const mensaje of mensajes) {
      expect(fechasMalFormadas(mensaje)).toEqual([]);
    }
  });

  // ---------------------------------------------------------------------------------------------
  describe('B-80: fecha de lectura (`leida_en`)', () => {
    it('marcar leída escribe leida_en; volver a marcarla no la cambia', async () => {
      const id = await alerta({ creado: haceDias(1) });
      const antes = Date.now();
      await patch(`/inquilino/alertas/${id}/leida`, tokenI).expect(OK);
      const primera = await prisma.alerta.findUniqueOrThrow({
        where: { id },
        select: { leida: true, leida_en: true },
      });
      expect(primera.leida).toBe(true);
      expect(primera.leida_en).not.toBeNull();
      expect(primera.leida_en!.getTime()).toBeGreaterThanOrEqual(antes - 1000);

      await patch(`/inquilino/alertas/${id}/leida`, tokenI).expect(OK);
      const segunda = await prisma.alerta.findUniqueOrThrow({
        where: { id },
        select: { leida_en: true },
      });
      expect(segunda.leida_en).toEqual(primera.leida_en);
    });

    it('marcar todas escribe leida_en solo en las que cambian (las ya leídas conservan la suya)', async () => {
      const yaLeidaEn = haceDias(3);
      const vieja = await alerta({ creado: haceDias(5), leidaEn: yaLeidaEn });
      const nueva1 = await alerta({ creado: haceDias(2) });
      const nueva2 = await alerta({ creado: haceDias(1) });

      const r = await patch('/inquilino/alertas/leidas', tokenI).expect(OK);
      expect(r.body).toEqual({ marcadas: 2 });

      const todas = await prisma.alerta.findMany({
        where: { id: { in: [vieja, nueva1, nueva2] } },
        select: { id: true, leida: true, leida_en: true },
      });
      const deId = (id: string) => todas.find((a) => a.id === id)!;
      expect(deId(vieja).leida_en).toEqual(yaLeidaEn);
      for (const id of [nueva1, nueva2]) {
        expect(deId(id).leida).toBe(true);
        expect(deId(id).leida_en!.getTime()).toBeGreaterThan(
          yaLeidaEn.getTime(),
        );
      }
    });

    it('marcar todas del arrendador y la ruta antigua PATCH /alertas/:id/leida también escriben leida_en (y la antigua no lo devuelve)', async () => {
      const a1 = await alerta({
        creado: haceDias(1),
        destino: { arrendador_id: idA },
      });
      const cuerpo = (await patch(`/alertas/${a1}/leida`, tokenA).expect(OK))
        .body as Record<string, unknown>;
      expect(cuerpo).not.toHaveProperty('leida_en');
      expect(
        (
          await prisma.alerta.findUniqueOrThrow({
            where: { id: a1 },
            select: { leida_en: true },
          })
        ).leida_en,
      ).not.toBeNull();

      const a2 = await alerta({
        creado: haceDias(1),
        destino: { arrendador_id: idA },
      });
      await patch('/alertas/leidas', tokenA).expect(OK);
      expect(
        (
          await prisma.alerta.findUniqueOrThrow({
            where: { id: a2 },
            select: { leida_en: true },
          })
        ).leida_en,
      ).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('B-80: el feed oculta las leídas de hace más de 7 días', () => {
    it('por defecto: no leídas de cualquier edad + leídas de los últimos 7 días', async () => {
      const noLeidaVieja = await alerta({ creado: haceDias(200) });
      const leidaHace6 = await alerta({
        creado: haceDias(30),
        leidaEn: haceDias(6),
      });
      const leidaHace8 = await alerta({
        creado: haceDias(9),
        leidaEn: haceDias(8),
      });

      const f = await feed();
      expect(ids(f)).toContain(noLeidaVieja);
      expect(ids(f)).toContain(leidaHace6);
      expect(ids(f)).not.toContain(leidaHace8);
      expect(f.no_leidas).toBe(1);

      // Las rutas antiguas no cambian: GET /alertas del arrendador sigue mostrando todas.
      const delA = await alerta({
        creado: haceDias(9),
        leidaEn: haceDias(8),
        destino: { arrendador_id: idA },
      });
      const antiguas = (await get('/alertas', tokenA).expect(OK)).body as {
        id: string;
      }[];
      expect(antiguas.map((a) => a.id)).toContain(delA);
      // El feed nuevo del arrendador la oculta, igual que el del inquilino.
      const feedA = (await get('/alertas/feed', tokenA).expect(OK))
        .body as FeedApi;
      expect(ids(feedA)).not.toContain(delA);
    });

    it('leida=true: solo las leídas de los últimos 7 días; leida=false: solo las no leídas', async () => {
      const noLeida = await alerta({ creado: haceDias(100) });
      const leidaHace6 = await alerta({
        creado: haceDias(7),
        leidaEn: haceDias(6),
      });
      await alerta({ creado: haceDias(9), leidaEn: haceDias(8) });

      expect(ids(await feed('?leida=true'))).toEqual([leidaHace6]);
      const sinLeer = await feed('?leida=false');
      expect(ids(sinLeer)).toEqual([noLeida]);
      expect(sinLeer.no_leidas).toBe(1);
    });

    it('el cursor recorre todas las visibles, en orden y sin las ocultas', async () => {
      const visibles: string[] = [];
      const ocultas: string[] = [];
      // 9 alertas intercaladas: cada tercera es una leída de hace 10 días (oculta).
      for (let i = 0; i < 9; i++) {
        const creado = haceDias(20 - i);
        if (i % 3 === 0) {
          ocultas.push(await alerta({ creado, leidaEn: haceDias(10) }));
        } else if (i % 3 === 1) {
          visibles.push(await alerta({ creado, leidaEn: haceDias(2) }));
        } else {
          visibles.push(await alerta({ creado }));
        }
      }

      const vistos: string[] = [];
      let cursor: string | null = null;
      do {
        const pagina: FeedApi = await feed(
          `?limite=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        );
        expect(pagina.items.length).toBeLessThanOrEqual(2);
        vistos.push(...ids(pagina));
        cursor = pagina.siguiente_cursor;
      } while (cursor);

      expect(vistos).toEqual([...visibles].reverse());
      for (const oculta of ocultas) expect(vistos).not.toContain(oculta);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('B-80: purga diaria de leídas de más de 60 días', () => {
    const tareaPurga = (resultados: unknown) =>
      (
        resultados as {
          tarea: string;
          estado: string;
          detalle?: unknown;
        }[]
      ).find((r) => r.tarea === 'purga_alertas_leidas');

    it('borra las leídas de hace 61 días, conserva las de 59 y las no leídas de cualquier edad, y lo reporta', async () => {
      const hace61 = await alerta({
        creado: haceDias(70, AHORA),
        leidaEn: haceDias(61, AHORA),
      });
      const hace59 = await alerta({
        creado: haceDias(70, AHORA),
        leidaEn: haceDias(59, AHORA),
      });
      const noLeidaVieja = await alerta({ creado: haceDias(400, AHORA) });

      const resultados = await scheduler.ejecutarTareasDiarias(AHORA);
      const purga = tareaPurga(resultados);
      expect(purga).toMatchObject({
        estado: 'ok',
        detalle: { alertasPurgadas: 1 },
      });

      const quedan = (
        await prisma.alerta.findMany({ select: { id: true } })
      ).map((a) => a.id);
      expect(quedan).not.toContain(hace61);
      expect(quedan).toEqual(expect.arrayContaining([hace59, noLeidaVieja]));
    });

    it('un fallo en la purga no tumba el resto de la corrida', async () => {
      jest
        .spyOn(
          scheduler as unknown as Record<string, () => Promise<unknown>>,
          'purgarAlertasLeidas',
        )
        .mockRejectedValueOnce(new Error('falla simulada'));
      const resultados = (await scheduler.ejecutarTareasDiarias(AHORA)) as {
        tarea: string;
        estado: string;
      }[];
      expect(tareaPurga(resultados)?.estado).toBe('error');
      const despues = resultados.slice(
        resultados.findIndex((r) => r.tarea === 'purga_alertas_leidas') + 1,
      );
      expect(despues.map((r) => r.tarea)).toContain('limpieza');
      expect(despues.every((r) => r.estado === 'ok')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('B-79: la mora se repite como máximo cada 7 días por contrato, período y destinatario', () => {
    // Sin pagos: enero (día 5) ya está vencido en todas las fechas usadas.
    const contratoEnMora = () =>
      nuevoContrato({ inicio: '2031-01-01', fin: '2031-12-31' });

    it('leída ayer: hoy no se repite', async () => {
      const c = await contratoEnMora();
      expect(
        (await scheduler.ejecutarInquilinoEnMora(haceDias(1, AHORA))).creadas,
      ).toBe(2);
      await prisma.alerta.updateMany({
        data: { leida: true, leida_en: haceDias(1, AHORA) },
      });

      expect((await scheduler.ejecutarInquilinoEnMora(AHORA)).creadas).toBe(0);
      expect(
        await filas(TipoAlerta.INQUILINO_EN_MORA, c.contratoId),
      ).toHaveLength(2);
    });

    it('creada hace 6 días (aunque esté leída) no se repite; creada hace 7 días sí, a los dos', async () => {
      const c = await contratoEnMora();
      await scheduler.ejecutarInquilinoEnMora(haceDias(6, AHORA));
      await prisma.alerta.updateMany({
        data: { leida: true, leida_en: haceDias(6, AHORA) },
      });
      expect((await scheduler.ejecutarInquilinoEnMora(AHORA)).creadas).toBe(0);

      await prisma.alerta.deleteMany();
      await scheduler.ejecutarInquilinoEnMora(haceDias(7, AHORA));
      expect((await scheduler.ejecutarInquilinoEnMora(AHORA)).creadas).toBe(2);
      const f = await filas(TipoAlerta.INQUILINO_EN_MORA, c.contratoId);
      expect(f.filter((x) => x.arrendador_id !== null)).toHaveLength(2);
      expect(f.filter((x) => x.inquilino_id !== null)).toHaveLength(2);
    });

    it('cada destinatario por separado: solo se repite la del que tiene la alerta vieja', async () => {
      const c = await contratoEnMora();
      await scheduler.ejecutarInquilinoEnMora(AHORA);
      // La del arrendador pasa a tener 7 días; la del inquilino sigue siendo de hoy.
      await prisma.alerta.updateMany({
        where: { contrato_id: c.contratoId, arrendador_id: idA },
        data: { creado_en: haceDias(7, AHORA) },
      });

      expect((await scheduler.ejecutarInquilinoEnMora(AHORA)).creadas).toBe(1);
      const f = await filas(TipoAlerta.INQUILINO_EN_MORA, c.contratoId);
      expect(f.filter((x) => x.arrendador_id !== null)).toHaveLength(2);
      expect(f.filter((x) => x.inquilino_id !== null)).toHaveLength(1);
    });

    it('otro período en mora (el anterior se pagó) avisa sin esperar los 7 días', async () => {
      const c = await contratoEnMora();
      await scheduler.ejecutarInquilinoEnMora(AHORA);
      await prisma.pago.create({
        data: {
          arrendador_id: idA,
          contrato_id: c.contratoId,
          monto_centavos: MILLON,
          fecha_reportada: dia('2031-01-05'),
          periodo: dia('2031-01-01'),
          estado: 'APROBADO',
        },
      });
      // Ahora el período vencido más antiguo es febrero: es otro evento.
      expect(
        (
          await scheduler.ejecutarInquilinoEnMora(
            new Date(AHORA.getTime() + 60_000),
          )
        ).creadas,
      ).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('B-79: el aviso de vencimiento sale una sola vez por contrato, destinatario y fecha de fin', () => {
    it('una sola alerta por destinatario aunque la lean y pasen los días; tras una prórroga, avisa la nueva fecha', async () => {
      const c = await nuevoContrato({
        inicio: '2030-04-01',
        fin: '2031-03-25', // vence en 10 días
      });
      expect((await scheduler.ejecutarVencimiento(AHORA)).creadas).toBe(2);
      await prisma.alerta.updateMany({
        data: { leida: true, leida_en: AHORA },
      });

      for (const dias of [1, 5, 9]) {
        expect(
          (
            await scheduler.ejecutarVencimiento(
              new Date(AHORA.getTime() + dias * DIA),
            )
          ).creadas,
        ).toBe(0);
      }
      expect(
        await filas(TipoAlerta.CONTRATO_PROXIMO_A_VENCER, c.contratoId),
      ).toHaveLength(2);

      // Prórroga: la fecha de fin pasa a 25/03/2032 y 20 días antes vuelve a avisar (una vez).
      await prisma.contrato.update({
        where: { id: c.contratoId },
        data: { fecha_fin: dia('2032-03-25') },
      });
      const antesDelNuevoFin = new Date('2032-03-05T17:00:00.000Z');
      expect(
        (await scheduler.ejecutarVencimiento(antesDelNuevoFin)).creadas,
      ).toBe(2);
      expect(
        (
          await scheduler.ejecutarVencimiento(
            new Date(antesDelNuevoFin.getTime() + DIA),
          )
        ).creadas,
      ).toBe(0);
      const f = await filas(TipoAlerta.CONTRATO_PROXIMO_A_VENCER, c.contratoId);
      expect(f).toHaveLength(4);
      expect(f[2].mensaje).toContain('25/03/2032');
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('B-81: fechas dd/mm/aaaa en los textos del cron', () => {
    it('vencimiento, recordatorio, mora, IPC y prórroga automática usan dd/mm/aaaa con ceros', async () => {
      // Vence el 05/04/2031 (día y mes de un dígito).
      const venc = await nuevoContrato({
        inicio: '2030-04-06',
        fin: '2031-04-05',
      });
      await scheduler.ejecutarVencimiento(AHORA);
      expect(
        (await filas(TipoAlerta.CONTRATO_PROXIMO_A_VENCER, venc.contratoId))[0]
          .mensaje,
      ).toContain('vence el 05/04/2031');

      // Mora: enero vence el 05/01/2031.
      const mora = await nuevoContrato({
        inicio: '2031-01-01',
        fin: '2031-12-31',
      });
      await scheduler.ejecutarInquilinoEnMora(AHORA);
      expect(
        (await filas(TipoAlerta.INQUILINO_EN_MORA, mora.contratoId))[0].mensaje,
      ).toContain('05/01/2031');

      // Recordatorio: el pago de marzo vence el 17/03/2031 (dentro de 3 días), con enero y febrero pagos.
      const recordatorio = await nuevoContrato({
        inicio: '2031-01-17',
        fin: '2031-12-31',
        extra: { dia_pago: 17 },
      });
      for (const mes of ['2031-01-01', '2031-02-01']) {
        await prisma.pago.create({
          data: {
            arrendador_id: idA,
            contrato_id: recordatorio.contratoId,
            monto_centavos: MILLON,
            fecha_reportada: dia(mes),
            periodo: dia(mes),
            estado: 'APROBADO',
          },
        });
      }
      await scheduler.ejecutarRecordatorioPago(dia('2031-03-15'));
      const recordatorios = await filas(
        TipoAlerta.RECORDATORIO_PAGO_PROXIMO,
        recordatorio.contratoId,
      );
      expect(recordatorios).toHaveLength(1);
      expect(recordatorios[0].mensaje).toMatch(
        /vence el \d{2}\/\d{2}\/\d{4}\./,
      );

      // IPC: el ajuste vence el 01/04/2031 (12 meses después del inicio).
      const ipc = await nuevoContrato({
        inicio: '2030-04-01',
        fin: '2032-03-31',
      });
      await scheduler.ejecutarAjusteIpcPendiente(AHORA);
      expect(
        (await filas(TipoAlerta.AJUSTE_IPC_PENDIENTE, ipc.contratoId))[0]
          .mensaje,
      ).toContain('01/04/2031');

      // Prórroga automática: el contrato vencido se prorroga hasta el 09/03/2032.
      const prorroga = await nuevoContrato({
        inicio: '2030-03-10',
        fin: '2031-03-09',
      });
      await scheduler.ejecutarVencimientosYProrrogas(dia('2031-03-15'));
      const prorrogadas = await filas(
        TipoAlerta.CONTRATO_PRORROGADO_AUTOMATICAMENTE,
        prorroga.contratoId,
      );
      expect(prorrogadas.length).toBeGreaterThanOrEqual(1);
      for (const p of prorrogadas) {
        expect(p.mensaje).toMatch(/hasta el \d{2}\/\d{2}\/\d{4} /);
      }
    });
  });
});
