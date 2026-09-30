import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { createHash } from 'crypto';
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
import { DocumentoContratoService } from '../src/contrato/documento-contrato.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  autenticarInquilino,
  crearInmueble,
  registrarArrendador,
  vincularContrato,
} from './helpers/crear-datos.helper';
import { limpiarBd } from './helpers/limpiar-bd';

const OK: number = HttpStatus.OK;
const CREADO: number = HttpStatus.CREATED;
const BAD_REQUEST: number = HttpStatus.BAD_REQUEST;
const NO_ENCONTRADO: number = HttpStatus.NOT_FOUND;
const CONFLICTO: number = HttpStatus.CONFLICT;
const URL_FIRMADA = /^https:\/\/.*\.supabase\.co\/storage\/v1\/object\/sign\//;

interface CuerpoError {
  codigo?: string;
  mensaje?: string;
}

interface DocumentoRespuesta {
  id: string;
  tipo: string;
  version: number;
  hash_sha256: string | null;
  url_firmada: string | null;
  ruta?: string;
}

interface RespuestaCorreccion {
  id: string;
  canon_centavos: number;
  dia_pago: number;
  forma_pago: string;
  datos_recaudo: string;
  deposito_centavos: number | null;
  datos_fiador_o_poliza: string | null;
  condicionesParticularesTexto: string | null;
  fecha_inicio: string;
  fecha_fin: string;
  estado: string;
  vinculado: boolean;
  pdf_contrato_url: string | null;
  inquilino: { id: string; nombre: string; cedula: string; telefono: string };
  codigo_acceso?: { codigo: string; expira_en: string };
  documento: DocumentoRespuesta | null;
  [clave: string]: unknown;
}

const iso = (fecha: Date): string => fecha.toISOString().slice(0, 10);

/** Nombres de las entradas de un ZIP, leídos del directorio central. */
function nombresDelZip(zip: Buffer): string[] {
  let eocd = zip.length - 22;
  while (eocd >= 0 && zip.readUInt32LE(eocd) !== 0x06054b50) {
    eocd -= 1;
  }
  const total = zip.readUInt16LE(eocd + 10);
  let posicion = zip.readUInt32LE(eocd + 16);
  const nombres: string[] = [];
  for (let i = 0; i < total; i += 1) {
    const largoNombre = zip.readUInt16LE(posicion + 28);
    const largoExtra = zip.readUInt16LE(posicion + 30);
    const largoComentario = zip.readUInt16LE(posicion + 32);
    nombres.push(
      zip.toString('utf8', posicion + 46, posicion + 46 + largoNombre),
    );
    posicion += 46 + largoNombre + largoExtra + largoComentario;
  }
  return nombres;
}

