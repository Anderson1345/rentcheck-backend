import { HttpStatus, INestApplication, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { randomBytes } from 'crypto';
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
  crearContrato,
  crearInmueble,
  crearInquilino,
  registrarArrendador,
} from './helpers/crear-datos.helper';
import { limpiarBd } from './helpers/limpiar-bd';

const OK: number = HttpStatus.OK;
const ACEPTADO: number = HttpStatus.ACCEPTED;
const NO_AUTORIZADO: number = HttpStatus.UNAUTHORIZED;
const NO_DISPONIBLE: number = HttpStatus.SERVICE_UNAVAILABLE;

const DIA = 24 * 60 * 60 * 1000;
const iso = (fecha: Date): string => fecha.toISOString().slice(0, 10);

const TAREAS_ESPERADAS = [
  'terminaciones_programadas',
  'vencimientos_y_prorrogas',
  'activacion_contratos_programados',
  'aviso_contrato_por_vencer',
  'recordatorio_pago',
  'inquilino_en_mora',
  'mantenimiento_sin_atender',
  'ajuste_ipc_pendiente',
  'purga_alertas_leidas',
  'limpieza',
];

interface ResultadoTarea {
  tarea: string;
  estado: 'ok' | 'error';
  duracion_ms: number;
  detalle?: unknown;
}

/** Solo se simula `Date`: los temporizadores y los microtareas siguen reales. */
const RELOJ_SOLO_DATE = [
  'hrtime',
  'nextTick',
  'performance',
  'queueMicrotask',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'requestIdleCallback',
  'cancelIdleCallback',
  'setImmediate',
  'clearImmediate',
  'setInterval',
  'clearInterval',
  'setTimeout',
  'clearTimeout',
] as const;

