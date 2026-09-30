import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { sumarDiasUTC } from '../src/common/fechas-contrato.util';
import { hoyEnBogota } from '../src/common/hoy-bogota.util';
import { configurarApp } from '../src/configurar-app';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  autenticarInquilino,
  contratoValido,
  crearContrato,
  crearInmueble,
  crearInquilino,
  registrarArrendador,
  vincularContrato,
} from './helpers/crear-datos.helper';
import { limpiarBd } from './helpers/limpiar-bd';

interface CuerpoError {
  statusCode: number;
  codigo: string;
  mensaje: string;
}

interface ResumenVinculo {
  id: string;
  estado: string;
  fecha_inicio: string;
  fecha_fin: string;
  vinculado_en: string;
  datos_recaudo: string | null;
  unidad: { id: string; nombre: string };
  inmueble: { id: string; direccion: string };
  [clave: string]: unknown;
}

const CREADO: number = HttpStatus.CREATED;
const OK: number = HttpStatus.OK;
const CONFLICTO: number = HttpStatus.CONFLICT;
const NO_ENCONTRADO: number = HttpStatus.NOT_FOUND;

const iso = (fecha: Date): string => fecha.toISOString().slice(0, 10);

describe('Vinculación del contrato por el inquilino (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let contador = 0;
  const hoy = hoyEnBogota();

  beforeEach(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await limpiarBd(prisma);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configurarApp(app);
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

  async function arrendador() {
    contador += 1;
    const { access_token, arrendador } = await registrarArrendador(
      app,
      `Arrendador ${contador}`,
      `vinc-${contador}@correo.com`,
    );
    return { token: access_token, id: arrendador.id };
  }

  async function unidad(token: string) {
    contador += 1;
    return (await crearInmueble(app, token, `VINC-${contador}`)).unidades[0].id;
  }

  const postContrato = (token: string, cuerpo: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/contratos')
      .set('Authorization', `Bearer ${token}`)
      .send(cuerpo);

  /** Persona con cuenta y un contrato vinculado (se vincula al registrarse). */
  async function personaConCuenta() {
    const arr = await arrendador();
    const unidadId = await unidad(arr.token);
    const ficha = await crearInquilino(app, arr.token);
    const contrato = await crearContrato(app, arr.token, unidadId, ficha.id);
    contador += 1;
    const inq = await autenticarInquilino(
      app,
      contrato.codigo_acceso?.codigo ?? '',
      `vinc-inq-${contador}@correo.com`,
    );
    return { arr, unidadId, ficha, contrato, inq };
  }

  const vincular = (token: string, codigo: string) =>
    vincularContrato(app, token, codigo);

  const validar = (codigo: string) =>
    request(app.getHttpServer())
      .post('/auth/inquilino/validar-codigo')
      .send({ codigo });

  const get = (token: string, ruta: string) =>
    request(app.getHttpServer())
      .get(ruta)
      .set('Authorization', `Bearer ${token}`);

  const codigoError = (r: { body: unknown }) => (r.body as CuerpoError).codigo;

  // ------------------------------------------------------------------
  // El portal exige vinculación
  // ------------------------------------------------------------------
  it('un contrato sin vincular no aparece en ninguna ruta del portal (404) y al vincularlo aparece', async () => {
    const { contrato, inq, unidadId } = await personaConCuenta();
    // Una solicitud creada mientras el contrato estaba vinculado.
    await request(app.getHttpServer())
      .post('/solicitudes-mantenimiento')
      .set('Authorization', `Bearer ${inq}`)
      .field('unidadId', unidadId)
      .field('descripcion', 'Fuga')
      .field('urgencia', 'ALTO')
      .expect(CREADO);
    await prisma.contrato.update({
      where: { id: contrato.id },
      data: { vinculado_en: null },
    });

    const rutasGet = [
      '/inquilino/mi-panel',
      '/inquilino/mi-contrato',
      '/inquilino/mi-contrato/estado-cuenta',
    ];
    for (const ruta of rutasGet) {
      expect([ruta, (await get(inq, ruta)).status]).toEqual([
        ruta,
        NO_ENCONTRADO,
      ]);
    }
    const terminacion = await request(app.getHttpServer())
      .post('/inquilino/mi-contrato/solicitar-terminacion-anticipada')
      .set('Authorization', `Bearer ${inq}`)
      .send({ motivo: 'x', fecha_efectiva: iso(sumarDiasUTC(hoy, 5)) });
    expect(terminacion.status).toBe(NO_ENCONTRADO);
    const aviso = await request(app.getHttpServer())
      .post('/inquilino/mi-contrato/aviso-no-renovacion')
      .set('Authorization', `Bearer ${inq}`)
      .send({});
    expect(aviso.status).toBe(NO_ENCONTRADO);

    const pago = await request(app.getHttpServer())
      .post('/pagos')
      .set('Authorization', `Bearer ${inq}`)
      .field('contratoId', contrato.id)
      .field('monto_centavos', '1000000')
      .field('fecha_reportada', iso(hoy))
      .attach('comprobante', Buffer.from('comprobante'), {
        filename: 'c.png',
        contentType: 'image/png',
      });
    expect(pago.status).toBe(NO_ENCONTRADO);
    const mantenimiento = await request(app.getHttpServer())
      .post('/solicitudes-mantenimiento')
      .set('Authorization', `Bearer ${inq}`)
      .field('unidadId', unidadId)
      .field('descripcion', 'Otra fuga')
      .field('urgencia', 'ALTO');
    expect(mantenimiento.status).toBe(NO_ENCONTRADO);
    expect((await get(inq, '/pagos/mios').expect(OK)).body).toEqual([]);
    expect(
      (await get(inq, '/solicitudes-mantenimiento/mias').expect(OK)).body,
    ).toEqual([]);
    expect(await prisma.pago.count()).toBe(0);
    expect(await prisma.solicitudMantenimiento.count()).toBe(1);

    // Vincularlo lo hace aparecer.
    await vincular(inq, contrato.codigo_acceso?.codigo ?? '').expect(OK);
    for (const ruta of rutasGet) {
      expect([ruta, (await get(inq, ruta)).status]).toEqual([ruta, OK]);
    }
    expect(
      (await get(inq, '/solicitudes-mantenimiento/mias').expect(OK)).body,
    ).toHaveLength(1);
  }, 120000);

  it('una persona con cuenta vincula un segundo contrato con vincular y el portal lo muestra', async () => {
    const { arr, ficha, contrato, inq } = await personaConCuenta();
    await prisma.contrato.update({
      where: { id: contrato.id },
      data: { estado: 'VENCIDO' },
    });
    const segundo = await crearContrato(
      app,
      arr.token,
      await unidad(arr.token),
      ficha.id,
    );
    const antes = await get(inq, '/inquilino/mi-contrato').expect(OK);
    expect((antes.body as { contratoId: string }).contratoId).toBe(contrato.id);

    const respuesta = await vincular(
      inq,
      segundo.codigo_acceso?.codigo ?? '',
    ).expect(OK);
    expect((respuesta.body as ResumenVinculo).id).toBe(segundo.id);

    const despues = await get(inq, '/inquilino/mi-contrato').expect(OK);
    expect((despues.body as { contratoId: string }).contratoId).toBe(
      segundo.id,
    );
  }, 120000);

  // ------------------------------------------------------------------
  // validar-codigo
  // ------------------------------------------------------------------
  it('validar-codigo: sin cuenta devuelve lo que escribió el arrendador (nunca el nombre global); con cuenta, requiere_inicio_sesion sin nombre', async () => {
    const arr = await arrendador();
    const nueva = await postContrato(arr.token, {
      ...contratoValido(await unidad(arr.token), 'x'),
      inquilino_id: undefined,
      inquilino_nuevo: {
        nombre: 'Nombre Del Contrato',
        cedula: `8${Date.now().toString().slice(-8)}`,
        telefono: '3001',
      },
    }).expect(CREADO);
    const cuerpo = nueva.body as {
      codigo_acceso: { codigo: string };
      inquilino: { id: string };
    };
    await prisma.inquilino.update({
      where: { id: cuerpo.inquilino.id },
      data: { nombre: 'Nombre Global Secreto' },
    });

    const sinCuenta = await validar(cuerpo.codigo_acceso.codigo).expect(OK);
    const texto = JSON.stringify(sinCuenta.body);
    expect(sinCuenta.body).toMatchObject({
      nombreInquilino: 'Nombre Del Contrato',
      requiere_inicio_sesion: false,
    });
    expect(texto).not.toContain('Nombre Global Secreto');
    expect(texto).not.toContain(cuerpo.inquilino.id);
    expect(sinCuenta.body).toHaveProperty('nombreUnidad');
    expect(sinCuenta.body).toHaveProperty('direccionInmueble');

    const { arr: arr2, ficha, inq } = await personaConCuenta();
    const otro = await crearContrato(
      app,
      arr2.token,
      await unidad(arr2.token),
      ficha.id,
    );
    expect(inq).toBeTruthy();
    const conCuenta = await validar(otro.codigo_acceso?.codigo ?? '').expect(
      OK,
    );
    expect(conCuenta.body).toMatchObject({ requiere_inicio_sesion: true });
    expect(conCuenta.body).not.toHaveProperty('nombreInquilino');
    expect(conCuenta.body).not.toHaveProperty('nombreUnidad');
    expect(conCuenta.body).not.toHaveProperty('inquilinoId');
  }, 120000);

  it('un código de otra persona, uno inexistente y uno de contrato CANCELADO dan la misma respuesta', async () => {
    const { arr, ficha, inq } = await personaConCuenta();
    const otraPersona = await personaConCuenta();
    // Contrato PROGRAMADO de la misma persona y luego cancelado.
    const programado = await postContrato(arr.token, {
      ...contratoValido(await unidad(arr.token), ficha.id, {
        fecha_inicio: iso(sumarDiasUTC(hoy, 10)),
        fecha_fin: iso(sumarDiasUTC(hoy, 375)),
      }),
    }).expect(CREADO);
    const cancelado = programado.body as {
      id: string;
      codigo_acceso: { codigo: string };
    };
    await request(app.getHttpServer())
      .post(`/contratos/${cancelado.id}/cancelar-programado`)
      .set('Authorization', `Bearer ${arr.token}`)
      .expect(CREADO);

    const ajeno = await vincular(
      inq,
      otraPersona.contrato.codigo_acceso?.codigo ?? '',
    );
    const inexistente = await vincular(inq, 'RC-0000-ZZZZ');
    const deCancelado = await vincular(inq, cancelado.codigo_acceso.codigo);

    expect(ajeno.status).toBe(NO_ENCONTRADO);
    expect([inexistente.status, inexistente.body]).toEqual([
      ajeno.status,
      ajeno.body,
    ]);
    expect([deCancelado.status, deCancelado.body]).toEqual([
      ajeno.status,
      ajeno.body,
    ]);

    // validar-codigo: inexistente, cancelado y ya usado (vinculado) también coinciden.
    const vInexistente = await validar('RC-0000-ZZZZ');
    const vCancelado = await validar(cancelado.codigo_acceso.codigo);
    const vUsado = await validar(
      otraPersona.contrato.codigo_acceso?.codigo ?? '',
    );
    expect(vInexistente.status).toBe(NO_ENCONTRADO);
    expect([vCancelado.status, vCancelado.body]).toEqual([
      vInexistente.status,
      vInexistente.body,
    ]);
    expect([vUsado.status, vUsado.body]).toEqual([
      vInexistente.status,
      vInexistente.body,
    ]);
  }, 120000);

  // ------------------------------------------------------------------
  // vincular: concurrencia, idempotencia, recaudo, alerta
  // ------------------------------------------------------------------
  it('dos vincular simultáneos: una sola vinculación y una sola alerta', async () => {
    const { arr, ficha, inq } = await personaConCuenta();
    const segundo = await crearContrato(
      app,
      arr.token,
      await unidad(arr.token),
      ficha.id,
    );
    const codigo = segundo.codigo_acceso?.codigo ?? '';

    const respuestas = await Promise.all([
      vincular(inq, codigo),
      vincular(inq, codigo),
    ]);

    expect(respuestas.map((r) => r.status)).toEqual([OK, OK]);
    const enBd = await prisma.contrato.findUniqueOrThrow({
      where: { id: segundo.id },
    });
    expect(enBd.vinculado_en).not.toBeNull();
    expect(
      await prisma.alerta.count({
        where: {
          contrato_id: segundo.id,
          tipo: 'CONTRATO_VINCULADO_POR_INQUILINO',
        },
      }),
    ).toBe(1);
  }, 120000);

  it('vincular repetido por la misma cuenta es idempotente y no crea otra alerta', async () => {
    const { arr, ficha, inq } = await personaConCuenta();
    const segundo = await crearContrato(
      app,
      arr.token,
      await unidad(arr.token),
      ficha.id,
    );
    const codigo = segundo.codigo_acceso?.codigo ?? '';

    const primera = await vincular(inq, codigo).expect(OK);
    const repetida = await vincular(inq, codigo).expect(OK);

    expect((repetida.body as ResumenVinculo).id).toBe(segundo.id);
    expect((repetida.body as ResumenVinculo).vinculado_en).toBe(
      (primera.body as ResumenVinculo).vinculado_en,
    );
    expect(
      await prisma.alerta.count({
        where: { tipo: 'CONTRATO_VINCULADO_POR_INQUILINO' },
      }),
    ).toBe(2); // el contrato del registro y este
    const alerta = await prisma.alerta.findFirstOrThrow({
      where: { contrato_id: segundo.id },
    });
    expect(alerta.arrendador_id).toBe(arr.id);
  }, 120000);

  it('un contrato PROGRAMADO se vincula sin datos de recaudo; uno ACTIVO los muestra; el resumen no filtra rutas ni el perfil global', async () => {
    const { arr, ficha, inq } = await personaConCuenta();
    const programado = await postContrato(
      arr.token,
      contratoValido(await unidad(arr.token), ficha.id, {
        fecha_inicio: iso(sumarDiasUTC(hoy, 10)),
        fecha_fin: iso(sumarDiasUTC(hoy, 375)),
      }),
    ).expect(CREADO);
    const activo = await crearContrato(
      app,
      arr.token,
      await unidad(arr.token),
      ficha.id,
    );

    const vProgramado = await vincular(
      inq,
      (programado.body as { codigo_acceso: { codigo: string } }).codigo_acceso
        .codigo,
    ).expect(OK);
    const vActivo = await vincular(
      inq,
      activo.codigo_acceso?.codigo ?? '',
    ).expect(OK);

    const resumenProgramado = vProgramado.body as ResumenVinculo;
    expect(resumenProgramado).toMatchObject({
      estado: 'PROGRAMADO',
      datos_recaudo: null,
    });
    expect(resumenProgramado.unidad.id).toBeTruthy();
    expect(resumenProgramado.inmueble.direccion).toBeTruthy();
    expect((vActivo.body as ResumenVinculo).estado).toBe('ACTIVO');
    expect((vActivo.body as ResumenVinculo).datos_recaudo).toBe(
      'Bancolombia ahorros 123456789',
    );
    for (const cuerpo of [vProgramado.body, vActivo.body]) {
      expect(cuerpo).not.toHaveProperty('pdf_contrato_ruta');
      expect(cuerpo).not.toHaveProperty('codigo_acceso');
      expect(cuerpo).not.toHaveProperty('inquilino_id');
    }
  }, 120000);

  // ------------------------------------------------------------------
  // completar-registro
  // ------------------------------------------------------------------
  it('completar-registro crea la cuenta y vincula ese contrato; el código no se puede usar dos veces; con cuenta existente responde 409 propio', async () => {
    const arr = await arrendador();
    const nueva = (
      await postContrato(arr.token, {
        ...contratoValido(await unidad(arr.token), 'x'),
        inquilino_id: undefined,
        inquilino_nuevo: {
          nombre: 'Registro',
          cedula: `7${Date.now().toString().slice(-8)}`,
          telefono: '3002',
        },
      }).expect(CREADO)
    ).body as { id: string; codigo_acceso: { codigo: string } };
    const registro = (correo: string) =>
      request(app.getHttpServer())
        .post('/auth/inquilino/completar-registro')
        .send({
          codigo: nueva.codigo_acceso.codigo,
          correo,
          contrasena: 'clave1234',
        });

    const ok = await registro('registro-a2@correo.com').expect(OK);
    expect(ok.body).toHaveProperty('access_token');
    const contrato = await prisma.contrato.findUniqueOrThrow({
      where: { id: nueva.id },
    });
    expect(contrato.vinculado_en).not.toBeNull();
    expect(
      await prisma.alerta.count({
        where: {
          contrato_id: nueva.id,
          tipo: 'CONTRATO_VINCULADO_POR_INQUILINO',
        },
      }),
    ).toBe(1);

    const repetido = await registro('otro-correo@correo.com');
    expect(repetido.status).toBe(NO_ENCONTRADO);

    // Persona con cuenta: el código de su segundo contrato no crea cuenta.
    const { arr: arr2, ficha } = await personaConCuenta();
    const segundo = await crearContrato(
      app,
      arr2.token,
      await unidad(arr2.token),
      ficha.id,
    );
    const conCuenta = await request(app.getHttpServer())
      .post('/auth/inquilino/completar-registro')
      .send({
        codigo: segundo.codigo_acceso?.codigo,
        correo: 'nuevo-correo@correo.com',
        contrasena: 'clave1234',
      });
    expect(conCuenta.status).toBe(CONFLICTO);
    expect(codigoError(conCuenta)).toBe('REQUIERE_INICIO_SESION');
    expect((conCuenta.body as CuerpoError).mensaje).not.toMatch(
      /correo|activad/i,
    );
  }, 120000);

  // ------------------------------------------------------------------
  // Lado del arrendador
  // ------------------------------------------------------------------
  it('el arrendador ve vinculado/vinculado_en en contratos y, en GET /inquilinos, correo solo si el contrato está vinculado', async () => {
    const { arr, contrato } = await personaConCuenta();
    const sinVincular = await postContrato(arr.token, {
      ...contratoValido(await unidad(arr.token), 'x'),
      inquilino_id: undefined,
      inquilino_nuevo: {
        nombre: 'Sin Vincular',
        cedula: `6${Date.now().toString().slice(-8)}`,
        telefono: '3003',
      },
    }).expect(CREADO);
    const idSinVincular = (
      sinVincular.body as { id: string; inquilino: { id: string } }
    ).inquilino.id;
    // La persona tiene correo global aunque ese contrato no está vinculado.
    await prisma.inquilino.update({
      where: { id: idSinVincular },
      data: { correo: 'oculto@correo.com' },
    });

    const detalle = await get(arr.token, `/contratos/${contrato.id}`).expect(
      OK,
    );
    expect(detalle.body).toMatchObject({ vinculado: true });
    expect(
      (detalle.body as { vinculado_en: string }).vinculado_en,
    ).toBeTruthy();
    const detalle2 = await get(
      arr.token,
      `/contratos/${(sinVincular.body as { id: string }).id}`,
    ).expect(OK);
    expect(detalle2.body).toMatchObject({
      vinculado: false,
      vinculado_en: null,
    });

    const listado = (await get(arr.token, '/contratos').expect(OK))
      .body as Array<{
      id: string;
      vinculado: boolean;
    }>;
    expect(listado.find((c) => c.id === contrato.id)?.vinculado).toBe(true);

    const personas = (await get(arr.token, '/inquilinos').expect(OK))
      .body as Array<{
      id: string;
      correo: string | null;
      vinculado: boolean;
    }>;
    const vinculada = personas.find((p) => p.id === contrato.inquilino.id);
    const noVinculada = personas.find((p) => p.id === idSinVincular);
    expect(vinculada).toMatchObject({ vinculado: true });
    expect(vinculada?.correo).toMatch(/@correo\.com$/);
    expect(noVinculada).toMatchObject({ vinculado: false, correo: null });
    for (const persona of personas) {
      expect(persona).not.toHaveProperty('contrasena_hash');
    }
  }, 120000);
});