describe('Corrección de contratos sin vincular (B-35, e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let almacenamiento: AlmacenamientoService;
  let documentos: DocumentoContratoService;
  let contador = 0;
  const hoy = hoyEnBogota();

  beforeEach(async () => {
    // El límite de intentos por IP no es lo que se prueba aquí.
    jest.spyOn(ThrottlerGuard.prototype, 'canActivate').mockResolvedValue(true);
    prisma = new PrismaService();
    await prisma.$connect();
    await limpiarBd(prisma);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configurarApp(app);
    almacenamiento = moduleFixture.get(AlmacenamientoService);
    documentos = moduleFixture.get(DocumentoContratoService);
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

  // ------------------------------------------------------------------
  // Utilidades
  // ------------------------------------------------------------------
  const get = (token: string, ruta: string) =>
    request(app.getHttpServer())
      .get(ruta)
      .set('Authorization', `Bearer ${token}`);

  const patch = (token: string, ruta: string, cuerpo: object) =>
    request(app.getHttpServer())
      .patch(ruta)
      .set('Authorization', `Bearer ${token}`)
      .send(cuerpo);

  const post = (token: string, ruta: string, cuerpo: object = {}) =>
    request(app.getHttpServer())
      .post(ruta)
      .set('Authorization', `Bearer ${token}`)
      .send(cuerpo);

  const corregir = (token: string, id: string, cuerpo: object) =>
    patch(token, `/contratos/${id}`, cuerpo);

  const corregirInquilino = (token: string, id: string, cuerpo: object) =>
    patch(token, `/contratos/${id}/inquilino`, cuerpo);

  const codigoDe = (r: { body: unknown }) => (r.body as CuerpoError).codigo;

  const validar = (codigo: string) =>
    request(app.getHttpServer())
      .post('/auth/inquilino/validar-codigo')
      .send({ codigo });

  async function nuevoArrendador() {
    contador += 1;
    return registrarArrendador(
      app,
      `Arrendador ${contador}`,
      `correccion-${contador}@correo.com`,
    );
  }

  interface Base {
    token: string;
    inmuebleId: string;
    unidadId: string;
  }

  async function nuevaUnidad(
    token: string,
    uso: 'RESIDENCIAL' | 'COMERCIAL' = 'RESIDENCIAL',
  ): Promise<{ inmuebleId: string; unidadId: string }> {
    contador += 1;
    if (uso === 'RESIDENCIAL') {
      const inmueble = await crearInmueble(app, token, `CORR-${contador}`);
      return { inmuebleId: inmueble.id, unidadId: inmueble.unidades[0].id };
    }
    const r = await post(token, '/inmuebles', {
      direccion: 'Calle 1 # 2-3',
      ciudad: 'Bogota',
      matricula_inmobiliaria: `CORR-${contador}`,
      uso_unidad_principal: 'COMERCIAL',
    }).expect(CREADO);
    const cuerpo = r.body as { id: string; unidades: Array<{ id: string }> };
    return { inmuebleId: cuerpo.id, unidadId: cuerpo.unidades[0].id };
  }

  let cedulaSecuencia = 700000;
  const cedulaNueva = () => {
    cedulaSecuencia += 1;
    return `CC${cedulaSecuencia}`;
  };

  interface ContratoCreado {
    id: string;
    codigo: string;
    cedula: string;
    inquilinoId: string;
  }

  async function crearContratoNuevo(
    token: string,
    unidadId: string,
    plantilla:
      'VIVIENDA_URBANA_LEY_820' | 'LOCAL_COMERCIAL' = 'VIVIENDA_URBANA_LEY_820',
    extra: Record<string, unknown> = {},
    persona: { nombre?: string; cedula?: string; telefono?: string } = {},
  ): Promise<ContratoCreado> {
    const cedula = persona.cedula ?? cedulaNueva();
    const r = await post(token, '/contratos', {
      unidad_id: unidadId,
      inquilino_nuevo: {
        nombre: persona.nombre ?? 'Persona Escrita',
        cedula,
        telefono: persona.telefono ?? '3001112233',
      },
      tipo_plantilla: plantilla,
      canon_centavos: 1000000,
      dia_pago: 5,
      forma_pago: 'Transferencia bancaria',
      datos_recaudo: 'Bancolombia ahorros 123456789',
      fecha_inicio: iso(sumarDiasUTC(hoy, -10)),
      fecha_fin: iso(sumarDiasUTC(hoy, 355)),
      ...extra,
    }).expect(CREADO);
    const cuerpo = r.body as {
      id: string;
      codigo_acceso: { codigo: string };
      inquilino: { id: string };
    };
    return {
      id: cuerpo.id,
      codigo: cuerpo.codigo_acceso.codigo,
      cedula,
      inquilinoId: cuerpo.inquilino.id,
    };
  }

  const filaContrato = (id: string) =>
    prisma.contrato.findUniqueOrThrow({ where: { id } });
  const documentosEnBd = (id: string) =>
    prisma.documentoContrato.findMany({
      where: { contrato_id: id },
      orderBy: { version: 'asc' },
    });

  async function escenario(
    plantilla:
      'VIVIENDA_URBANA_LEY_820' | 'LOCAL_COMERCIAL' = 'VIVIENDA_URBANA_LEY_820',
    extra: Record<string, unknown> = {},
  ) {
    const { access_token } = await nuevoArrendador();
    const { inmuebleId, unidadId } = await nuevaUnidad(
      access_token,
      plantilla === 'LOCAL_COMERCIAL' ? 'COMERCIAL' : 'RESIDENCIAL',
    );
    const contrato = await crearContratoNuevo(
      access_token,
      unidadId,
      plantilla,
      extra,
    );
    const base: Base = { token: access_token, inmuebleId, unidadId };
    return { ...base, contrato };
  }

  // ------------------------------------------------------------------
  // Corregir términos
  // ------------------------------------------------------------------
  it('corrige canon, día de pago y garantías: contrato actualizado, PDF v2 y v1 intacto', async () => {
    const { token, contrato } = await escenario();
    const v1 = (await documentosEnBd(contrato.id))[0];
    const contenidoV1 = await almacenamiento.descargarArchivo(v1.ruta);
    const generarPdf = jest.spyOn(documentos, 'generarPdf');

    const r = await corregir(token, contrato.id, {
      canon_centavos: 1200000,
      dia_pago: 10,
      datos_fiador_o_poliza: 'Fiador Juan Pérez',
    }).expect(OK);
    const cuerpo = r.body as RespuestaCorreccion;

    expect(cuerpo).toMatchObject({
      id: contrato.id,
      canon_centavos: 1200000,
      dia_pago: 10,
      datos_fiador_o_poliza: 'Fiador Juan Pérez',
      vinculado: false,
    });
    expect(cuerpo.documento).toMatchObject({
      tipo: 'CONTRATO_ORIGINAL',
      version: 2,
    });
    expect(cuerpo.documento?.url_firmada).toMatch(URL_FIRMADA);
    expect(cuerpo.documento?.hash_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(cuerpo)).not.toContain('pdf_contrato_ruta');
    expect(cuerpo.documento).not.toHaveProperty('ruta');
    expect(cuerpo.pdf_contrato_url).toMatch(URL_FIRMADA);
    // Misma forma que GET /contratos/:id (más `documento`; sin código si no se regeneró).
    const lectura = (await get(token, `/contratos/${contrato.id}`).expect(OK))
      .body as Record<string, unknown>;
    const { documento: _documento, ...sinDocumento } = cuerpo;
    void _documento;
    const { codigo_acceso: _codigo, ...lecturaSinCodigo } = lectura;
    void _codigo;
    expect(Object.keys(sinDocumento).sort()).toEqual(
      Object.keys(lecturaSinCodigo).sort(),
    );

    const filas = await documentosEnBd(contrato.id);
    expect(filas.map((f) => [f.version, f.tipo])).toEqual([
      [1, 'CONTRATO_ORIGINAL'],
      [2, 'CONTRATO_ORIGINAL'],
    ]);
    expect(filas[0].ruta).toBe(v1.ruta);
    expect(filas[0].hash_sha256).toBe(v1.hash_sha256);
    expect(filas[1].ruta).toBe(
      `contratos/${contrato.id}/v2-CONTRATO_ORIGINAL.pdf`,
    );
    expect(
      createHash('sha256')
        .update(await almacenamiento.descargarArchivo(filas[1].ruta))
        .digest('hex'),
    ).toBe(filas[1].hash_sha256);
    // v1 sigue idéntico en el bucket.
    expect(
      (await almacenamiento.descargarArchivo(v1.ruta)).equals(contenidoV1),
    ).toBe(true);
    // El PDF nuevo lleva los términos corregidos.
    const texto = generarPdf.mock.calls[0][0];
    expect(texto).toContain('$12.000');
    expect(texto).toContain('Fiador Juan Pérez');
    expect(texto).toContain('día 10');
    // El puntero heredado apunta al original vigente.
    expect((await filaContrato(contrato.id)).pdf_contrato_ruta).toBe(
      filas[1].ruta,
    );

    const listado = (
      await get(token, `/contratos/${contrato.id}/documentos`).expect(OK)
    ).body as DocumentoRespuesta[];
    expect(listado.map((d) => [d.version, d.tipo])).toEqual([
      [1, 'CONTRATO_ORIGINAL'],
      [2, 'CONTRATO_ORIGINAL'],
    ]);
  }, 120000);

  it('un PATCH sin cambios reales responde 200 sin crear versión ni subir nada', async () => {
    const { token, contrato } = await escenario();
    const subir = jest.spyOn(almacenamiento, 'subirArchivo');
    const antes = await filaContrato(contrato.id);

    const r = await corregir(token, contrato.id, {
      canon_centavos: 1000000,
      dia_pago: 5,
      forma_pago: 'Transferencia bancaria',
    }).expect(OK);

    expect((r.body as RespuestaCorreccion).documento).toBeNull();
    expect(subir).not.toHaveBeenCalled();
    expect(await documentosEnBd(contrato.id)).toHaveLength(1);
    expect(await filaContrato(contrato.id)).toEqual(antes);
  }, 60000);

  it('cuerpo vacío, solo campos desconocidos o campos no editables = 400 y nada cambia', async () => {
    const { token, contrato } = await escenario();
    const antes = await filaContrato(contrato.id);

    await corregir(token, contrato.id, {}).expect(BAD_REQUEST);
    await corregir(token, contrato.id, { inventado: 1 }).expect(BAD_REQUEST);
    for (const campo of [
      { unidad_id: '00000000-0000-4000-8000-000000000000' },
      { inquilino_id: '00000000-0000-4000-8000-000000000000' },
      { tipo_plantilla: 'LOCAL_COMERCIAL' },
      { estado: 'CANCELADO' },
      { codigo: 'RC-AAAA-BBBB' },
    ]) {
      const r = await corregir(token, contrato.id, {
        canon_centavos: 2000000,
        ...campo,
      }).expect(BAD_REQUEST);
      expect(codigoDe(r)).toBe('CAMPO_NO_EDITABLE');
    }
    await corregirInquilino(token, contrato.id, {}).expect(BAD_REQUEST);
    expect(await filaContrato(contrato.id)).toEqual(antes);
  }, 60000);

  it('las validaciones son las de crear(): canon, día de pago, forma de pago, datos de recaudo y depósito', async () => {
    const { token, contrato } = await escenario();
    const antes = await filaContrato(contrato.id);
    for (const cuerpo of [
      { canon_centavos: 0 },
      { canon_centavos: -5 },
      { canon_centavos: 1000.5 },
      { canon_centavos: null },
      { dia_pago: 0 },
      { dia_pago: 32 },
      { dia_pago: 5.5 },
      { forma_pago: '' },
      { datos_recaudo: '' },
      { deposito_centavos: -1 },
      { fecha_inicio: 'no-es-fecha' },
    ]) {
      const r = await corregir(token, contrato.id, cuerpo).expect(BAD_REQUEST);
      expect([JSON.stringify(cuerpo), codigoDe(r)]).toEqual([
        JSON.stringify(cuerpo),
        'VALIDACION',
      ]);
    }
    // Vivienda: sin depósito en dinero (Ley 820, art. 16).
    const r = await corregir(token, contrato.id, {
      deposito_centavos: 500000,
    }).expect(BAD_REQUEST);
    expect(codigoDe(r)).toBe('DEPOSITO_NO_PERMITIDO_VIVIENDA');
    expect(await filaContrato(contrato.id)).toEqual(antes);
  }, 60000);

  it('en Local Comercial acepta y quita el depósito', async () => {
    const { token, contrato } = await escenario('LOCAL_COMERCIAL');
    const conDeposito = await corregir(token, contrato.id, {
      deposito_centavos: 2000000,
    }).expect(OK);
    expect((conDeposito.body as RespuestaCorreccion).deposito_centavos).toBe(
      2000000,
    );
    const sinDeposito = await corregir(token, contrato.id, {
      deposito_centavos: null,
    }).expect(OK);
    expect(
      (sinDeposito.body as RespuestaCorreccion).deposito_centavos,
    ).toBeNull();
    expect(await documentosEnBd(contrato.id)).toHaveLength(3);
  }, 90000);

  // ------------------------------------------------------------------
  // Condiciones de edición
  // ------------------------------------------------------------------
  it('un contrato vinculado responde 409 CONTRATO_YA_VINCULADO en ambos endpoints y nada cambia', async () => {
    const { token, contrato } = await escenario();
    await autenticarInquilino(app, contrato.codigo, 'ya-vinculado@correo.com');
    const antes = await filaContrato(contrato.id);
    const documentosAntes = await documentosEnBd(contrato.id);

    const a = await corregir(token, contrato.id, {
      canon_centavos: 2000000,
    }).expect(CONFLICTO);
    const b = await corregirInquilino(token, contrato.id, {
      nombre: 'Otro Nombre',
    }).expect(CONFLICTO);

    expect(codigoDe(a)).toBe('CONTRATO_YA_VINCULADO');
    expect(codigoDe(b)).toBe('CONTRATO_YA_VINCULADO');
    expect((a.body as CuerpoError).mensaje).toEqual(expect.any(String));
    expect(await filaContrato(contrato.id)).toEqual(antes);
    expect(await documentosEnBd(contrato.id)).toEqual(documentosAntes);
  }, 90000);

  it('con otrosí, pago, terminación solicitada o estado no editable responde 409 CONTRATO_NO_EDITABLE y nada cambia', async () => {
    await prisma.configuracionIpc.create({
      data: { anio: hoy.getUTCFullYear() - 1, porcentaje: 5.1 },
    });
    const { access_token } = await nuevoArrendador();

    const casos: Array<
      [string, (id: string) => Promise<void>, Record<string, unknown>?]
    > = [];
    // Incremento aplicado (contrato de 13 meses de antigüedad).
    casos.push([
      'incremento',
      async (id) => {
        await post(access_token, `/contratos/${id}/aplicar-incremento`).expect(
          CREADO,
        );
      },
      {
        fecha_inicio: iso(sumarMesesUTC(hoy, -13)),
        fecha_fin: iso(sumarDiasUTC(hoy, 60)),
      },
    ]);
    casos.push([
      'pago',
      async (id) => {
        const c = await filaContrato(id);
        await prisma.pago.create({
          data: {
            arrendador_id: c.arrendador_id,
            contrato_id: id,
            monto_centavos: 1000000,
            fecha_reportada: hoy,
            periodo: new Date(
              Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1),
            ),
          },
        });
      },
    ]);
    casos.push([
      'terminación solicitada',
      async (id) => {
        await prisma.contrato.update({
          where: { id },
          data: {
            terminacionAnticipadaSolicitada: true,
            terminacionAnticipadaSolicitadaPor: 'ARRENDADOR',
            terminacionAnticipadaSolicitadaEn: new Date(),
            terminacionAnticipadaMotivo: 'prueba',
            terminacion_fecha_efectiva: sumarDiasUTC(hoy, 5),
          },
        });
      },
    ]);
    for (const estado of [
      'VENCIDO',
      'TERMINADO_ANTICIPADAMENTE',
      'CANCELADO',
    ] as const) {
      casos.push([
        `estado ${estado}`,
        async (id) => {
          await prisma.contrato.update({ where: { id }, data: { estado } });
        },
      ]);
    }

    for (const [nombre, preparar, extra] of casos) {
      const { unidadId } = await nuevaUnidad(access_token);
      const contrato = await crearContratoNuevo(
        access_token,
        unidadId,
        'VIVIENDA_URBANA_LEY_820',
        extra ?? {},
      );
      await preparar(contrato.id);
      const antes = await filaContrato(contrato.id);
      const documentosAntes = await documentosEnBd(contrato.id);

      const a = await corregir(access_token, contrato.id, {
        canon_centavos: 2000000,
      }).expect(CONFLICTO);
      const b = await corregirInquilino(access_token, contrato.id, {
        nombre: 'Otro Nombre',
      }).expect(CONFLICTO);

      expect([nombre, codigoDe(a)]).toEqual([nombre, 'CONTRATO_NO_EDITABLE']);
      expect([nombre, codigoDe(b)]).toEqual([nombre, 'CONTRATO_NO_EDITABLE']);
      expect(await filaContrato(contrato.id)).toEqual(antes);
      expect((await documentosEnBd(contrato.id)).length).toBe(
        documentosAntes.length,
      );
    }
  }, 300000);

  it('un contrato de otro arrendador, inexistente o con id inválido responde 404 en ambos endpoints', async () => {
    const { contrato } = await escenario();
    const otro = await nuevoArrendador();
    const antes = await filaContrato(contrato.id);
    for (const id of [
      contrato.id,
      '00000000-0000-4000-8000-000000000000',
      'no-es-un-id',
    ]) {
      await corregir(otro.access_token, id, { canon_centavos: 2000000 }).expect(
        NO_ENCONTRADO,
      );
      await corregirInquilino(otro.access_token, id, {
        nombre: 'Otro Nombre',
      }).expect(NO_ENCONTRADO);
    }
    await request(app.getHttpServer())
      .patch(`/contratos/${contrato.id}`)
      .send({ canon_centavos: 2000000 })
      .expect(HttpStatus.UNAUTHORIZED);
    expect(await filaContrato(contrato.id)).toEqual(antes);
  }, 60000);

  // ------------------------------------------------------------------
  // Fechas
  // ------------------------------------------------------------------
  it('cambiar fechas: traslape con otro contrato de la unidad = 409 sin cambios; el propio contrato no cuenta', async () => {
    const { token, unidadId, contrato } = await escenario(
      'VIVIENDA_URBANA_LEY_820',
      {
        fecha_inicio: iso(sumarDiasUTC(hoy, -10)),
        fecha_fin: iso(sumarDiasUTC(hoy, 300)),
      },
    );
    // Contrato siguiente PROGRAMADO en la misma unidad.
    const siguiente = await crearContratoNuevo(
      token,
      unidadId,
      'VIVIENDA_URBANA_LEY_820',
      {
        fecha_inicio: iso(sumarDiasUTC(hoy, 400)),
        fecha_fin: iso(sumarDiasUTC(hoy, 700)),
      },
    );
    expect((await filaContrato(siguiente.id)).estado).toBe('PROGRAMADO');
    const antes = await filaContrato(contrato.id);

    const choque = await corregir(token, contrato.id, {
      fecha_fin: iso(sumarDiasUTC(hoy, 500)),
    }).expect(CONFLICTO);
    expect(codigoDe(choque)).toBe('TRASLAPE_DE_CONTRATOS');
    expect(await filaContrato(contrato.id)).toEqual(antes);
    expect(await documentosEnBd(contrato.id)).toHaveLength(1);

    // Justo el último día antes del siguiente: sin traslape (y el propio no cuenta).
    const bien = await corregir(token, contrato.id, {
      fecha_fin: iso(sumarDiasUTC(hoy, 399)),
    }).expect(OK);
    expect((bien.body as RespuestaCorreccion).fecha_fin.slice(0, 10)).toBe(
      iso(sumarDiasUTC(hoy, 399)),
    );
    // Compartir un día con el siguiente sí choca.
    const choqueUnDia = await corregir(token, contrato.id, {
      fecha_fin: iso(sumarDiasUTC(hoy, 400)),
    }).expect(CONFLICTO);
    expect(codigoDe(choqueUnDia)).toBe('TRASLAPE_DE_CONTRATOS');
  }, 120000);

  it('mover fecha_inicio al futuro pasa ACTIVO a PROGRAMADO y de vuelta a ACTIVO; fin <= inicio es 400', async () => {
    const { token, contrato } = await escenario();
    expect((await filaContrato(contrato.id)).estado).toBe('ACTIVO');

    const programado = await corregir(token, contrato.id, {
      fecha_inicio: iso(sumarDiasUTC(hoy, 5)),
    }).expect(OK);
    expect((programado.body as RespuestaCorreccion).estado).toBe('PROGRAMADO');
    expect((await filaContrato(contrato.id)).estado).toBe('PROGRAMADO');

    const activo = await corregir(token, contrato.id, {
      fecha_inicio: iso(sumarDiasUTC(hoy, -1)),
    }).expect(OK);
    expect((activo.body as RespuestaCorreccion).estado).toBe('ACTIVO');

    const antes = await filaContrato(contrato.id);
    // Solo fecha_fin, pero anterior al inicio guardado.
    await corregir(token, contrato.id, {
      fecha_fin: iso(sumarDiasUTC(hoy, -3)),
    }).expect(BAD_REQUEST);
    // Las dos en el mismo cuerpo, invertidas.
    await corregir(token, contrato.id, {
      fecha_inicio: iso(sumarDiasUTC(hoy, 20)),
      fecha_fin: iso(sumarDiasUTC(hoy, 10)),
    }).expect(BAD_REQUEST);
    expect(await filaContrato(contrato.id)).toEqual(antes);
  }, 120000);

  // ------------------------------------------------------------------
  // Datos del inquilino
  // ------------------------------------------------------------------
  it('cambiar la cédula a una inexistente: identidad nueva, código anterior muerto y código nuevo vivo', async () => {
    const { token, contrato } = await escenario();
    const identidadesAntes = await prisma.inquilino.count();
    const cedula = cedulaNueva();

    const r = await corregirInquilino(token, contrato.id, {
      cedula: ` ${cedula.toLowerCase()} `,
      nombre: '  Nombre Corregido  ',
      telefono: ' 3105557788 ',
    }).expect(OK);
    const cuerpo = r.body as RespuestaCorreccion;

    expect(cuerpo.inquilino).toMatchObject({
      nombre: 'Nombre Corregido',
      cedula,
      telefono: '3105557788',
    });
    expect(cuerpo.codigo_acceso?.codigo).toMatch(
      /^RC-[A-Z2-9]{4}-[A-Z2-9]{4}$/,
    );
    expect(cuerpo.codigo_acceso?.codigo).not.toBe(contrato.codigo);
    expect(cuerpo.documento).toMatchObject({
      tipo: 'CONTRATO_ORIGINAL',
      version: 2,
    });

    const fila = await filaContrato(contrato.id);
    expect(fila.inquilino_id).not.toBe(contrato.inquilinoId);
    expect(fila.inquilino_cedula).toBe(cedula);
    expect(await prisma.inquilino.count()).toBe(identidadesAntes + 1);
    const identidad = await prisma.inquilino.findUniqueOrThrow({
      where: { cedula },
    });
    expect(identidad.id).toBe(fila.inquilino_id);
    const codigo = await prisma.codigoAcceso.findUniqueOrThrow({
      where: { contrato_id: contrato.id },
    });
    expect(codigo.codigo).toBe(cuerpo.codigo_acceso?.codigo);
    expect(codigo.inquilino_id).toBe(fila.inquilino_id);

    // Código anterior: 404 genérico; el nuevo sirve.
    const viejo = await validar(contrato.codigo);
    expect(viejo.status).toBe(NO_ENCONTRADO);
    const nuevo = await validar(cuerpo.codigo_acceso?.codigo ?? '');
    expect(nuevo.status).toBe(OK);
  }, 120000);

  it('cambiar la cédula a una que ya existe: reasigna sin tocar el perfil global y la respuesta es indistinguible', async () => {
    // Persona que ya existe en la plataforma (por otro arrendador).
    const otroArrendador = await nuevoArrendador();
    const { unidadId: unidadOtra } = await nuevaUnidad(
      otroArrendador.access_token,
    );
    const existente = await crearContratoNuevo(
      otroArrendador.access_token,
      unidadOtra,
      'VIVIENDA_URBANA_LEY_820',
      {},
      { nombre: 'Perfil Global Original', telefono: '3200000000' },
    );
    const perfilAntes = await prisma.inquilino.findUniqueOrThrow({
      where: { id: existente.inquilinoId },
    });

    const a = await escenario();
    const b = await escenario();
    const conExistente = await corregirInquilino(a.token, a.contrato.id, {
      cedula: existente.cedula,
      nombre: 'Nombre Escrito Por Arrendador',
      telefono: '3111111111',
    }).expect(OK);
    const conNueva = await corregirInquilino(b.token, b.contrato.id, {
      cedula: cedulaNueva(),
      nombre: 'Nombre Escrito Por Arrendador',
      telefono: '3111111111',
    }).expect(OK);

    // Reasignado a la identidad existente, que NO se modificó.
    expect((await filaContrato(a.contrato.id)).inquilino_id).toBe(
      existente.inquilinoId,
    );
    expect(
      await prisma.inquilino.findUniqueOrThrow({
        where: { id: existente.inquilinoId },
      }),
    ).toEqual(perfilAntes);
    const cuerpoExistente = conExistente.body as RespuestaCorreccion;
    expect(cuerpoExistente.inquilino).toMatchObject({
      nombre: 'Nombre Escrito Por Arrendador',
      telefono: '3111111111',
    });
    expect(JSON.stringify(cuerpoExistente)).not.toContain(
      'Perfil Global Original',
    );
    expect(JSON.stringify(cuerpoExistente)).not.toContain('3200000000');

    // Misma forma en los dos casos (solo cambian valores, no la estructura).
    const forma = (valor: unknown): unknown =>
      Array.isArray(valor)
        ? valor.map(forma)
        : valor && typeof valor === 'object'
          ? Object.fromEntries(
              Object.entries(valor)
                .sort(([x], [y]) => x.localeCompare(y))
                .map(([k, v]) => [k, forma(v)]),
            )
          : typeof valor;
    expect(forma(conExistente.body)).toEqual(forma(conNueva.body));
    expect(conExistente.status).toBe(conNueva.status);
  }, 180000);

  it('cambiar solo nombre o teléfono no regenera el código; el teléfono solo no genera PDF nuevo', async () => {
    const { token, contrato } = await escenario();
    const codigoAntes = await prisma.codigoAcceso.findUniqueOrThrow({
      where: { contrato_id: contrato.id },
    });

    const soloTelefono = await corregirInquilino(token, contrato.id, {
      telefono: '3999999999',
    }).expect(OK);
    expect(soloTelefono.body as RespuestaCorreccion).not.toHaveProperty(
      'codigo_acceso',
    );
    expect((soloTelefono.body as RespuestaCorreccion).documento).toBeNull();
    expect(await documentosEnBd(contrato.id)).toHaveLength(1);

    const soloNombre = await corregirInquilino(token, contrato.id, {
      nombre: 'Nombre Distinto',
    }).expect(OK);
    expect(soloNombre.body as RespuestaCorreccion).not.toHaveProperty(
      'codigo_acceso',
    );
    expect((soloNombre.body as RespuestaCorreccion).documento).toMatchObject({
      version: 2,
    });

    const fila = await filaContrato(contrato.id);
    expect(fila.inquilino_id).toBe(contrato.inquilinoId);
    expect(fila.inquilino_telefono).toBe('3999999999');
    expect(fila.inquilino_nombre).toBe('Nombre Distinto');
    const codigoDespues = await prisma.codigoAcceso.findUniqueOrThrow({
      where: { contrato_id: contrato.id },
    });
    expect(codigoDespues.codigo).toBe(codigoAntes.codigo);
    expect((await validar(codigoAntes.codigo)).status).toBe(OK);
    // El perfil global de la identidad no cambia nunca.
    const perfil = await prisma.inquilino.findUniqueOrThrow({
      where: { id: contrato.inquilinoId },
    });
    expect(perfil.nombre).toBe('Persona Escrita');
    expect(perfil.telefono).toBe('3001112233');
  }, 120000);

  it('valida los datos del inquilino como crear(): nombre y teléfono no vacíos, cédula de 5 a 20 alfanuméricos', async () => {
    const { token, contrato } = await escenario();
    const antes = await filaContrato(contrato.id);
    for (const cuerpo of [
      { nombre: '   ' },
      { telefono: '   ' },
      { cedula: '12' },
      { cedula: 'A'.repeat(21) },
      { cedula: '---' },
    ]) {
      await corregirInquilino(token, contrato.id, cuerpo).expect(BAD_REQUEST);
    }
    expect(await filaContrato(contrato.id)).toEqual(antes);
  }, 60000);

  // ------------------------------------------------------------------
  // Fallo del PDF y recuperación
  // ------------------------------------------------------------------
  it('si el almacenamiento falla al generar el PDF, la corrección queda aplicada, documento es null y regenerar lo recupera', async () => {
    const { token, contrato } = await escenario();
    const subir = jest
      .spyOn(almacenamiento, 'subirArchivo')
      .mockRejectedValue(new Error('storage caído'));

    const r = await corregir(token, contrato.id, {
      canon_centavos: 1500000,
    }).expect(OK);
    const cuerpo = r.body as RespuestaCorreccion;

    expect(cuerpo.canon_centavos).toBe(1500000);
    expect(cuerpo.documento).toBeNull();
    expect((await filaContrato(contrato.id)).canon_centavos).toBe(1500000);
    expect(await documentosEnBd(contrato.id)).toHaveLength(1);

    subir.mockRestore();
    const regenerar = await post(
      token,
      `/contratos/${contrato.id}/documentos/regenerar`,
    ).expect(CREADO);
    expect(regenerar.body).toEqual({
      generados: [{ tipo: 'CONTRATO_ORIGINAL', version: 2 }],
      ya_existian: 0,
    });
    const filas = await documentosEnBd(contrato.id);
    expect(filas.map((f) => f.version)).toEqual([1, 2]);
    expect((await filaContrato(contrato.id)).pdf_contrato_ruta).toBe(
      filas[1].ruta,
    );

    // Segunda vez: idempotente.
    const otra = await post(
      token,
      `/contratos/${contrato.id}/documentos/regenerar`,
    ).expect(CREADO);
    expect(otra.body).toEqual({ generados: [], ya_existian: 1 });
    expect(await documentosEnBd(contrato.id)).toHaveLength(2);
  }, 120000);

  // ------------------------------------------------------------------
  // Varias versiones del original
  // ------------------------------------------------------------------
  it('regenerar, el listado y el ZIP funcionan con varias versiones del original; un incremento posterior usa el canon corregido como anterior', async () => {
    await prisma.configuracionIpc.create({
      data: { anio: hoy.getUTCFullYear() - 1, porcentaje: 5.1 },
    });
    const { token, inmuebleId, contrato } = await escenario(
      'VIVIENDA_URBANA_LEY_820',
      {
        fecha_inicio: iso(sumarMesesUTC(hoy, -13)),
        fecha_fin: iso(sumarDiasUTC(hoy, 60)),
      },
    );
    await corregir(token, contrato.id, { canon_centavos: 1200000 }).expect(OK);
    await corregir(token, contrato.id, { canon_centavos: 1300000 }).expect(OK);
    expect(
      (await documentosEnBd(contrato.id)).map((d) => [d.version, d.tipo]),
    ).toEqual([
      [1, 'CONTRATO_ORIGINAL'],
      [2, 'CONTRATO_ORIGINAL'],
      [3, 'CONTRATO_ORIGINAL'],
    ]);

    const generarPdf = jest.spyOn(documentos, 'generarPdf');
    await post(token, `/contratos/${contrato.id}/aplicar-incremento`).expect(
      CREADO,
    );
    // El otrosí parte del canon corregido ($13.000), no del original v1.
    expect(generarPdf.mock.calls.at(-1)?.[0]).toContain('$13.000');

    // regenerar no toca nada: el original vigente es el último.
    const regenerar = await post(
      token,
      `/contratos/${contrato.id}/documentos/regenerar`,
    ).expect(CREADO);
    expect(regenerar.body).toEqual({ generados: [], ya_existian: 2 });

    const listado = (
      await get(token, `/contratos/${contrato.id}/documentos`).expect(OK)
    ).body as DocumentoRespuesta[];
    expect(listado.map((d) => [d.version, d.tipo])).toEqual([
      [1, 'CONTRATO_ORIGINAL'],
      [2, 'CONTRATO_ORIGINAL'],
      [3, 'CONTRATO_ORIGINAL'],
      [4, 'OTROSI_INCREMENTO'],
    ]);
    for (const documento of listado) {
      expect(documento.url_firmada).toMatch(URL_FIRMADA);
    }

    const zip = await request(app.getHttpServer())
      .get(`/inmuebles/${inmuebleId}/descargar-documentos`)
      .set('Authorization', `Bearer ${token}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(OK);
    const nombres = nombresDelZip(zip.body as Buffer);
    const corto = contrato.id.slice(0, 8);
    for (const nombre of [
      'v1-CONTRATO_ORIGINAL',
      'v2-CONTRATO_ORIGINAL',
      'v3-CONTRATO_ORIGINAL',
      'v4-OTROSI_INCREMENTO',
    ]) {
      expect(nombres).toContain(`contratos/${corto}/${nombre}.pdf`);
    }
  }, 240000);

  // ------------------------------------------------------------------
  // Concurrencia con la vinculación
  // ------------------------------------------------------------------
  /** Persona con cuenta y un segundo contrato sin vincular de la misma identidad. */
  async function personaConSegundoContrato() {
    const { access_token } = await nuevoArrendador();
    const { unidadId: u1 } = await nuevaUnidad(access_token);
    const primero = await crearContratoNuevo(access_token, u1);
    const inq = await autenticarInquilino(
      app,
      primero.codigo,
      `carrera-${contador}@correo.com`,
    );
    const { unidadId: u2 } = await nuevaUnidad(access_token);
    const segundo = await crearContratoNuevo(
      access_token,
      u2,
      'VIVIENDA_URBANA_LEY_820',
      {},
      { cedula: primero.cedula },
    );
    return { token: access_token, inq, primero, segundo };
  }

  it('carrera: vincular y corregir a la vez nunca deja un contrato vinculado con datos a medio cambiar', async () => {
    for (let intento = 0; intento < 6; intento += 1) {
      const { token, inq, segundo } = await personaConSegundoContrato();
      const cedulaOriginal = segundo.cedula;

      const [vinculacion, correccion] = await Promise.all([
        vincularContrato(app, inq, segundo.codigo),
        corregir(token, segundo.id, { canon_centavos: 1700000 }),
      ]);

      const fila = await filaContrato(segundo.id);
      expect(fila.inquilino_cedula).toBe(cedulaOriginal);
      if (correccion.status === CONFLICTO) {
        // Vinculó primero: el PATCH no cambió nada.
        expect(codigoDe(correccion)).toBe('CONTRATO_YA_VINCULADO');
        expect(vinculacion.status).toBe(OK);
        expect(fila.vinculado_en).not.toBeNull();
        expect(fila.canon_centavos).toBe(1000000);
        expect(await documentosEnBd(segundo.id)).toHaveLength(1);
      } else {
        // Corrigió primero: la vinculación ve los datos ya corregidos.
        expect(correccion.status).toBe(OK);
        expect(vinculacion.status).toBe(OK);
        expect(fila.canon_centavos).toBe(1700000);
        expect(fila.vinculado_en).not.toBeNull();
      }
    }
  }, 300000);

  it('carrera con cambio de cédula: si se reasigna el contrato, el código viejo no puede vincularlo', async () => {
    for (let intento = 0; intento < 6; intento += 1) {
      const { token, inq, primero, segundo } =
        await personaConSegundoContrato();

      const [vinculacion, correccion] = await Promise.all([
        vincularContrato(app, inq, segundo.codigo),
        corregirInquilino(token, segundo.id, { cedula: cedulaNueva() }),
      ]);

      const fila = await filaContrato(segundo.id);
      if (correccion.status === CONFLICTO) {
        expect(codigoDe(correccion)).toBe('CONTRATO_YA_VINCULADO');
        expect(vinculacion.status).toBe(OK);
        expect(fila.vinculado_en).not.toBeNull();
        expect(fila.inquilino_id).toBe(primero.inquilinoId);
      } else {
        expect(correccion.status).toBe(OK);
        // Reasignado a otra persona: la cuenta anterior NO lo vincula.
        expect(fila.inquilino_id).not.toBe(primero.inquilinoId);
        expect(vinculacion.status).toBe(NO_ENCONTRADO);
        expect(fila.vinculado_en).toBeNull();
      }
    }
  }, 300000);

  it('vincularEnTransaccion detrás del bloqueo del PATCH: si el contrato se reasignó, la vinculación con el código viejo falla y no vincula', async () => {
    const { inq, primero, segundo } = await personaConSegundoContrato();
    const otraCedula = cedulaNueva();
    let liberar: () => void = () => undefined;
    const pausa = new Promise<void>((resolver) => {
      liberar = resolver;
    });

    // Simula un PATCH que ya tomó el bloqueo de la fila y aún no confirma.
    const transaccionAbierta = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Contrato" WHERE id = ${segundo.id}::uuid FOR UPDATE`;
        await tx.inquilino.createMany({
          data: [
            {
              nombre: 'Otra Persona',
              cedula: otraCedula,
              telefono: '3000000000',
              arrendador_id: null,
            },
          ],
          skipDuplicates: true,
        });
        const otra = await tx.inquilino.findUniqueOrThrow({
          where: { cedula: otraCedula },
        });
        await tx.contrato.update({
          where: { id: segundo.id },
          data: { inquilino_id: otra.id, inquilino_cedula: otraCedula },
        });
        await tx.codigoAcceso.update({
          where: { contrato_id: segundo.id },
          data: { inquilino_id: otra.id, codigo: 'RC-ZZZZ-ZZZZ' },
        });
        await pausa;
      },
      { timeout: 30000 },
    );

    await new Promise((resolver) => setTimeout(resolver, 500));
    // Con el código viejo, mientras el bloqueo sigue tomado.
    const vinculacion = vincularContrato(app, inq, segundo.codigo).then(
      (r) => r,
    );
    await new Promise((resolver) => setTimeout(resolver, 1500));
    liberar();
    await transaccionAbierta;
    const respuesta = await vinculacion;

    expect(respuesta.status).toBe(NO_ENCONTRADO);
    const fila = await filaContrato(segundo.id);
    expect(fila.vinculado_en).toBeNull();
    expect(fila.inquilino_id).not.toBe(primero.inquilinoId);
  }, 120000);
});
