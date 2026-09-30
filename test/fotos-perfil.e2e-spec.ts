import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { randomUUID } from 'crypto';
import { readdirSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { App } from 'supertest/types';
import { AlmacenamientoService } from '../src/almacenamiento/almacenamiento.service';
import { AppModule } from '../src/app.module';
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

const URL_FIRMADA = /^https:\/\/.*\.supabase\.co\/storage\/v1\/object\/sign\//;
const OK = HttpStatus.OK;
const NO_ENCONTRADO = HttpStatus.NOT_FOUND;

type Entidad = 'unidad' | 'arrendador' | 'inquilino';

interface Contexto {
  arr: string;
  arrendadorId: string;
  inmuebleId: string;
  unidadId: string;
  inq: string;
  inquilinoId: string;
  contratoId: string;
  correoArrendador: string;
}

const CAMPO: Record<Entidad, string> = {
  unidad: 'foto_principal_url',
  arrendador: 'foto_cedula_nit_url',
  inquilino: 'foto_cedula_url',
};

describe('Fotos de cédula y de unidad (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let almacenamiento: AlmacenamientoService;
  let contador = 0;

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

  async function contexto(): Promise<Contexto> {
    contador += 1;
    const { access_token, arrendador } = await registrarArrendador(
      app,
      `Arrendador Fotos ${contador}`,
      `fotos-${contador}@correo.com`,
    );
    const inmueble = await crearInmueble(app, access_token, `FOTO-${contador}`);
    const ficha = await crearInquilino(app, access_token);
    const contrato = await crearContrato(
      app,
      access_token,
      inmueble.unidades[0].id,
      ficha.id,
    );
    const inq = await autenticarInquilino(
      app,
      contrato.codigo_acceso?.codigo ?? '',
      `fotos-inq-${contador}@correo.com`,
    );
    return {
      arr: access_token,
      arrendadorId: arrendador.id,
      inmuebleId: inmueble.id,
      unidadId: inmueble.unidades[0].id,
      inq,
      inquilinoId: ficha.id,
      contratoId: contrato.id,
      correoArrendador: `fotos-${contador}@correo.com`,
    };
  }

  const ruta = (e: Entidad, c: Contexto): string =>
    e === 'unidad'
      ? `/inmuebles/${c.inmuebleId}/unidades/${c.unidadId}/foto-principal`
      : e === 'arrendador'
        ? '/arrendadores/perfil/foto-cedula'
        : '/inquilino/perfil/foto-cedula';

  const token = (e: Entidad, c: Contexto): string =>
    e === 'inquilino' ? c.inq : c.arr;

  const prefijo = (e: Entidad, c: Contexto): string =>
    e === 'unidad'
      ? `inmuebles/${c.inmuebleId}/unidades/${c.unidadId}/`
      : e === 'arrendador'
        ? `arrendadores/${c.arrendadorId}/`
        : `inquilinos/${c.inquilinoId}/`;

  function subir(
    e: Entidad,
    c: Contexto,
    contenido: Buffer | null,
    filename = 'foto.jpg',
    contentType = 'image/jpeg',
    autorizacion: string = token(e, c),
    urlRuta: string = ruta(e, c),
  ) {
    const peticion = request(app.getHttpServer())
      .post(urlRuta)
      .set('Authorization', `Bearer ${autorizacion}`);
    return contenido
      ? peticion.attach('foto', contenido, { filename, contentType })
      : peticion.field('nada', 'x');
  }

  async function valorEnBd(e: Entidad, c: Contexto): Promise<string | null> {
    if (e === 'unidad') {
      return (
        await prisma.unidad.findUniqueOrThrow({
          where: { id: c.unidadId },
          select: { foto_principal_url: true },
        })
      ).foto_principal_url;
    }
    if (e === 'arrendador') {
      return (
        await prisma.arrendador.findUniqueOrThrow({
          where: { id: c.arrendadorId },
          select: { foto_cedula_nit_url: true },
        })
      ).foto_cedula_nit_url;
    }
    return (
      await prisma.inquilino.findUniqueOrThrow({
        where: { id: c.inquilinoId },
        select: { foto_cedula_url: true },
      })
    ).foto_cedula_url;
  }

  async function fijarValorEnBd(e: Entidad, c: Contexto, valor: string | null) {
    if (e === 'unidad') {
      await prisma.unidad.update({
        where: { id: c.unidadId },
        data: { foto_principal_url: valor },
      });
    } else if (e === 'arrendador') {
      await prisma.arrendador.update({
        where: { id: c.arrendadorId },
        data: { foto_cedula_nit_url: valor },
      });
    } else {
      await prisma.inquilino.update({
        where: { id: c.inquilinoId },
        data: { foto_cedula_url: valor },
      });
    }
  }

  // Se consulta con listar (no con descargar: el CDN puede servir en caché un archivo ya borrado).
  const existe = async (rutaArchivo: string): Promise<boolean> => {
    const corte = rutaArchivo.lastIndexOf('/');
    const archivos = await almacenamiento.listar(rutaArchivo.slice(0, corte));
    return archivos.some(
      (a) => !a.esCarpeta && a.name === rutaArchivo.slice(corte + 1),
    );
  };

  const archivosBajo = async (carpeta: string): Promise<string[]> =>
    (await almacenamiento.listar(carpeta.replace(/\/$/, '')))
      .filter((a) => !a.esCarpeta)
      .map((a) => a.name);

  const ENTIDADES: Entidad[] = ['unidad', 'arrendador', 'inquilino'];

  // ------------------------------------------------------------------
  // Subir y reemplazar
  // ------------------------------------------------------------------
  it.each(ENTIDADES)(
    '%s: sube con ruta generada por el servidor, responde con URL firmada y reemplaza borrando solo el archivo propio anterior',
    async (e) => {
      const c = await contexto();
      const primera = Buffer.from('foto uno png');

      const r1 = await subir(e, c, primera, 'a.png', 'image/png').expect(OK);
      const cuerpo1 = r1.body as Record<string, unknown>;
      expect(cuerpo1[CAMPO[e]]).toMatch(URL_FIRMADA);
      expect(JSON.stringify(cuerpo1)).not.toContain('contrasena_hash');
      const ruta1 = (await valorEnBd(e, c)) ?? '';
      expect(ruta1.startsWith(prefijo(e, c))).toBe(true);
      expect(ruta1.endsWith('.png')).toBe(true);
      expect(
        (await almacenamiento.descargarArchivo(ruta1)).equals(primera),
      ).toBe(true);

      const segunda = Buffer.from('foto dos jpeg');
      const r2 = await subir(e, c, segunda).expect(OK);
      expect((r2.body as Record<string, unknown>)[CAMPO[e]]).toMatch(
        URL_FIRMADA,
      );
      const ruta2 = (await valorEnBd(e, c)) ?? '';
      expect(ruta2.startsWith(prefijo(e, c))).toBe(true);
      expect(ruta2).not.toBe(ruta1);
      expect(await existe(ruta1)).toBe(false);
      expect(await existe(ruta2)).toBe(true);
      expect(await archivosBajo(prefijo(e, c))).toHaveLength(1);
    },
    60000,
  );

  it.each(ENTIDADES)(
    '%s: el cliente no puede fijar la ruta (campos extra del formulario se ignoran)',
    async (e) => {
      const c = await contexto();
      await request(app.getHttpServer())
        .post(ruta(e, c))
        .set('Authorization', `Bearer ${token(e, c)}`)
        .field(CAMPO[e], 'contratos/otro/contrato.pdf')
        .field('ruta', 'contratos/otro/contrato.pdf')
        .attach('foto', Buffer.from('foto'), {
          filename: 'a.jpg',
          contentType: 'image/jpeg',
        })
        .expect(OK);
      expect(((await valorEnBd(e, c)) ?? '').startsWith(prefijo(e, c))).toBe(
        true,
      );
    },
    60000,
  );

  it.each(ENTIDADES)(
    '%s: al reemplazar NO borra un archivo ajeno (valor legado fuera del prefijo del servidor)',
    async (e) => {
      const c = await contexto();
      const legado = `contratos/legado-${randomUUID()}/v1-CONTRATO_ORIGINAL.pdf`;
      await almacenamiento.subirArchivo(
        Buffer.from('pdf legal'),
        legado,
        'application/pdf',
      );
      await fijarValorEnBd(e, c, legado);
      const eliminar = jest.spyOn(almacenamiento, 'eliminarArchivo');

      await subir(e, c, Buffer.from('foto nueva')).expect(OK);

      expect(eliminar).not.toHaveBeenCalledWith(legado);
      expect(await existe(legado)).toBe(true);
      expect(((await valorEnBd(e, c)) ?? '').startsWith(prefijo(e, c))).toBe(
        true,
      );
    },
    60000,
  );

  // ------------------------------------------------------------------
  // Pertenencia (unidad)
  // ------------------------------------------------------------------
  it('unidad ajena, de otro inmueble, inexistente o id inválido = 404 y no se sube nada', async () => {
    const c = await contexto();
    const otro = await contexto();
    const subirArchivo = jest.spyOn(almacenamiento, 'subirArchivo');
    const rutas = [
      // Unidad de otro arrendador.
      `/inmuebles/${otro.inmuebleId}/unidades/${otro.unidadId}/foto-principal`,
      // Unidad propia bajo el inmueble equivocado.
      `/inmuebles/${otro.inmuebleId}/unidades/${c.unidadId}/foto-principal`,
      `/inmuebles/${c.inmuebleId}/unidades/00000000-0000-4000-8000-000000000000/foto-principal`,
      `/inmuebles/00000000-0000-4000-8000-000000000000/unidades/${c.unidadId}/foto-principal`,
      `/inmuebles/${c.inmuebleId}/unidades/no-es-un-id/foto-principal`,
    ];
    for (const r of rutas) {
      await subir(
        'unidad',
        c,
        Buffer.from('foto'),
        'a.jpg',
        'image/jpeg',
        c.arr,
        r,
      ).expect(NO_ENCONTRADO);
    }
    expect(subirArchivo).not.toHaveBeenCalled();
    expect(await valorEnBd('unidad', otro)).toBeNull();
    expect(await valorEnBd('unidad', c)).toBeNull();
  }, 60000);

  it('los guards separan los roles y exigen token', async () => {
    const c = await contexto();
    for (const e of ENTIDADES) {
      const sinToken = await request(app.getHttpServer())
        .post(ruta(e, c))
        .attach('foto', Buffer.from('f'), {
          filename: 'a.jpg',
          contentType: 'image/jpeg',
        });
      expect(sinToken.status).toBe(HttpStatus.UNAUTHORIZED);
    }
    // Un inquilino no sube fotos del lado del arrendador y viceversa.
    const inqEnArr = await subir(
      'arrendador',
      c,
      Buffer.from('f'),
      'a.jpg',
      'image/jpeg',
      c.inq,
    );
    const inqEnUnidad = await subir(
      'unidad',
      c,
      Buffer.from('f'),
      'a.jpg',
      'image/jpeg',
      c.inq,
    );
    const arrEnInq = await subir(
      'inquilino',
      c,
      Buffer.from('f'),
      'a.jpg',
      'image/jpeg',
      c.arr,
    );
    for (const r of [inqEnArr, inqEnUnidad, arrEnInq]) {
      expect([HttpStatus.FORBIDDEN, HttpStatus.UNAUTHORIZED]).toContain(
        r.status,
      );
    }
    expect(await valorEnBd('arrendador', c)).toBeNull();
    expect(await valorEnBd('inquilino', c)).toBeNull();
  }, 60000);

  // ------------------------------------------------------------------
  // Validaciones (mismo formato que la portada)
  // ------------------------------------------------------------------
  it.each(ENTIDADES)(
    '%s: tipo no permitido = 415, tamaño excesivo = 413, sin archivo = 400',
    async (e) => {
      const c = await contexto();
      await subir(e, c, Buffer.from('pdf'), 'a.pdf', 'application/pdf').expect(
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      );
      await subir(
        e,
        c,
        Buffer.alloc(10 * 1024 * 1024 + 1, 1),
        'grande.jpg',
        'image/jpeg',
      ).expect(HttpStatus.PAYLOAD_TOO_LARGE);
      const sinArchivo = await subir(e, c, null).expect(HttpStatus.BAD_REQUEST);
      expect((sinArchivo.body as { message: unknown }).message).toBeDefined();
      expect(await valorEnBd(e, c)).toBeNull();
      expect(await archivosBajo(prefijo(e, c))).toHaveLength(0);
    },
    60000,
  );

  // ------------------------------------------------------------------
  // Sin archivo huérfano si la BD falla tras subir
  // ------------------------------------------------------------------
  it.each([
    ['unidad', 'Unidad'],
    ['arrendador', 'Arrendador'],
    ['inquilino', 'Inquilino'],
  ] as Array<[Entidad, string]>)(
    '%s: si la BD falla tras subir, borra el archivo subido y conserva el anterior',
    async (e, tabla) => {
      const c = await contexto();
      await subir(e, c, Buffer.from('foto buena')).expect(OK);
      const rutaBuena = (await valorEnBd(e, c)) ?? '';
      const eliminar = jest.spyOn(almacenamiento, 'eliminarArchivo');
      const subirArchivo = jest.spyOn(almacenamiento, 'subirArchivo');

      await prisma.$executeRawUnsafe(
        `CREATE OR REPLACE FUNCTION fallo_prueba_fotos() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'fallo forzado de prueba'; END; $$ LANGUAGE plpgsql`,
      );
      await prisma.$executeRawUnsafe(
        `CREATE TRIGGER fallo_prueba_fotos BEFORE UPDATE ON "${tabla}" FOR EACH ROW EXECUTE FUNCTION fallo_prueba_fotos()`,
      );
      try {
        await subir(e, c, Buffer.from('foto que no queda')).expect(
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      } finally {
        await prisma.$executeRawUnsafe(
          `DROP TRIGGER fallo_prueba_fotos ON "${tabla}"`,
        );
        await prisma.$executeRawUnsafe(`DROP FUNCTION fallo_prueba_fotos()`);
      }

      const subida = subirArchivo.mock.calls[0][1];
      expect(eliminar).toHaveBeenCalledWith(subida);
      expect(await existe(subida)).toBe(false);
      expect(await valorEnBd(e, c)).toBe(rutaBuena);
      expect(await existe(rutaBuena)).toBe(true);
      expect(await archivosBajo(prefijo(e, c))).toHaveLength(1);
    },
    90000,
  );

  // ------------------------------------------------------------------
  // GET /inquilino/perfil
  // ------------------------------------------------------------------
  it('GET /inquilino/perfil devuelve solo los campos del perfil con la foto firmada y sin contrasena_hash', async () => {
    const c = await contexto();
    const antes = await request(app.getHttpServer())
      .get('/inquilino/perfil')
      .set('Authorization', `Bearer ${c.inq}`)
      .expect(OK);
    expect(Object.keys(antes.body as object).sort()).toEqual([
      'cedula',
      'correo',
      'foto_cedula_url',
      'id',
      'nombre',
      'telefono',
    ]);
    expect(
      (antes.body as { foto_cedula_url: unknown }).foto_cedula_url,
    ).toBeNull();

    await subir('inquilino', c, Buffer.from('cedula')).expect(OK);
    const despues = await request(app.getHttpServer())
      .get('/inquilino/perfil')
      .set('Authorization', `Bearer ${c.inq}`)
      .expect(OK);
    expect(
      (despues.body as { foto_cedula_url: string }).foto_cedula_url,
    ).toMatch(URL_FIRMADA);
    expect((despues.body as { id: string }).id).toBe(c.inquilinoId);
    expect(JSON.stringify(despues.body)).not.toContain('contrasena');

    await request(app.getHttpServer()).get('/inquilino/perfil').expect(401);
    await request(app.getHttpServer())
      .get('/inquilino/perfil')
      .set('Authorization', `Bearer ${c.arr}`)
      .expect((r) => expect([401, 403]).toContain(r.status));
  }, 60000);

  // ------------------------------------------------------------------
  // Las respuestas existentes devuelven URL firmada, nunca la ruta
  // ------------------------------------------------------------------
  it('todas las respuestas que traen estos campos devuelven URL firmada (o null si falla la firma)', async () => {
    const c = await contexto();
    await subir('unidad', c, Buffer.from('u')).expect(OK);
    await subir('arrendador', c, Buffer.from('a')).expect(OK);
    await subir('inquilino', c, Buffer.from('i')).expect(OK);

    // Otras respuestas donde aparece la unidad: solicitud y pago.
    await request(app.getHttpServer())
      .post('/solicitudes-mantenimiento')
      .set('Authorization', `Bearer ${c.inq}`)
      .field('unidadId', c.unidadId)
      .field('descripcion', 'Fuga')
      .field('urgencia', 'ALTO')
      .expect(HttpStatus.CREATED);
    await request(app.getHttpServer())
      .post('/pagos')
      .set('Authorization', `Bearer ${c.inq}`)
      .field('contratoId', c.contratoId)
      .field('monto_centavos', '1000000')
      .field('fecha_reportada', new Date().toISOString().slice(0, 10))
      .field('periodo', `${new Date().toISOString().slice(0, 7)}-01`)
      .attach('comprobante', Buffer.from('c'), {
        filename: 'c.png',
        contentType: 'image/png',
      })
      .expect(HttpStatus.CREATED);

    const consultas: Array<[string, string, string, object?]> = [
      ['get', '/arrendadores/perfil', c.arr],
      ['patch', '/arrendadores/perfil', c.arr, { nombre: 'Nuevo Nombre' }],
      ['get', '/inmuebles', c.arr],
      ['get', `/inmuebles/${c.inmuebleId}`, c.arr],
      [
        'patch',
        `/inmuebles/${c.inmuebleId}/unidades/${c.unidadId}`,
        c.arr,
        { nombre: 'Unidad Renombrada' },
      ],
      ['get', '/contratos', c.arr],
      ['get', `/contratos/${c.contratoId}`, c.arr],
      ['get', '/pagos', c.arr],
      ['get', '/solicitudes-mantenimiento', c.arr],
      ['get', '/pagos/mios', c.inq],
      ['get', '/inquilino/solicitudes', c.inq],
      ['get', '/inquilino/perfil', c.inq],
    ];
    const encontrados: Record<string, string | null> = {};
    const recorrer = (nodo: unknown, origen: string): void => {
      if (Array.isArray(nodo)) {
        nodo.forEach((n) => recorrer(n, origen));
      } else if (nodo && typeof nodo === 'object') {
        for (const [clave, valor] of Object.entries(nodo)) {
          if (Object.values(CAMPO).includes(clave)) {
            encontrados[`${origen} :: ${clave}`] = valor as string | null;
          }
          recorrer(valor, origen);
        }
      }
    };
    for (const [metodo, url, tk, cuerpo] of consultas) {
      const base = request(app.getHttpServer());
      const peticion =
        metodo === 'get' ? base.get(url) : base.patch(url).send(cuerpo);
      const respuesta = await peticion.set('Authorization', `Bearer ${tk}`);
      expect([url, respuesta.status]).toEqual([url, OK]);
      recorrer(respuesta.body, `${metodo} ${url}`);
    }
    // Login del arrendador: también trae foto_cedula_nit_url.
    const login = await request(app.getHttpServer())
      .post('/auth/arrendador/login')
      .send({ correo: `fotos-${contador}@correo.com`, contrasena: 'clave123' })
      .expect(OK);
    recorrer(login.body, 'post /auth/arrendador/login');

    const claves = Object.keys(encontrados);
    // Se esperan al menos las tres fuentes principales.
    expect(claves.length).toBeGreaterThanOrEqual(10);
    for (const clave of claves) {
      expect([clave, encontrados[clave]?.slice(0, 8)]).toEqual([
        clave,
        'https://',
      ]);
    }
    for (const camino of [
      'get /arrendadores/perfil',
      'get /inmuebles',
      'get /contratos/',
      'get /pagos',
      'get /solicitudes-mantenimiento',
      'post /auth/arrendador/login',
    ]) {
      expect(claves.some((k) => k.startsWith(camino))).toBe(true);
    }

    // Si falla la firma: null y la respuesta no se cae.
    jest
      .spyOn(almacenamiento, 'generarUrlFirmada')
      .mockRejectedValue(new Error('firma caída'));
    const perfil = await request(app.getHttpServer())
      .get('/arrendadores/perfil')
      .set('Authorization', `Bearer ${c.arr}`)
      .expect(OK);
    expect(
      (perfil.body as { foto_cedula_nit_url: unknown }).foto_cedula_nit_url,
    ).toBeNull();
    const perfilInq = await request(app.getHttpServer())
      .get('/inquilino/perfil')
      .set('Authorization', `Bearer ${c.inq}`)
      .expect(OK);
    expect(
      (perfilInq.body as { foto_cedula_url: unknown }).foto_cedula_url,
    ).toBeNull();
    const detalle = await request(app.getHttpServer())
      .get(`/inmuebles/${c.inmuebleId}`)
      .set('Authorization', `Bearer ${c.arr}`)
      .expect(OK);
    expect(
      (detalle.body as { unidades: Array<{ foto_principal_url: unknown }> })
        .unidades[0].foto_principal_url,
    ).toBeNull();
  }, 120000);

  // ------------------------------------------------------------------
  // Solo se firman fotos de la propia entidad (B0.4-B2, corrección)
  // ------------------------------------------------------------------
  /** Valores que no pertenecen a la entidad: heredados, ajenos, data: o texto suelto. */
  const valoresAjenos = (e: Entidad, otro: Contexto, contratoId: string) => [
    `contratos/${contratoId}/v1-x.pdf`,
    'data:image/png;base64,iVBORw0KGgo=',
    'texto-suelto-sin-ruta',
    // Una foto de OTRA entidad del mismo tipo.
    `${prefijo(e, otro)}foto-ajena.jpg`,
  ];

  /** Lee la foto de la entidad por el GET que la expone. */
  async function leerFotoPorGet(e: Entidad, c: Contexto): Promise<unknown> {
    if (e === 'unidad') {
      const detalle = await request(app.getHttpServer())
        .get(`/inmuebles/${c.inmuebleId}`)
        .set('Authorization', `Bearer ${c.arr}`)
        .expect(OK);
      return (
        detalle.body as { unidades: Array<{ foto_principal_url: unknown }> }
      ).unidades[0].foto_principal_url;
    }
    const perfil = await request(app.getHttpServer())
      .get(e === 'arrendador' ? '/arrendadores/perfil' : '/inquilino/perfil')
      .set('Authorization', `Bearer ${token(e, c)}`)
      .expect(OK);
    return (perfil.body as Record<string, unknown>)[CAMPO[e]];
  }

  it.each(ENTIDADES)(
    '%s: un valor heredado, ajeno, data: o suelto sale null en el GET y no se firma; la foto propia subida por el endpoint sí se firma',
    async (e) => {
      const c = await contexto();
      const otro = await contexto();
      const firmar = jest.spyOn(almacenamiento, 'generarUrlFirmada');

      for (const valor of valoresAjenos(e, otro, c.contratoId)) {
        await fijarValorEnBd(e, c, valor);
        expect([valor.slice(0, 12), await leerFotoPorGet(e, c)]).toEqual([
          valor.slice(0, 12),
          null,
        ]);
        expect(firmar).not.toHaveBeenCalledWith(valor);
      }

      // Foto propia: subida por el endpoint (reemplaza el valor ajeno sin borrarlo).
      await subir(e, c, Buffer.from('foto propia')).expect(OK);
      const propia = (await valorEnBd(e, c)) ?? '';
      expect(propia.startsWith(prefijo(e, c))).toBe(true);
      expect(await leerFotoPorGet(e, c)).toMatch(URL_FIRMADA);
      expect(firmar).toHaveBeenCalledWith(propia);
    },
    120000,
  );

  it('arrendador: el login y el registro tampoco firman un valor ajeno', async () => {
    const c = await contexto();
    const firmar = jest.spyOn(almacenamiento, 'generarUrlFirmada');
    const legado = `contratos/${c.contratoId}/v1-x.pdf`;
    await fijarValorEnBd('arrendador', c, legado);

    const login = await request(app.getHttpServer())
      .post('/auth/arrendador/login')
      .send({
        correo: c.correoArrendador,
        contrasena: 'clave123',
      })
      .expect(OK);

    expect(
      (login.body as { arrendador: { foto_cedula_nit_url: unknown } })
        .arrendador.foto_cedula_nit_url,
    ).toBeNull();
    expect(firmar).not.toHaveBeenCalledWith(legado);
  }, 60000);

  it('respuestas anidadas y directas de la unidad: un valor ajeno sale null y no se firma; el propio se firma', async () => {
    const c = await contexto();
    const otro = await contexto();
    const firmar = jest.spyOn(almacenamiento, 'generarUrlFirmada');
    const ajeno = `contratos/${c.contratoId}/v1-x.pdf`;
    const deOtraUnidad = `${prefijo('unidad', otro)}foto-ajena.jpg`;
    const consultas = (): Array<[string, (b: unknown) => unknown]> => [
      [
        `/contratos/${c.contratoId}`,
        (b) =>
          (b as { unidad: { foto_principal_url: unknown } }).unidad
            .foto_principal_url,
      ],
      [
        '/inmuebles',
        (b) =>
          (b as Array<{ unidades: Array<{ foto_principal_url: unknown }> }>)[0]
            .unidades[0].foto_principal_url,
      ],
    ];

    for (const valor of [ajeno, deOtraUnidad]) {
      await fijarValorEnBd('unidad', c, valor);
      for (const [url, extraer] of consultas()) {
        const r = await request(app.getHttpServer())
          .get(url)
          .set('Authorization', `Bearer ${c.arr}`)
          .expect(OK);
        expect([url, extraer(r.body)]).toEqual([url, null]);
      }
      expect(firmar).not.toHaveBeenCalledWith(valor);
    }

    await subir('unidad', c, Buffer.from('foto propia')).expect(OK);
    const propia = (await valorEnBd('unidad', c)) ?? '';
    for (const [url, extraer] of consultas()) {
      const r = await request(app.getHttpServer())
        .get(url)
        .set('Authorization', `Bearer ${c.arr}`)
        .expect(OK);
      expect([url, extraer(r.body)]).toEqual([
        url,
        expect.stringMatching(URL_FIRMADA) as string,
      ]);
    }
    expect(firmar).toHaveBeenCalledWith(propia);
  }, 120000);

  // ------------------------------------------------------------------
  // Los DTOs de entrada nunca aceptan rutas ni URLs de estos campos
  // ------------------------------------------------------------------
  it('ningún DTO de entrada declara foto_principal_url, foto_cedula_url ni foto_cedula_nit_url', async () => {
    const raiz = join(__dirname, '..', 'src');
    const archivos: string[] = [];
    const explorar = (dir: string): void => {
      for (const entrada of readdirSync(dir, { withFileTypes: true })) {
        const completa = join(dir, entrada.name);
        if (entrada.isDirectory()) explorar(completa);
        else if (entrada.name.endsWith('.dto.ts')) archivos.push(completa);
      }
    };
    explorar(raiz);
    expect(archivos.length).toBeGreaterThan(10);

    const intruso = {
      foto_principal_url: 'contratos/otro/contrato.pdf',
      foto_cedula_url: 'https://externo.example/x.jpg',
      foto_cedula_nit_url: 'data:image/png;base64,AAAA',
    };
    let clasesRevisadas = 0;
    let clasesDeEntrada = 0;
    for (const archivo of archivos) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const modulo = require(archivo) as Record<string, unknown>;
      for (const valor of Object.values(modulo)) {
        if (typeof valor !== 'function' || !/^class[\s{]/.test(String(valor))) {
          continue;
        }
        clasesRevisadas += 1;
        const instancia = plainToInstance(valor as new () => object, intruso);
        const errores = await validate(instancia, {
          whitelist: true,
          forbidNonWhitelisted: true,
        });
        // DTOs de respuesta (solo Swagger, sin validadores): no reciben entrada.
        if (errores.some((e) => e.constraints?.unknownValue !== undefined)) {
          continue;
        }
        clasesDeEntrada += 1;
        const conRestriccionDePropiedad = new Set(
          errores
            .filter((e) => e.constraints?.whitelistValidation !== undefined)
            .map((e) => e.property),
        );
        expect([
          archivo.split(/[\\/]/).pop(),
          [...conRestriccionDePropiedad].sort(),
        ]).toEqual([archivo.split(/[\\/]/).pop(), Object.keys(intruso).sort()]);
      }
    }
    expect(clasesRevisadas).toBeGreaterThan(10);
    expect(clasesDeEntrada).toBeGreaterThan(10);
  });
});
