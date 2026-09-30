import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
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
  contratoValido,
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

interface ContratoConEstadoPago {
  estado_pago: string;
}

const CREADO: number = HttpStatus.CREATED;
const CONFLICTO: number = HttpStatus.CONFLICT;
const SOLICITUD_INVALIDA: number = HttpStatus.BAD_REQUEST;

function fechaISO(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

describe('Estado de pago tras incremento/prórroga (B-50) y plantilla acorde a la unidad (B-47) (e2e)', () => {
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

  async function nuevoArrendador() {
    contadorSufijo += 1;
    return registrarArrendador(
      app,
      `Arrendador ${contadorSufijo}`,
      `b50-${contadorSufijo}@correo.com`,
    );
  }

  /** Contrato con 13 meses de antigüedad y vencimiento en 60 días. */
  async function prepararContratoElegible() {
    const hoy = hoyEnBogota();
    const { access_token } = await nuevoArrendador();
    const inmueble = await crearInmueble(
      app,
      access_token,
      `B50-${contadorSufijo}`,
    );
    const inquilino = await crearInquilino(app, access_token);
    const contrato = await crearContrato(
      app,
      access_token,
      inmueble.unidades[0].id,
      inquilino.id,
      {
        fecha_inicio: fechaISO(sumarMesesUTC(hoy, -13)),
        fecha_fin: fechaISO(sumarDiasUTC(hoy, 60)),
        canon_centavos: 1_000_000,
      },
    );
    return { access_token, contrato };
  }

  const estadoDerivado = async (token: string, contratoId: string) => {
    const respuesta = await request(app.getHttpServer())
      .get(`/contratos/${contratoId}/estado-cuenta`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    // La API lo expone en minúsculas (en_mora); la base lo guarda en mayúsculas.
    return (respuesta.body as { estadoPago: string }).estadoPago.toUpperCase();
  };

  const estadoPersistido = async (contratoId: string) =>
    (
      await prisma.contrato.findUniqueOrThrow({
        where: { id: contratoId },
        select: { estado_pago: true },
      })
    ).estado_pago as string;

  async function configurarIpc() {
    await prisma.configuracionIpc.create({
      data: { anio: hoyEnBogota().getUTCFullYear() - 1, porcentaje: 5.1 },
    });
  }

  // ------------------------------------------------------------------
  // B-50
  // ------------------------------------------------------------------
  describe('B-50 estado_pago consistente', () => {
    it('tras aplicar-incremento, el estado_pago de la respuesta y de la base es el derivado, sin esperar al cron', async () => {
      await configurarIpc();
      const { access_token, contrato } = await prepararContratoElegible();
      // Estado guardado desactualizado: 13 meses sin pagos son mora, pero
      // el contrato nació con el valor por defecto.
      await prisma.contrato.update({
        where: { id: contrato.id },
        data: { estado_pago: 'AL_DIA' },
      });
      const derivado = await estadoDerivado(access_token, contrato.id);
      expect(derivado).toBe('EN_MORA');

      const respuesta = await request(app.getHttpServer())
        .post(`/contratos/${contrato.id}/aplicar-incremento`)
        .set('Authorization', `Bearer ${access_token}`)
        .expect(CREADO);
      const cuerpo = respuesta.body as { contrato: ContratoConEstadoPago };

      expect(cuerpo.contrato.estado_pago).toBe(derivado);
      expect(await estadoPersistido(contrato.id)).toBe(derivado);
      expect(await estadoDerivado(access_token, contrato.id)).toBe(derivado);
    }, 30000);

    it('tras prorrogar, el estado_pago persistido es el derivado inmediatamente', async () => {
      const { access_token, contrato } = await prepararContratoElegible();
      await prisma.contrato.update({
        where: { id: contrato.id },
        data: { estado_pago: 'AL_DIA' },
      });

      const respuesta = await request(app.getHttpServer())
        .post(`/contratos/${contrato.id}/prorrogar`)
        .set('Authorization', `Bearer ${access_token}`)
        .expect(CREADO);
      const cuerpo = respuesta.body as { contrato: ContratoConEstadoPago };
      const derivado = await estadoDerivado(access_token, contrato.id);

      expect(derivado).toBe('EN_MORA');
      expect(cuerpo.contrato.estado_pago).toBe(derivado);
      expect(await estadoPersistido(contrato.id)).toBe(derivado);
    }, 30000);

    it('dos incrementos concurrentes: un éxito, un 409 y estado_pago consistente', async () => {
      await configurarIpc();
      const { access_token, contrato } = await prepararContratoElegible();
      await prisma.contrato.update({
        where: { id: contrato.id },
        data: { estado_pago: 'AL_DIA' },
      });

      const respuestas = await Promise.all(
        [1, 2].map(() =>
          request(app.getHttpServer())
            .post(`/contratos/${contrato.id}/aplicar-incremento`)
            .set('Authorization', `Bearer ${access_token}`),
        ),
      );

      const estados = respuestas.map((r) => r.status).sort();
      expect(estados).toEqual([CREADO, CONFLICTO]);
      expect(await prisma.incrementoIPC.count()).toBe(1);
      expect(await estadoPersistido(contrato.id)).toBe(
        await estadoDerivado(access_token, contrato.id),
      );
    }, 30000);
  });

  // ------------------------------------------------------------------
  // B-47
  // ------------------------------------------------------------------
  describe('B-47 plantilla acorde a la unidad', () => {
    async function prepararUnidades() {
      const { access_token } = await nuevoArrendador();
      const inquilino = await crearInquilino(app, access_token);

      const residencial = await crearInmueble(
        app,
        access_token,
        `B47-R-${contadorSufijo}`,
      );
      const comercial = (
        await request(app.getHttpServer())
          .post('/inmuebles')
          .set('Authorization', `Bearer ${access_token}`)
          .send({
            direccion: 'Carrera 7 # 10-20',
            ciudad: 'Bogota',
            matricula_inmobiliaria: `B47-C-${contadorSufijo}`,
            uso_unidad_principal: 'COMERCIAL',
          })
          .expect(CREADO)
      ).body as { id: string; unidades: Array<{ id: string }> };
      const parqueadero = (
        await request(app.getHttpServer())
          .post(`/inmuebles/${comercial.id}/unidades`)
          .set('Authorization', `Bearer ${access_token}`)
          .send({
            nombre: 'Parqueadero 1',
            tipo: 'PARQUEADERO',
            canon_base_centavos: 0,
            acepta_mascotas: false,
            uso_permitido: 'COMERCIAL',
          })
          .expect(CREADO)
      ).body as { id: string };

      return {
        access_token,
        inquilino,
        vivienda: residencial.unidades[0].id,
        local: comercial.unidades[0].id,
        parqueadero: parqueadero.id,
      };
    }

    const postContrato = (token: string, cuerpo: Record<string, unknown>) =>
      request(app.getHttpServer())
        .post('/contratos')
        .set('Authorization', `Bearer ${token}`)
        .send(cuerpo);

    it('rechaza plantillas que no corresponden y no escribe nada', async () => {
      const { access_token, inquilino, vivienda, local, parqueadero } =
        await prepararUnidades();
      const subir = jest.spyOn(almacenamiento, 'subirArchivo');

      const casos: Array<[string, string, string]> = [
        [parqueadero, 'VIVIENDA_URBANA_LEY_820', 'PARQUEADERO'],
        [vivienda, 'LOCAL_COMERCIAL', 'VIVIENDA_URBANA_LEY_820'],
        [local, 'PARQUEADERO', 'LOCAL_COMERCIAL'],
        [local, 'VIVIENDA_URBANA_LEY_820', 'LOCAL_COMERCIAL'],
        [parqueadero, 'LOCAL_COMERCIAL', 'PARQUEADERO'],
      ];
      for (const [unidadId, plantilla, correcta] of casos) {
        const respuesta = await postContrato(
          access_token,
          contratoValido(unidadId, inquilino.id, { tipo_plantilla: plantilla }),
        ).expect(SOLICITUD_INVALIDA);
        const cuerpo = respuesta.body as CuerpoError;
        expect(cuerpo.codigo).toBe('PLANTILLA_NO_CORRESPONDE_A_UNIDAD');
        expect(cuerpo.mensaje).toContain(correcta);
      }

      expect(await prisma.contrato.count()).toBe(0);
      expect(await prisma.codigoAcceso.count()).toBe(0);
      expect(await prisma.documentoContrato.count()).toBe(0);
      expect(subir).not.toHaveBeenCalled();
    }, 60000);

    it('las combinaciones válidas se crean', async () => {
      const { access_token, inquilino, vivienda, local, parqueadero } =
        await prepararUnidades();
      const validos: Array<[string, string]> = [
        [vivienda, 'VIVIENDA_URBANA_LEY_820'],
        [local, 'LOCAL_COMERCIAL'],
        [parqueadero, 'PARQUEADERO'],
      ];
      for (const [unidadId, plantilla] of validos) {
        await postContrato(
          access_token,
          contratoValido(unidadId, inquilino.id, { tipo_plantilla: plantilla }),
        ).expect(CREADO);
      }
      expect(await prisma.contrato.count()).toBe(3);
    }, 60000);
  });
});
