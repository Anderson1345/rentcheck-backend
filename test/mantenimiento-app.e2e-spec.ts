// B0.6-A4 (mantenimiento para la app): `unidad.id` en el portal del inquilino (B-66), `adjunto_tipo`
// en toda solicitud (B-68) y los esquemas de respuesta de OpenAPI (B-67 y la parte documental de B-70).
import { HttpStatus, INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/configurar-app';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  archivoDePrueba,
  MIMETYPE_DE_PRUEBA,
  TipoArchivoPrueba,
} from './helpers/archivos.helper';
import {
  autenticarInquilino,
  crearContrato,
  crearInmueble,
  crearInquilino,
  registrarArrendador,
} from './helpers/crear-datos.helper';
import { limpiarBd } from './helpers/limpiar-bd';

type TipoAdjunto = 'IMAGEN' | 'VIDEO' | null;

interface Solicitud {
  id: string;
  unidad_id: string;
  estado: string;
  adjunto_url: string | null;
  adjunto_tipo: TipoAdjunto;
  [clave: string]: unknown;
}

interface ContratoLista {
  id: string;
  unidad: { id: string; nombre: string; tipo: string };
  [clave: string]: unknown;
}

const URL_FIRMADA = /^https:\/\/.*\.supabase\.co\/storage\/v1\/object\/sign\//;
const LARGO = 180_000;