describe('Tareas diarias (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let scheduler: AlertaSchedulerService;
  let contador = 0;
  let secreto: string;
  const hoy = hoyEnBogota();

  beforeEach(async () => {
    jest.spyOn(ThrottlerGuard.prototype, 'canActivate').mockResolvedValue(true);
    secreto = randomBytes(16).toString('hex');
    process.env.TAREAS_SECRET = secreto;
    prisma = new PrismaService();
    await prisma.$connect();
    await limpiarBd(prisma);

    const modulo: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = modulo.createNestApplication<INestApplication<App>>();
    configurarApp(app);
    await app.init();
    scheduler = modulo.get(AlertaSchedulerService);
  });

  afterEach(async () => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete process.env.TAREAS_SECRET;
    await app.close();
    await prisma.$disconnect();
  });

  afterAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await limpiarBd(prisma);
    await prisma.$disconnect();
  });

  // ------------------------------------------------------------------
  // Utilidades
  // ------------------------------------------------------------------
  async function escenario(
    fechas: { inicio?: Date; fin?: Date; canon?: number } = {},
  ) {
    contador += 1;
    const { access_token, arrendador } = await registrarArrendador(
      app,
      `Arrendador Tareas ${contador}`,
      `tareas-${contador}@correo.com`,
    );
    const inmueble = await crearInmueble(app, access_token, `TAR-${contador}`);
    const ficha = await crearInquilino(app, access_token);
    const contrato = await crearContrato(
      app,
      access_token,
      inmueble.unidades[0].id,
      ficha.id,
      {
        ...(fechas.inicio ? { fecha_inicio: iso(fechas.inicio) } : {}),
        ...(fechas.fin ? { fecha_fin: iso(fechas.fin) } : {}),
      },
    );
    return {
      token: access_token,
      arrendadorId: arrendador.id,
      unidadId: inmueble.unidades[0].id,
      inquilinoId: ficha.id,
      contratoId: contrato.id,
    };
  }

  const alertas = (tipo: string) =>
    prisma.alerta.count({ where: { tipo: tipo as never } });

  const todasLasAlertas = () => prisma.alerta.count();

  async function ejecutar(ahora?: Date): Promise<ResultadoTarea[]> {
    const resultado = await scheduler.ejecutarTareasDiarias(ahora);
    if (!Array.isArray(resultado)) {
      throw new Error('La corrida no debía estar en curso');
    }
    return resultado;
  }

  const llamar = (secretoEnviado?: string, consulta = '') => {
    const peticion = request(app.getHttpServer()).post(
      `/interno/tareas-diarias${consulta}`,
    );
    return secretoEnviado === undefined
      ? peticion
      : peticion.set('X-Tareas-Secret', secretoEnviado);
  };

  const esperarFinDeCorrida = async () => {
    for (let i = 0; i < 100 && scheduler.tareasEnCurso(); i += 1) {
      await new Promise((resolver) => setTimeout(resolver, 100));
    }
  };

  // ------------------------------------------------------------------
  // Hoy de Bogotá: reloj simulado a las 22:00 del 30/09 (03:00 UTC del 01/10)
  // ------------------------------------------------------------------
  describe('con el reloj a las 22:00 de Bogotá del 30/09 (03:00 UTC del 01/10)', () => {
    let tzOriginal: string | undefined;

    beforeEach(() => {
      // Con el servidor en UTC (como Render) el día local ya es el 01/10.
      tzOriginal = process.env.TZ;
      process.env.TZ = 'UTC';
    });

    afterEach(() => {
      if (tzOriginal === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = tzOriginal;
      }
    });

    const simularReloj = () =>
      jest.useFakeTimers({
        now: new Date('2026-10-01T03:00:00.000Z'),
        doNotFake: [...RELOJ_SOLO_DATE],
      });

    it('mantenimiento sin atender calcula el umbral con el 30/09: 5 días completos antes de esa medianoche de Bogotá', async () => {
      const { arrendadorId, unidadId, inquilinoId } = await escenario();
      const crearSolicitud = (creadoEn: string) =>
        prisma.solicitudMantenimiento.create({
          data: {
            arrendador_id: arrendadorId,
            unidad_id: unidadId,
            inquilino_id: inquilinoId,
            descripcion: `Solicitud ${creadoEn}`,
            urgencia: 'MEDIO',
            creado_en: new Date(creadoEn),
          },
          select: { id: true },
        });
      // Antes del umbral (24/09 23:00 en Bogotá): entra.
      const dentro = await crearSolicitud('2026-09-25T04:00:00.000Z');
      // Después del umbral (25/09 01:00 en Bogotá): todavía no.
      const fuera = await crearSolicitud('2026-09-25T06:00:00.000Z');

      simularReloj();
      const r = await scheduler.ejecutarMantenimientoSinAtender();
      jest.useRealTimers();

      expect(r).toEqual({ revisadas: 1, creadas: 1 });
      const creadas = await prisma.alerta.findMany({
        where: { tipo: 'SOLICITUD_MANTENIMIENTO_SIN_ATENDER' },
      });
      expect(creadas.map((a) => a.solicitud_mantenimiento_id)).toEqual([
        dentro.id,
      ]);
      expect(creadas[0].mensaje).toContain('lleva 5 día(s) sin atenderse');
      expect(fuera.id).not.toBe(dentro.id);
    }, 120000);

    it('ajuste de IPC pendiente calcula la ventana de 30 días desde el 30/09 (incluye el 30/10, no el 31/10)', async () => {
      const a = await escenario({
        inicio: new Date('2025-10-30T00:00:00Z'),
        fin: new Date('2027-10-29T00:00:00Z'),
      });
      const b = await escenario({
        inicio: new Date('2025-10-31T00:00:00Z'),
        fin: new Date('2027-10-30T00:00:00Z'),
      });

      simularReloj();
      const r = await scheduler.ejecutarAjusteIpcPendiente();
      jest.useRealTimers();

      expect(r.creadas).toBe(1);
      const creadas = await prisma.alerta.findMany({
        where: { tipo: 'AJUSTE_IPC_PENDIENTE' },
      });
      expect(creadas.map((x) => x.contrato_id)).toEqual([a.contratoId]);
      expect(creadas[0].mensaje).toContain('30/10/2026');
      expect(b.contratoId).not.toBe(a.contratoId);
    }, 120000);
  });

  // ------------------------------------------------------------------
  // Sin duplicados (regla 20)
  // ------------------------------------------------------------------
  describe('no duplica alertas al ejecutar dos veces el mismo día, aunque la primera esté leída', () => {
    // B-79: la mora se repite a los 7 días y el vencimiento una sola vez por fecha de fin; IPC y
    // mantenimiento siguen como antes (pueden volver a avisar al día siguiente).
    async function comprobarDedupe(
      tipo: string,
      preparar: () => Promise<void>,
      diaSiguiente: 'repite' | 'no_repite' = 'repite',
    ) {
      await preparar();
      const ahora = new Date();

      await ejecutar(ahora);
      expect(await alertas(tipo)).toBe(1);
      const totalDespuesDeLaPrimera = await todasLasAlertas();

      // Sin leer: como hoy, no repite el aviso.
      await ejecutar(ahora);
      expect(await alertas(tipo)).toBe(1);

      // Leída la primera: el mismo día tampoco se crea otra.
      await prisma.alerta.updateMany({
        data: { leida: true, leida_en: ahora },
      });
      await ejecutar(ahora);
      await ejecutar(new Date(ahora.getTime() + 60 * 1000));
      expect(await alertas(tipo)).toBe(1);
      expect(await todasLasAlertas()).toBe(totalDespuesDeLaPrimera);

      // Al día siguiente: IPC y mantenimiento pueden crear una nueva; mora y vencimiento no (B-79).
      await ejecutar(new Date(ahora.getTime() + DIA));
      expect(await alertas(tipo)).toBe(diaSiguiente === 'repite' ? 2 : 1);
    }

    it('contrato por vencer', async () => {
      await comprobarDedupe(
        'CONTRATO_PROXIMO_A_VENCER',
        async () => {
          await escenario({ fin: sumarDiasUTC(hoy, 10) });
        },
        'no_repite',
      );
    }, 180000);

    it('ajuste de IPC pendiente', async () => {
      await comprobarDedupe('AJUSTE_IPC_PENDIENTE', async () => {
        await escenario({
          inicio: sumarDiasUTC(sumarMesesUTC(hoy, -12), 10),
          fin: sumarDiasUTC(hoy, 300),
        });
      });
    }, 180000);

    it('inquilino en mora', async () => {
      await comprobarDedupe(
        'INQUILINO_EN_MORA',
        async () => {
          await escenario({
            inicio: sumarMesesUTC(hoy, -3),
            fin: sumarDiasUTC(hoy, 200),
          });
        },
        'no_repite',
      );
    }, 180000);

    it('mantenimiento sin atender', async () => {
      await comprobarDedupe('SOLICITUD_MANTENIMIENTO_SIN_ATENDER', async () => {
        const { arrendadorId, unidadId, inquilinoId } = await escenario();
        await prisma.solicitudMantenimiento.create({
          data: {
            arrendador_id: arrendadorId,
            unidad_id: unidadId,
            inquilino_id: inquilinoId,
            descripcion: 'Goteo',
            urgencia: 'BAJO',
            creado_en: new Date(Date.now() - 6 * DIA),
          },
        });
      });
    }, 180000);
  });

  // ------------------------------------------------------------------
  // Punto de entrada único
  // ------------------------------------------------------------------
  it('ejecutarTareasDiarias corre las tareas en el orden pedido y devuelve un resultado por tarea', async () => {
    const resultados = await ejecutar();

    expect(resultados.map((r) => r.tarea)).toEqual(TAREAS_ESPERADAS);
    for (const r of resultados) {
      expect(r.estado).toBe('ok');
      expect(r.duracion_ms).toEqual(expect.any(Number));
    }
  }, 60000);

  it('una tarea que lanza un error no impide que las demás corran y el resultado lo refleja', async () => {
    await escenario({ fin: sumarDiasUTC(hoy, 10) });
    jest
      .spyOn(scheduler, 'ejecutarVencimiento')
      .mockRejectedValueOnce(new Error('falla simulada con datos: cedula 123'));
    jest
      .spyOn(scheduler, 'ejecutarRecordatorioPago')
      .mockRejectedValueOnce(new Error('otra falla simulada'));

    const resultados = await ejecutar();

    expect(resultados.map((r) => r.tarea)).toEqual(TAREAS_ESPERADAS);
    const errores = resultados.filter((r) => r.estado === 'error');
    expect(errores.map((r) => r.tarea).sort()).toEqual([
      'aviso_contrato_por_vencer',
      'recordatorio_pago',
    ]);
    for (const error of errores) {
      // El detalle del error no repite el mensaje (puede traer datos).
      expect(JSON.stringify(error.detalle)).not.toContain('cedula');
    }
    expect(resultados.filter((r) => r.estado === 'ok')).toHaveLength(8);
  }, 60000);

  it('dos llamadas simultáneas: una corre y la otra recibe en_curso; las alertas son las de una sola corrida', async () => {
    await escenario({
      inicio: sumarMesesUTC(hoy, -3),
      fin: sumarDiasUTC(hoy, 200),
    });
    // Una tarea lenta deja la corrida abierta mientras entra la segunda llamada.
    const prototipo = Object.getPrototypeOf(
      scheduler,
    ) as AlertaSchedulerService;
    jest
      .spyOn(scheduler, 'ejecutarRecordatorioPago')
      .mockImplementation(async (hoyDia?: Date) => {
        await new Promise((resolver) => setTimeout(resolver, 400));
        return (await prototipo.ejecutarRecordatorioPago.call(
          scheduler,
          hoyDia,
        )) as Awaited<
          ReturnType<AlertaSchedulerService['ejecutarRecordatorioPago']>
        >;
      });

    const [primera, segunda] = await Promise.all([
      scheduler.ejecutarTareasDiarias(),
      scheduler.ejecutarTareasDiarias(),
    ]);

    expect(Array.isArray(primera)).toBe(true);
    expect(segunda).toEqual({ estado: 'en_curso' });
    expect(await alertas('INQUILINO_EN_MORA')).toBe(1);
    expect(scheduler.tareasEnCurso()).toBe(false);
    // Terminada la primera, una nueva corrida vuelve a estar permitida.
    expect(Array.isArray(await scheduler.ejecutarTareasDiarias())).toBe(true);
  }, 60000);

  // ------------------------------------------------------------------
  // Limpieza
  // ------------------------------------------------------------------
  it('la limpieza borra las filas viejas de las tres tablas y conserva las recientes y las vigentes', async () => {
    const ahora = new Date();
    const hace = (dias: number) => new Date(ahora.getTime() - dias * DIA);
    const despues = (dias: number) => new Date(ahora.getTime() + dias * DIA);
    const base = {
      proposito: 'VERIFICACION' as const,
      codigo_hash: 'a'.repeat(64),
    };

    await prisma.codigoCorreo.createMany({
      data: [
        // Borrar: consumido o vencido hace más de 1 día.
        {
          ...base,
          correo: 'c1@x.com',
          expira_en: despues(1),
          consumido_en: hace(2),
          creado_en: hace(3),
        },
        { ...base, correo: 'c2@x.com', expira_en: hace(2), creado_en: hace(3) },
        // Conservar: vigente, consumido hace poco, vencido hace poco.
        {
          ...base,
          correo: 'c3@x.com',
          expira_en: despues(1),
          creado_en: hace(0),
        },
        {
          ...base,
          correo: 'c4@x.com',
          expira_en: despues(1),
          consumido_en: new Date(ahora.getTime() - 3600000),
          creado_en: hace(0),
        },
        {
          ...base,
          correo: 'c5@x.com',
          expira_en: new Date(ahora.getTime() - 3600000),
          creado_en: hace(0),
        },
      ],
    });
    await prisma.intentoCodigo.createMany({
      data: [
        // Borrar: sin bloqueo vigente y de hace más de 1 día.
        {
          origen: 'ip:viejo-sin-bloqueo',
          fallidos: 2,
          actualizado_en: hace(2),
        },
        {
          origen: 'ip:viejo-bloqueo-vencido',
          fallidos: 5,
          bloqueado_hasta: hace(1.5),
          actualizado_en: hace(2),
        },
        // Conservar: bloqueo vigente (aunque viejo) y reciente.
        {
          origen: 'ip:viejo-bloqueo-vigente',
          fallidos: 5,
          bloqueado_hasta: despues(0.01),
          actualizado_en: hace(2),
        },
        {
          origen: 'ip:reciente',
          fallidos: 1,
          actualizado_en: new Date(ahora.getTime() - 3600000),
        },
      ],
    });
    const propietario = await escenario();
    await prisma.claveIdempotencia.createMany({
      data: [
        {
          inquilino_id: propietario.inquilinoId,
          endpoint: 'POST /pagos',
          clave: 'vieja',
          huella: 'h',
          creado_en: hace(8),
        },
        {
          inquilino_id: propietario.inquilinoId,
          endpoint: 'POST /pagos',
          clave: 'reciente',
          huella: 'h',
          creado_en: hace(6),
        },
      ],
    });

    const resultados = await ejecutar(ahora);

    const limpieza = resultados.find((r) => r.tarea === 'limpieza');
    expect(limpieza?.estado).toBe('ok');
    expect(limpieza?.detalle).toMatchObject({
      codigos_correo: 2,
      intentos_codigo: 2,
      claves_idempotencia: 1,
    });
    expect(
      (
        await prisma.codigoCorreo.findMany({
          select: { correo: true },
          orderBy: { correo: 'asc' },
        })
      ).map((c) => c.correo),
    ).toEqual(['c3@x.com', 'c4@x.com', 'c5@x.com']);
    expect(
      (
        await prisma.intentoCodigo.findMany({
          select: { origen: true },
          orderBy: { origen: 'asc' },
        })
      ).map((i) => i.origen),
    ).toEqual(['ip:reciente', 'ip:viejo-bloqueo-vigente']);
    expect(
      (
        await prisma.claveIdempotencia.findMany({ select: { clave: true } })
      ).map((c) => c.clave),
    ).toEqual(['reciente']);
  }, 120000);

  // ------------------------------------------------------------------
  // Endpoint POST /interno/tareas-diarias
  // ------------------------------------------------------------------
  describe('POST /interno/tareas-diarias', () => {
    it('sin encabezado o con uno incorrecto: el mismo 401 genérico', async () => {
      const sin = await llamar();
      const malo = await llamar('no-es-el-secreto');
      const casiIgual = await llamar(`${secreto}x`);

      for (const r of [sin, malo, casiIgual]) {
        expect(r.status).toBe(NO_AUTORIZADO);
        expect(r.body).toEqual(sin.body);
      }
      expect(JSON.stringify(sin.body)).not.toContain(secreto);
    });

    it('sin TAREAS_SECRET responde 503 TAREAS_NO_CONFIGURADAS (con o sin encabezado)', async () => {
      delete process.env.TAREAS_SECRET;
      const a = await llamar('lo-que-sea');
      const b = await llamar();
      for (const r of [a, b]) {
        expect(r.status).toBe(NO_DISPONIBLE);
        expect((r.body as { codigo: string }).codigo).toBe(
          'TAREAS_NO_CONFIGURADAS',
        );
      }
    });

    it('con el secreto correcto responde 202 iniciada y la corrida termina en segundo plano', async () => {
      const { contratoId } = await escenario({
        inicio: sumarMesesUTC(hoy, -3),
        fin: sumarDiasUTC(hoy, 200),
      });

      const r = await llamar(secreto);
      expect(r.status).toBe(ACEPTADO);
      expect(r.body).toEqual({ estado: 'iniciada' });

      await esperarFinDeCorrida();
      expect(await alertas('INQUILINO_EN_MORA')).toBe(1);
      expect(contratoId).toBeTruthy();
    }, 60000);

    it('con ?esperar=true espera y devuelve 200 con el resultado de cada tarea', async () => {
      const r = await llamar(secreto, '?esperar=true');

      expect(r.status).toBe(OK);
      const cuerpo = r.body as ResultadoTarea[];
      expect(cuerpo.map((t) => t.tarea)).toEqual(TAREAS_ESPERADAS);
      expect(cuerpo.every((t) => t.estado === 'ok')).toBe(true);
    }, 60000);

    it('una segunda corrida el mismo día no crea alertas nuevas', async () => {
      await escenario({
        inicio: sumarMesesUTC(hoy, -3),
        fin: sumarDiasUTC(hoy, 200),
      });
      await llamar(secreto, '?esperar=true').expect(OK);
      const primera = await todasLasAlertas();
      expect(primera).toBeGreaterThan(0);

      await llamar(secreto, '?esperar=true').expect(OK);
      await prisma.alerta.updateMany({
        data: { leida: true, leida_en: new Date() },
      });
      await llamar(secreto, '?esperar=true').expect(OK);

      expect(await todasLasAlertas()).toBe(primera);
    }, 120000);

    it('con una corrida en curso responde 202 en_curso', async () => {
      const prototipo = Object.getPrototypeOf(
        scheduler,
      ) as AlertaSchedulerService;
      jest
        .spyOn(scheduler, 'ejecutarRecordatorioPago')
        .mockImplementation(async (hoyDia?: Date) => {
          await new Promise((resolver) => setTimeout(resolver, 500));
          return (await prototipo.ejecutarRecordatorioPago.call(
            scheduler,
            hoyDia,
          )) as Awaited<
            ReturnType<AlertaSchedulerService['ejecutarRecordatorioPago']>
          >;
        });

      const [a, b] = await Promise.all([
        llamar(secreto, '?esperar=true'),
        llamar(secreto, '?esperar=true'),
      ]);

      const estados = [a.status, b.status].sort();
      expect(estados).toEqual([OK, ACEPTADO]);
      const enCurso = a.status === ACEPTADO ? a : b;
      expect(enCurso.body).toEqual({ estado: 'en_curso' });
      await esperarFinDeCorrida();
    }, 60000);

    it('el secreto nunca aparece en logs, respuestas ni en Swagger; el endpoint está excluido de Swagger', async () => {
      const salida: string[] = [];
      const capturar = (...partes: unknown[]) => {
        salida.push(partes.map((p) => String(p)).join(' '));
        return true;
      };
      jest.spyOn(process.stdout, 'write').mockImplementation(capturar);
      jest.spyOn(process.stderr, 'write').mockImplementation(capturar);
      for (const metodo of [
        'log',
        'warn',
        'error',
        'debug',
        'verbose',
      ] as const) {
        jest.spyOn(Logger.prototype, metodo).mockImplementation(capturar);
      }

      const respuestas = [
        await llamar(secreto),
        await llamar('incorrecto'),
        await llamar(secreto, '?esperar=true'),
      ];
      await esperarFinDeCorrida();
      jest.restoreAllMocks();
      jest
        .spyOn(ThrottlerGuard.prototype, 'canActivate')
        .mockResolvedValue(true);

      for (const r of respuestas) {
        expect(JSON.stringify(r.body)).not.toContain(secreto);
        expect(JSON.stringify(r.headers)).not.toContain(secreto);
      }
      expect(salida.join('\n')).not.toContain(secreto);
      // Sí se registró el resumen de la corrida.
      expect(salida.join('\n')).toMatch(/tareas diarias/i);

      const documento = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('prueba').build(),
      );
      expect(Object.keys(documento.paths).join('\n')).not.toContain('/interno');
      expect(JSON.stringify(documento)).not.toContain(secreto);
    }, 60000);
  });
});
