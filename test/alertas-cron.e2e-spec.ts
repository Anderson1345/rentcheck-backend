// Alertas del cron (B0.6-B2, parte 2; B-18, B-77 y B-78): el recordatorio de pago va al INQUILINO, la mora y el
// vencimiento a ambos roles (una fila para cada uno), un incremento vencido SÍ avisa (B-78) y el estado de pago de
// los contratos cerrados se recalcula sin alertas de mora (B-77). El reloj es simulado: cada tarea recibe su
// `ahora`/`hoy` y todos los datos son relativos a ese día (15/03/2031), nunca a la fecha real de hoy.
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import {
  EstadoContrato,
  EstadoPago,
  EstadoPagoContrato,
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
import { sumarDiasUTC } from '../src/common/fechas-contrato.util';
import { hoyEnBogota } from '../src/common/hoy-bogota.util';
import { configurarApp } from '../src/configurar-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { registrarArrendador } from './helpers/crear-datos.helper';
import { limpiarBd } from './helpers/limpiar-bd';

jest.setTimeout(120_000);

// 15/03/2031, 12:00 en Bogotá: un día fijo a mitad de mes, igual para todas las pruebas.
const AHORA = new Date('2031-03-15T17:00:00.000Z');
const dia = (texto: string): Date => new Date(`${texto}T00:00:00.000Z`);
const masDias = (fecha: Date, dias: number): Date =>
  new Date(fecha.getTime() + dias * 24 * 60 * 60 * 1000);
const MILLON = 1_000_000;

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

describe('Alertas del cron (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let scheduler: AlertaSchedulerService;
  let tokenArrendador: string;
  let arrendadorId: string;
  let contadorUnidad = 0;
  let contadorCedula = 8_000_000_000;

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

    const registro = await registrarArrendador(
      app,
      'Arrendador Cron',
      'cron-alertas@correo.com',
    );
    tokenArrendador = registro.access_token;
    arrendadorId = registro.arrendador.id;
  });

  afterAll(async () => {
    await limpiarBd(prisma);
    await app.close();
    await prisma.$disconnect();
  });

  // Cada prueba parte sin alertas ni contratos (el arrendador se conserva).
  beforeEach(async () => {
    await prisma.alerta.deleteMany();
    await prisma.pago.deleteMany();
    await prisma.incrementoIPC.deleteMany();
    await prisma.contrato.deleteMany();
  });

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

  let inmuebleId: string | null = null;
  async function nuevaUnidad(): Promise<{ id: string; nombre: string }> {
    if (!inmuebleId) {
      inmuebleId = (
        await prisma.inmueble.create({
          data: {
            arrendador_id: arrendadorId,
            direccion: 'Calle Cron 1',
            ciudad: 'Bogotá',
            estrato: 3,
            matricula_inmobiliaria: 'M-CRON-1',
          },
          select: { id: true },
        })
      ).id;
    }
    contadorUnidad += 1;
    const nombre = `Apto ${contadorUnidad}`;
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

  /** Un contrato con inquilino `vinculado` (cuenta creada) o sin vincular. */
  async function nuevoContrato(opciones: {
    inicio: string;
    fin: string;
    diaPago?: number;
    estado?: EstadoContrato;
    vinculado?: boolean;
    estadoPago?: EstadoPagoContrato;
    extra?: Partial<Prisma.ContratoUncheckedCreateInput>;
  }) {
    const unidad = await nuevaUnidad();
    const inquilino = await nuevoInquilino();
    const contrato = await prisma.contrato.create({
      data: {
        arrendador_id: arrendadorId,
        unidad_id: unidad.id,
        inquilino_id: inquilino.id,
        inquilino_nombre: 'Persona Prueba',
        inquilino_cedula: '1020304050',
        inquilino_telefono: '3001112233',
        tipo_plantilla: TipoPlantillaContrato.VIVIENDA_URBANA_LEY_820,
        canon_centavos: MILLON,
        dia_pago: opciones.diaPago ?? 5,
        forma_pago: 'Transferencia',
        datos_recaudo: 'Cuenta de prueba',
        fecha_inicio: dia(opciones.inicio),
        fecha_fin: dia(opciones.fin),
        estado: opciones.estado ?? EstadoContrato.ACTIVO,
        vinculado_en: opciones.vinculado === false ? null : AHORA,
        ...(opciones.estadoPago ? { estado_pago: opciones.estadoPago } : {}),
        ...opciones.extra,
      },
      select: { id: true },
    });
    return {
      contratoId: contrato.id,
      inquilinoId: inquilino.id,
      tokenInquilino: inquilino.token,
      unidad: unidad.nombre,
    };
  }

  async function pagarMes(
    contratoId: string,
    periodo: string,
    estado: EstadoPago = EstadoPago.APROBADO,
  ) {
    await prisma.pago.create({
      data: {
        arrendador_id: arrendadorId,
        contrato_id: contratoId,
        monto_centavos: MILLON,
        fecha_reportada: dia(periodo),
        periodo: dia(periodo),
        estado,
      },
    });
  }

  async function feed(ruta: string, token: string): Promise<AlertaApi[]> {
    const r = await request(app.getHttpServer())
      .get(`${ruta}?limite=50`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return (r.body as { items: AlertaApi[] }).items;
  }
  const feedInquilino = (token: string) => feed('/inquilino/alertas', token);
  const feedArrendador = () => feed('/alertas/feed', tokenArrendador);
  const deTipo = (items: AlertaApi[], tipo: TipoAlerta) =>
    items.filter((a) => a.tipo === tipo);
  const filas = (tipo: TipoAlerta, contratoId: string) =>
    prisma.alerta.findMany({
      where: { tipo, contrato_id: contratoId },
      select: { arrendador_id: true, inquilino_id: true, leida: true },
    });

  const hoy = hoyEnBogota(AHORA);

  // ---------------------------------------------------------------------------------------------
  describe('recordatorio de pago próximo: ahora es para el INQUILINO', () => {
    /** Contrato con enero y febrero pagados; marzo vence el 17 (en 2 días). */
    async function contratoConMarzoPorVencer(vinculado = true) {
      const c = await nuevoContrato({
        inicio: '2031-01-01',
        fin: '2031-12-31',
        diaPago: 17,
        vinculado,
      });
      await pagarMes(c.contratoId, '2031-01-01');
      await pagarMes(c.contratoId, '2031-02-01');
      return c;
    }

    it('avisa al inquilino (no al arrendador), con el período como recurso, y no duplica el mismo día ni al día siguiente', async () => {
      const c = await contratoConMarzoPorVencer();
      const r1 = await scheduler.ejecutarRecordatorioPago(hoy);
      expect(r1.creadas).toBe(1);

      const delInquilino = deTipo(
        await feedInquilino(c.tokenInquilino),
        TipoAlerta.RECORDATORIO_PAGO_PROXIMO,
      );
      expect(delInquilino).toHaveLength(1);
      expect(delInquilino[0].mensaje).toContain(c.unidad);
      expect(delInquilino[0].mensaje).toContain('tu pago');
      expect(delInquilino[0].recurso).toEqual({
        tipo: 'PERIODO',
        id: null,
        contrato_id: c.contratoId,
        periodo: '2031-03-01',
      });
      expect(
        deTipo(await feedArrendador(), TipoAlerta.RECORDATORIO_PAGO_PROXIMO),
      ).toHaveLength(0);

      // El mismo día, y el día siguiente (dentro de los 20 días): ninguna alerta nueva.
      expect((await scheduler.ejecutarRecordatorioPago(hoy)).creadas).toBe(0);
      expect(
        (await scheduler.ejecutarRecordatorioPago(sumarDiasUTC(hoy, 1)))
          .creadas,
      ).toBe(0);
      expect(
        await filas(TipoAlerta.RECORDATORIO_PAGO_PROXIMO, c.contratoId),
      ).toHaveLength(1);
    });

    it('una alerta de recordatorio ya enviada al ARRENDADOR (antes del cambio) no impide avisar al inquilino', async () => {
      const c = await contratoConMarzoPorVencer();
      await prisma.alerta.create({
        data: {
          arrendador_id: arrendadorId,
          tipo: TipoAlerta.RECORDATORIO_PAGO_PROXIMO,
          contrato_id: c.contratoId,
          mensaje: 'Recordatorio antiguo para el arrendador.',
          creado_en: masDias(AHORA, -1),
        },
      });
      const r = await scheduler.ejecutarRecordatorioPago(hoy);
      expect(r.creadas).toBe(1);
      const f = await filas(TipoAlerta.RECORDATORIO_PAGO_PROXIMO, c.contratoId);
      expect(f.filter((x) => x.inquilino_id === c.inquilinoId)).toHaveLength(1);
      expect(f.filter((x) => x.arrendador_id !== null)).toHaveLength(1);
    });

    it('un contrato sin cuenta de inquilino vinculada no genera recordatorio (no hay a quién)', async () => {
      const c = await contratoConMarzoPorVencer(false);
      const r = await scheduler.ejecutarRecordatorioPago(hoy);
      expect(r.creadas).toBe(0);
      expect(
        await filas(TipoAlerta.RECORDATORIO_PAGO_PROXIMO, c.contratoId),
      ).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('inquilino en mora: una fila para cada rol', () => {
    it('crea la alerta del arrendador y la del inquilino, con su propio `leida`, y no duplica al correr de nuevo', async () => {
      // Sin ningún pago: enero, febrero y marzo (día 5) están vencidos.
      const c = await nuevoContrato({
        inicio: '2031-01-01',
        fin: '2031-12-31',
      });
      const r1 = await scheduler.ejecutarInquilinoEnMora(AHORA);
      expect(r1.enMora).toBe(1);
      expect(r1.creadas).toBe(2);

      const delArrendador = deTipo(
        await feedArrendador(),
        TipoAlerta.INQUILINO_EN_MORA,
      );
      const delInquilino = deTipo(
        await feedInquilino(c.tokenInquilino),
        TipoAlerta.INQUILINO_EN_MORA,
      );
      expect(delArrendador).toHaveLength(1);
      expect(delInquilino).toHaveLength(1);
      expect(delInquilino[0].id).not.toBe(delArrendador[0].id);
      expect(delArrendador[0].mensaje).toContain(c.unidad);
      expect(delInquilino[0].mensaje).toContain('Tu pago');
      expect(delInquilino[0].mensaje).toContain(c.unidad);
      // Ambos apuntan al período vencido más antiguo.
      for (const alerta of [delArrendador[0], delInquilino[0]]) {
        expect(alerta.recurso).toEqual({
          tipo: 'PERIODO',
          id: null,
          contrato_id: c.contratoId,
          periodo: '2031-01-01',
        });
      }

      // Cada una con su propio `leida`: el inquilino lee la suya y la del arrendador sigue sin leer.
      await request(app.getHttpServer())
        .patch(`/inquilino/alertas/${delInquilino[0].id}/leida`)
        .set('Authorization', `Bearer ${c.tokenInquilino}`)
        .expect(200);
      const f = await filas(TipoAlerta.INQUILINO_EN_MORA, c.contratoId);
      expect(f.find((x) => x.inquilino_id !== null)?.leida).toBe(true);
      expect(f.find((x) => x.arrendador_id !== null)?.leida).toBe(false);

      // Otra corrida el mismo día: nada nuevo, aunque una esté leída.
      const r2 = await scheduler.ejecutarInquilinoEnMora(AHORA);
      expect(r2.creadas).toBe(0);
      expect(
        await filas(TipoAlerta.INQUILINO_EN_MORA, c.contratoId),
      ).toHaveLength(2);
    });

    it('sin cuenta de inquilino vinculada solo avisa al arrendador', async () => {
      const c = await nuevoContrato({
        inicio: '2031-01-01',
        fin: '2031-12-31',
        vinculado: false,
      });
      const r = await scheduler.ejecutarInquilinoEnMora(AHORA);
      expect(r.creadas).toBe(1);
      const f = await filas(TipoAlerta.INQUILINO_EN_MORA, c.contratoId);
      expect(f).toHaveLength(1);
      expect(f[0].arrendador_id).toBe(arrendadorId);
      expect(f[0].inquilino_id).toBeNull();
    });

    it('un contrato al día no genera alertas', async () => {
      const c = await nuevoContrato({
        inicio: '2031-01-01',
        fin: '2031-12-31',
      });
      for (const mes of ['2031-01-01', '2031-02-01', '2031-03-01']) {
        await pagarMes(c.contratoId, mes);
      }
      const r = await scheduler.ejecutarInquilinoEnMora(AHORA);
      expect(r.enMora).toBe(0);
      expect(
        await filas(TipoAlerta.INQUILINO_EN_MORA, c.contratoId),
      ).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('contrato próximo a vencer: ambos roles', () => {
    it('avisa al arrendador y al inquilino (dos filas) y no duplica al correr de nuevo', async () => {
      const c = await nuevoContrato({
        inicio: '2030-04-01',
        fin: '2031-03-25', // vence en 10 días
      });
      const r1 = await scheduler.ejecutarVencimiento(AHORA);
      expect(r1.creadas).toBe(2);

      const delInquilino = deTipo(
        await feedInquilino(c.tokenInquilino),
        TipoAlerta.CONTRATO_PROXIMO_A_VENCER,
      );
      const delArrendador = deTipo(
        await feedArrendador(),
        TipoAlerta.CONTRATO_PROXIMO_A_VENCER,
      );
      expect(delInquilino).toHaveLength(1);
      expect(delArrendador).toHaveLength(1);
      expect(delInquilino[0].mensaje).toContain('Tu contrato');
      expect(delInquilino[0].mensaje).toContain(c.unidad);
      expect(delInquilino[0].recurso).toEqual({
        tipo: 'CONTRATO',
        id: c.contratoId,
        contrato_id: c.contratoId,
      });

      expect((await scheduler.ejecutarVencimiento(AHORA)).creadas).toBe(0);
      expect(
        await filas(TipoAlerta.CONTRATO_PROXIMO_A_VENCER, c.contratoId),
      ).toHaveLength(2);
    });

    it('sin cuenta vinculada solo avisa al arrendador', async () => {
      const c = await nuevoContrato({
        inicio: '2030-04-01',
        fin: '2031-03-25',
        vinculado: false,
      });
      const r = await scheduler.ejecutarVencimiento(AHORA);
      expect(r.creadas).toBe(1);
      const f = await filas(TipoAlerta.CONTRATO_PROXIMO_A_VENCER, c.contratoId);
      expect(f).toHaveLength(1);
      expect(f[0].arrendador_id).toBe(arrendadorId);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('B-78: un incremento vencido sí avisa', () => {
    it('avisa al arrendador aunque el próximo ajuste ya pasó, y no se repite cada día', async () => {
      // El primer ajuste era el 01/01/2031: hace 73 días.
      const c = await nuevoContrato({
        inicio: '2030-01-01',
        fin: '2031-12-31',
      });
      const evento = (hastaDia: Date) =>
        scheduler.ejecutarAjusteIpcPendiente(
          new Date(hastaDia.getTime() + 17 * 60 * 60 * 1000),
        );

      expect((await evento(hoy)).creadas).toBe(1);
      const f = await filas(TipoAlerta.AJUSTE_IPC_PENDIENTE, c.contratoId);
      expect(f).toHaveLength(1);
      expect(f[0].arrendador_id).toBe(arrendadorId);
      const delArrendador = deTipo(
        await feedArrendador(),
        TipoAlerta.AJUSTE_IPC_PENDIENTE,
      );
      expect(delArrendador).toHaveLength(1);
      expect(delArrendador[0].mensaje).toContain(c.unidad);
      expect(delArrendador[0].mensaje).toContain('2031');

      // Sin leer: no se repite ningún día. Leída: tampoco durante 7 días; al octavo vuelve a avisar.
      expect((await evento(hoy)).creadas).toBe(0);
      expect((await evento(sumarDiasUTC(hoy, 1))).creadas).toBe(0);
      await prisma.alerta.updateMany({ data: { leida: true } });
      for (const dias of [1, 2, 3, 6]) {
        expect((await evento(sumarDiasUTC(hoy, dias))).creadas).toBe(0);
      }
      expect((await evento(sumarDiasUTC(hoy, 8))).creadas).toBe(1);
      expect(
        await filas(TipoAlerta.AJUSTE_IPC_PENDIENTE, c.contratoId),
      ).toHaveLength(2);
    });

    it('un incremento que vence dentro de 30 días sigue avisando como antes', async () => {
      const c = await nuevoContrato({
        inicio: '2030-03-25', // el ajuste cae el 25/03/2031
        fin: '2031-12-31',
      });
      expect((await scheduler.ejecutarAjusteIpcPendiente(AHORA)).creadas).toBe(
        1,
      );
      const f = await filas(TipoAlerta.AJUSTE_IPC_PENDIENTE, c.contratoId);
      expect(f).toHaveLength(1);
    });

    it('un incremento que vence en más de 30 días no avisa todavía', async () => {
      await nuevoContrato({ inicio: '2030-06-01', fin: '2031-12-31' });
      expect((await scheduler.ejecutarAjusteIpcPendiente(AHORA)).creadas).toBe(
        0,
      );
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('B-77: estado de pago de los contratos cerrados', () => {
    it('recalcula `estado_pago` de un contrato VENCIDO o TERMINADO_ANTICIPADAMENTE reciente sin crear alertas de mora', async () => {
      // Cerrados hace poco, sin pagos: enero a marzo vencidos, pero el estado guardado quedó atrasado.
      const vencido = await nuevoContrato({
        inicio: '2031-01-01',
        fin: '2031-03-10',
        estado: EstadoContrato.VENCIDO,
        estadoPago: EstadoPagoContrato.AL_DIA,
      });
      const terminado = await nuevoContrato({
        inicio: '2031-01-01',
        fin: '2031-12-31',
        estado: EstadoContrato.TERMINADO_ANTICIPADAMENTE,
        estadoPago: EstadoPagoContrato.AL_DIA,
        extra: {
          terminacion_fecha_efectiva: dia('2031-03-05'),
          terminacionAnticipadaConfirmadaEn: dia('2031-02-20'),
        },
      });

      const r = await scheduler.ejecutarInquilinoEnMora(AHORA);

      for (const id of [vencido.contratoId, terminado.contratoId]) {
        const contrato = await prisma.contrato.findUniqueOrThrow({
          where: { id },
          select: { estado_pago: true },
        });
        expect(contrato.estado_pago).toBe(EstadoPagoContrato.EN_MORA);
        expect(await filas(TipoAlerta.INQUILINO_EN_MORA, id)).toHaveLength(0);
      }
      // La alerta de mora solo es para contratos ACTIVO: ninguno de los dos cuenta como alertado.
      expect(r.creadas).toBe(0);
      expect(await prisma.alerta.count()).toBe(0);
    });

    it('un contrato cerrado que se puso al día vuelve a AL_DIA', async () => {
      const c = await nuevoContrato({
        inicio: '2031-01-01',
        // Con día de pago 5 los períodos son enero (límite 5/01) y febrero (límite 5/02): termina ahí.
        fin: '2031-02-05',
        estado: EstadoContrato.VENCIDO,
        estadoPago: EstadoPagoContrato.EN_MORA,
      });
      await pagarMes(c.contratoId, '2031-01-01');
      await pagarMes(c.contratoId, '2031-02-01');
      await scheduler.ejecutarInquilinoEnMora(AHORA);
      const contrato = await prisma.contrato.findUniqueOrThrow({
        where: { id: c.contratoId },
        select: { estado_pago: true },
      });
      expect(contrato.estado_pago).toBe(EstadoPagoContrato.AL_DIA);
    });

    it('un contrato cerrado hace mucho y ya al día no se vuelve a recalcular (costo acotado)', async () => {
      const c = await nuevoContrato({
        inicio: '2029-01-01',
        fin: '2029-12-31',
        estado: EstadoContrato.VENCIDO,
        estadoPago: EstadoPagoContrato.AL_DIA,
      });
      // Si se recalculara saldría EN_MORA (no hay pagos): que siga AL_DIA prueba que se omitió.
      await scheduler.ejecutarInquilinoEnMora(AHORA);
      const contrato = await prisma.contrato.findUniqueOrThrow({
        where: { id: c.contratoId },
        select: { estado_pago: true },
      });
      expect(contrato.estado_pago).toBe(EstadoPagoContrato.AL_DIA);
    });
  });
});