describe('Mantenimiento para la app (B0.6-A4, e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

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
  }, LARGO);

  afterAll(async () => {
    await app.close();
    await limpiarBd(prisma);
    await prisma.$disconnect();
  });

  let arrendadorToken: string;
  let inquilinoToken: string;
  let otroInquilinoToken: string;
  let contratoId: string;
  let unidadId: string;
  let arrendadorId: string;
  let inquilinoId: string;

  beforeAll(async () => {
    const arrendador = await registrarArrendador(
      app,
      'Arrendador B0.6-A4',
      'a4-arrendador@correo.com',
    );
    arrendadorToken = arrendador.access_token;
    const inmueble = await crearInmueble(app, arrendadorToken);
    const ficha = await crearInquilino(app, arrendadorToken);
    const contrato = await crearContrato(
      app,
      arrendadorToken,
      inmueble.unidades[0].id,
      ficha.id,
    );
    contratoId = contrato.id;
    unidadId = inmueble.unidades[0].id;
    inquilinoToken = await autenticarInquilino(
      app,
      contrato.codigo_acceso?.codigo ?? '',
      'a4-inquilino@correo.com',
    );

    // Otro inquilino con su propio contrato: no debe ver nada del primero.
    const inmueble2 = await crearInmueble(app, arrendadorToken, 'A4-OTRO');
    const ficha2 = await crearInquilino(app, arrendadorToken);
    const contrato2 = await crearContrato(
      app,
      arrendadorToken,
      inmueble2.unidades[0].id,
      ficha2.id,
    );
    otroInquilinoToken = await autenticarInquilino(
      app,
      contrato2.codigo_acceso?.codigo ?? '',
      'a4-inquilino-2@correo.com',
    );

    const enBd = await prisma.contrato.findUniqueOrThrow({
      where: { id: contratoId },
      select: { inquilino_id: true, arrendador_id: true },
    });
    inquilinoId = enBd.inquilino_id;
    arrendadorId = enBd.arrendador_id;
  }, LARGO);

  const get = (token: string, ruta: string) =>
    request(app.getHttpServer())
      .get(ruta)
      .set('Authorization', `Bearer ${token}`);

  function crearSolicitud(
    adjunto?: {
      tipo: TipoArchivoPrueba;
      nombre: string;
      mimetype?: string;
      texto?: string;
    },
    opciones: { clave?: string; unidad?: string } = {},
  ) {
    const peticion = request(app.getHttpServer())
      .post('/solicitudes-mantenimiento')
      .set('Authorization', `Bearer ${inquilinoToken}`)
      .field('unidadId', opciones.unidad ?? unidadId)
      .field('descripcion', 'La llave del lavamanos gotea.')
      .field('urgencia', 'MEDIO');
    if (opciones.clave) peticion.set('Idempotency-Key', opciones.clave);
    if (adjunto) {
      peticion.attach(
        'adjunto',
        archivoDePrueba(adjunto.tipo, adjunto.texto ?? adjunto.nombre),
        {
          filename: adjunto.nombre,
          contentType: adjunto.mimetype ?? MIMETYPE_DE_PRUEBA[adjunto.tipo],
        },
      );
    }
    return peticion;
  }

  async function crearYLeer(
    adjunto?: Parameters<typeof crearSolicitud>[0],
  ): Promise<Solicitud> {
    const respuesta = await crearSolicitud(adjunto).expect(HttpStatus.CREATED);
    return respuesta.body as Solicitud;
  }

  describe('B-66: unidad.id para el inquilino', () => {
    it('GET /inquilino/contratos trae unidad.id (la unidad real del contrato) sin quitar nada', async () => {
      const respuesta = await get(
        inquilinoToken,
        '/inquilino/contratos',
      ).expect(HttpStatus.OK);
      const lista = respuesta.body as ContratoLista[];
      expect(lista).toHaveLength(1);
      expect(lista[0].id).toBe(contratoId);
      expect(lista[0].unidad.id).toBe(unidadId);
      expect(lista[0].unidad).toEqual({
        id: unidadId,
        nombre: expect.any(String) as string,
        tipo: expect.any(String) as string,
      });
      expect(lista[0].inmueble).toHaveProperty('direccion');
      expect(lista[0].inmueble).toHaveProperty('ciudad');
    });

    it('GET /inquilino/contratos/:id trae unidad.id y conserva sus campos', async () => {
      const respuesta = await get(
        inquilinoToken,
        `/inquilino/contratos/${contratoId}`,
      ).expect(HttpStatus.OK);
      const cuerpo = respuesta.body as Record<string, unknown>;
      expect(cuerpo.unidad).toEqual({ id: unidadId });
      for (const campo of [
        'contratoId',
        'estado',
        'canon_centavos',
        'dia_pago',
        'fecha_inicio',
        'fecha_fin',
        'documentos',
        'incrementos_ipc',
        'terminacion_anticipada',
        'aviso_no_renovacion',
        'fotos_entrega',
        'fotos_devolucion',
      ]) {
        expect(cuerpo).toHaveProperty(campo);
      }
    });

    it('el panel y el estado de cuenta no cambian (no llevan unidad)', async () => {
      const panel = await get(
        inquilinoToken,
        `/inquilino/contratos/${contratoId}/panel`,
      ).expect(HttpStatus.OK);
      expect(panel.body).not.toHaveProperty('unidad');
      const cuenta = await get(
        inquilinoToken,
        `/inquilino/contratos/${contratoId}/estado-cuenta`,
      ).expect(HttpStatus.OK);
      expect(cuenta.body).not.toHaveProperty('unidad');
    });

    it('el id de la lista sirve para crear la solicitud', async () => {
      const lista = (
        await get(inquilinoToken, '/inquilino/contratos').expect(HttpStatus.OK)
      ).body as ContratoLista[];
      const respuesta = await crearSolicitud(undefined, {
        unidad: lista[0].unidad.id,
      }).expect(HttpStatus.CREATED);
      expect((respuesta.body as Solicitud).unidad_id).toBe(unidadId);
    });

    it('el aislamiento no cambia: contrato ajeno 404 y la lista de otra persona no trae mi unidad', async () => {
      await get(
        otroInquilinoToken,
        `/inquilino/contratos/${contratoId}`,
      ).expect(HttpStatus.NOT_FOUND);
      const lista = (
        await get(otroInquilinoToken, '/inquilino/contratos').expect(
          HttpStatus.OK,
        )
      ).body as ContratoLista[];
      expect(lista.map((c) => c.id)).not.toContain(contratoId);
      expect(lista.map((c) => c.unidad.id)).not.toContain(unidadId);
      await get(inquilinoToken, '/inquilino/contratos').expect(HttpStatus.OK);
    });
  });

  describe('B-68: adjunto_tipo en cada respuesta de mantenimiento', () => {
    it(
      'imagen JPEG y PNG: IMAGEN; video MP4: VIDEO; sin adjunto: null (respuesta 201)',
      async () => {
        const jpeg = await crearYLeer({ tipo: 'jpeg', nombre: 'a.jpg' });
        const png = await crearYLeer({ tipo: 'png', nombre: 'b.png' });
        const video = await crearYLeer({ tipo: 'mp4', nombre: 'c.mp4' });
        const sin = await crearYLeer();
        expect(jpeg.adjunto_tipo).toBe('IMAGEN');
        expect(jpeg.adjunto_url).toMatch(URL_FIRMADA);
        expect(png.adjunto_tipo).toBe('IMAGEN');
        expect(video.adjunto_tipo).toBe('VIDEO');
        expect(video.adjunto_url).toMatch(URL_FIRMADA);
        expect(sin.adjunto_tipo).toBeNull();
        expect(sin.adjunto_url).toBeNull();
        for (const s of [jpeg, png, video, sin]) {
          expect(s).not.toHaveProperty('adjunto_ruta');
        }
      },
      LARGO,
    );

    it(
      'la repetición idempotente devuelve el mismo adjunto_tipo',
      async () => {
        const clave = `a4-idem-${Date.now()}-video-0123456789`;
        const adjunto = {
          tipo: 'mp4' as const,
          nombre: 'idem.mp4',
          texto: 'idem',
        };
        const primera = await crearSolicitud(adjunto, { clave }).expect(
          HttpStatus.CREATED,
        );
        const segunda = await crearSolicitud(adjunto, { clave }).expect(
          HttpStatus.CREATED,
        );
        expect(segunda.headers['idempotent-replayed']).toBe('true');
        expect((segunda.body as Solicitud).id).toBe(
          (primera.body as Solicitud).id,
        );
        expect((primera.body as Solicitud).adjunto_tipo).toBe('VIDEO');
        expect((segunda.body as Solicitud).adjunto_tipo).toBe('VIDEO');
      },
      LARGO,
    );

    it(
      'lista y detalle del inquilino, lista y detalle del arrendador y PATCH de estado traen adjunto_tipo',
      async () => {
        const video = await crearYLeer({ tipo: 'mp4', nombre: 'lista.mp4' });
        const imagen = await crearYLeer({ tipo: 'jpeg', nombre: 'lista.jpg' });
        const sin = await crearYLeer();
        const esperado = new Map<string, TipoAdjunto>([
          [video.id, 'VIDEO'],
          [imagen.id, 'IMAGEN'],
          [sin.id, null],
        ]);
        const verificar = (lista: Solicitud[]) => {
          for (const [id, tipo] of esperado) {
            const s = lista.find((x) => x.id === id);
            expect(s).toBeDefined();
            expect(s?.adjunto_tipo).toBe(tipo);
          }
        };

        const delInquilino = (
          await get(
            inquilinoToken,
            `/inquilino/solicitudes?contratoId=${contratoId}`,
          ).expect(HttpStatus.OK)
        ).body as Solicitud[];
        verificar(delInquilino);
        const delArrendador = (
          await get(arrendadorToken, '/solicitudes-mantenimiento').expect(
            HttpStatus.OK,
          )
        ).body as Solicitud[];
        verificar(delArrendador);

        for (const [id, tipo] of esperado) {
          const a = await get(
            inquilinoToken,
            `/inquilino/solicitudes/${id}`,
          ).expect(HttpStatus.OK);
          expect((a.body as Solicitud).adjunto_tipo).toBe(tipo);
          const b = await get(
            arrendadorToken,
            `/solicitudes-mantenimiento/${id}`,
          ).expect(HttpStatus.OK);
          expect((b.body as Solicitud).adjunto_tipo).toBe(tipo);
        }

        const cambio = await request(app.getHttpServer())
          .patch(`/solicitudes-mantenimiento/${video.id}/estado`)
          .set('Authorization', `Bearer ${arrendadorToken}`)
          .send({ estado: 'EN_PROCESO' })
          .expect(HttpStatus.OK);
        expect((cambio.body as Solicitud).estado).toBe('EN_PROCESO');
        expect((cambio.body as Solicitud).adjunto_tipo).toBe('VIDEO');
      },
      LARGO,
    );

    it(
      'un adjunto viejo se clasifica por la extensión de su ruta; sin extensión o con otra, null',
      async () => {
        const crearViejo = (ruta: string | null) =>
          prisma.solicitudMantenimiento.create({
            data: {
              arrendador_id: arrendadorId,
              unidad_id: unidadId,
              inquilino_id: inquilinoId,
              descripcion: `Solicitud antigua ${ruta ?? 'sin adjunto'}`,
              adjunto_ruta: ruta,
              urgencia: 'BAJO',
            },
          });
        const casos: [string | null, TipoAdjunto][] = [
          ['solicitudes-mantenimiento/viejo/1-foto.jpg', 'IMAGEN'],
          ['solicitudes-mantenimiento/viejo/2-foto.PNG', 'IMAGEN'],
          ['solicitudes-mantenimiento/viejo/3-clip.mp4', 'VIDEO'],
          ['solicitudes-mantenimiento/viejo/4-sinextension', null],
          ['solicitudes-mantenimiento/viejo/5-clip.mov', null],
          [null, null],
        ];
        for (const [ruta, tipo] of casos) {
          const fila = await crearViejo(ruta);
          const delInquilino = await get(
            inquilinoToken,
            `/inquilino/solicitudes/${fila.id}`,
          ).expect(HttpStatus.OK);
          const delArrendador = await get(
            arrendadorToken,
            `/solicitudes-mantenimiento/${fila.id}`,
          ).expect(HttpStatus.OK);
          expect((delInquilino.body as Solicitud).adjunto_tipo).toBe(tipo);
          expect((delArrendador.body as Solicitud).adjunto_tipo).toBe(tipo);
          expect(delInquilino.body).not.toHaveProperty('adjunto_ruta');
        }
      },
      LARGO,
    );

    it(
      'el nombre del cliente no manda: un MP4 llamado foto.jpg se guarda .mp4 y un JPG llamado video.mp4 se guarda .jpg',
      async () => {
        const mp4 = await crearYLeer({
          tipo: 'mp4',
          nombre: 'foto.jpg',
          mimetype: 'video/mp4',
        });
        const jpg = await crearYLeer({
          tipo: 'jpeg',
          nombre: 'video.mp4',
          mimetype: 'image/jpeg',
        });
        const rutaMp4 = (
          await prisma.solicitudMantenimiento.findUniqueOrThrow({
            where: { id: mp4.id },
          })
        ).adjunto_ruta;
        const rutaJpg = (
          await prisma.solicitudMantenimiento.findUniqueOrThrow({
            where: { id: jpg.id },
          })
        ).adjunto_ruta;
        expect(rutaMp4).toMatch(/\.mp4$/);
        expect(rutaJpg).toMatch(/\.jpg$/);
        expect(mp4.adjunto_tipo).toBe('VIDEO');
        expect(jpg.adjunto_tipo).toBe('IMAGEN');
      },
      LARGO,
    );

    it('un MP4 declarado como imagen (contenido distinto al declarado) sigue dando 415', async () => {
      await crearSolicitud({
        tipo: 'mp4',
        nombre: 'engano.jpg',
        mimetype: 'image/jpeg',
      }).expect(HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    });
  });

  describe('B-67 y B-70 (parte documental): OpenAPI describe las respuestas', () => {
    interface Esquema {
      $ref?: string;
      type?: string;
      nullable?: boolean;
      enum?: string[];
      description?: string;
      allOf?: { $ref?: string }[];
      items?: { $ref?: string };
      properties?: Record<string, Esquema>;
    }
    interface Operacion {
      description?: string;
      requestBody?: {
        content: Record<string, { schema?: Esquema }>;
      };
      responses: Record<
        string,
        {
          description?: string;
          content?: Record<string, { schema?: Esquema }>;
        }
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

    const esquemaDe = (ruta: string, metodo: string, estado: string) =>
      documento.paths[ruta][metodo].responses[estado].content?.[
        'application/json'
      ]?.schema;
    const ref = (nombre: string) => `#/components/schemas/${nombre}`;
    // Una propiedad con enum con nombre sale como $ref o, envuelta, dentro de allOf.
    const refDe = (esquema: Esquema) =>
      esquema.$ref ?? esquema.allOf?.[0]?.$ref;

    it('POST /solicitudes-mantenimiento devuelve SolicitudCreadaDto y documenta 400, 404, 409, 413, 415 y 422', () => {
      expect(esquemaDe('/solicitudes-mantenimiento', 'post', '201')?.$ref).toBe(
        ref('SolicitudCreadaDto'),
      );
      const respuestas = Object.keys(
        documento.paths['/solicitudes-mantenimiento'].post.responses,
      );
      for (const codigo of ['400', '404', '409', '413', '415', '422']) {
        expect(respuestas).toContain(codigo);
      }
      const descripciones = JSON.stringify(
        documento.paths['/solicitudes-mantenimiento'].post.responses,
      );
      for (const codigo of [
        'CONTRATO_NO_ACTIVO',
        'SOLICITUD_EN_PROCESO',
        'CARGA_DEMASIADO_GRANDE',
        'ARCHIVO_CONTENIDO_INVALIDO',
        'IDEMPOTENCY_KEY_REUTILIZADA',
      ]) {
        expect(descripciones).toContain(codigo);
      }
    });

    it('el adjunto documenta un solo archivo, JPEG, PNG o MP4 y el máximo (20 MB, de las constantes)', () => {
      const cuerpo =
        documento.paths['/solicitudes-mantenimiento'].post.requestBody?.content[
          'multipart/form-data'
        ]?.schema;
      const adjunto = cuerpo?.properties?.adjunto;
      expect(adjunto?.description).toMatch(/20 MB/);
      expect(adjunto?.description).toMatch(/JPEG/);
      expect(adjunto?.description).toMatch(/PNG/);
      expect(adjunto?.description).toMatch(/MP4/);
      expect(adjunto?.description).toMatch(/un solo archivo/i);
    });

    it('los GET del inquilino devuelven SolicitudInquilinoDto (lista y detalle)', () => {
      const lista = esquemaDe('/inquilino/solicitudes', 'get', '200');
      expect(lista?.type).toBe('array');
      expect(lista?.items?.$ref).toBe(ref('SolicitudInquilinoDto'));
      expect(esquemaDe('/inquilino/solicitudes/{id}', 'get', '200')?.$ref).toBe(
        ref('SolicitudInquilinoDto'),
      );
    });

    it('los GET y el PATCH del arrendador devuelven SolicitudArrendadorDto', () => {
      const lista = esquemaDe('/solicitudes-mantenimiento', 'get', '200');
      expect(lista?.type).toBe('array');
      expect(lista?.items?.$ref).toBe(ref('SolicitudArrendadorDto'));
      expect(
        esquemaDe('/solicitudes-mantenimiento/{id}', 'get', '200')?.$ref,
      ).toBe(ref('SolicitudArrendadorDto'));
      expect(
        esquemaDe('/solicitudes-mantenimiento/{id}/estado', 'patch', '200')
          ?.$ref,
      ).toBe(ref('SolicitudArrendadorDto'));
    });

    it('PATCH /estado documenta 409 TRANSICION_INVALIDA y las transiciones permitidas', () => {
      const operacion =
        documento.paths['/solicitudes-mantenimiento/{id}/estado'].patch;
      expect(Object.keys(operacion.responses)).toContain('409');
      const texto = JSON.stringify(operacion);
      expect(texto).toContain('TRANSICION_INVALIDA');
      expect(texto).toMatch(/PENDIENTE/);
      expect(texto).toMatch(/EN_PROCESO/);
      expect(texto).toMatch(/RESUELTO/);
    });

    it('los esquemas describen los campos reales, con enums con nombre y adjunto_tipo anulable', () => {
      const escalares = [
        'id',
        'arrendador_id',
        'unidad_id',
        'inquilino_id',
        'descripcion',
        'urgencia',
        'estado',
        'creado_en',
        'actualizado_en',
        'adjunto_url',
        'adjunto_tipo',
      ];
      for (const nombre of [
        'SolicitudCreadaDto',
        'SolicitudInquilinoDto',
        'SolicitudArrendadorDto',
      ]) {
        const propiedades = Object.keys(
          documento.components.schemas[nombre].properties ?? {},
        );
        for (const campo of escalares) expect(propiedades).toContain(campo);
        expect(propiedades).not.toContain('adjunto_ruta');
      }
      const arrendador = documento.components.schemas.SolicitudArrendadorDto;
      expect(Object.keys(arrendador.properties ?? {})).toEqual(
        expect.arrayContaining(['unidad', 'inquilino']),
      );
      const propiedades = documento.components.schemas.SolicitudCreadaDto
        .properties as Record<string, Esquema>;
      // Enum con nombre (TipoAdjunto), anulable: Swagger lo envuelve en allOf.
      expect(refDe(propiedades.adjunto_tipo)).toBe(ref('TipoAdjunto'));
      expect(documento.components.schemas.TipoAdjunto.enum).toEqual([
        'IMAGEN',
        'VIDEO',
      ]);
      expect(propiedades.adjunto_tipo.nullable).toBe(true);
      expect(propiedades.adjunto_url.nullable).toBe(true);
      // Enums con nombre (un solo esquema reutilizado, no uno por clase).
      expect(refDe(propiedades.urgencia)).toBe(ref('UrgenciaMantenimiento'));
      expect(refDe(propiedades.estado)).toBe(
        ref('EstadoSolicitudMantenimiento'),
      );
      expect(documento.components.schemas.UrgenciaMantenimiento.enum).toEqual([
        'BAJO',
        'MEDIO',
        'ALTO',
      ]);
      expect(
        documento.components.schemas.EstadoSolicitudMantenimiento.enum,
      ).toEqual(['PENDIENTE', 'EN_PROCESO', 'RESUELTO']);
    });

    it('el bloque unidad y el inquilino del arrendador traen los campos que hoy devuelve el servicio', () => {
      const dtos = documento.components.schemas;
      const solicitud = dtos.SolicitudArrendadorDto.properties as Record<
        string,
        Esquema
      >;
      const nombreUnidad = solicitud.unidad.$ref?.split('/').pop() ?? '';
      const nombreInquilino = solicitud.inquilino.$ref?.split('/').pop() ?? '';
      const unidad = dtos[nombreUnidad].properties as Record<string, Esquema>;
      for (const campo of [
        'id',
        'inmueble_id',
        'nombre',
        'tipo',
        'metros_cuadrados',
        'numero_habitaciones',
        'numero_banos',
        'canon_base_centavos',
        'ocupantes_maximos',
        'acepta_mascotas',
        'uso_permitido',
        'foto_principal_url',
        'creado_en',
        'inmueble',
      ]) {
        expect(Object.keys(unidad)).toContain(campo);
      }
      expect(unidad.foto_principal_url.nullable).toBe(true);
      const nombreInmueble = unidad.inmueble.$ref?.split('/').pop() ?? '';
      expect(Object.keys(dtos[nombreInmueble].properties ?? {})).toEqual(
        expect.arrayContaining([
          'id',
          'direccion',
          'ciudad',
          'estrato',
          'matricula_inmobiliaria',
          'creado_en',
        ]),
      );
      const inquilino = dtos[nombreInquilino].properties as Record<
        string,
        Esquema
      >;
      expect(Object.keys(inquilino)).toEqual(
        expect.arrayContaining(['id', 'nombre', 'cedula', 'telefono']),
      );
      for (const campo of ['nombre', 'cedula', 'telefono']) {
        expect(inquilino[campo].nullable).toBe(true);
      }
    });
  });
});
