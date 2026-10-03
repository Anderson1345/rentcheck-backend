// B0.7-C (B-86): datos de las listas rediseñadas. `estado_pago` (el guardado) en GET /contratos y en el
// detalle, y la foto de cada unidad (`foto_principal_url`, URL firmada) en GET /inmuebles y su detalle.
// Las dos cosas ya las entregaba el servidor; estas pruebas las fijan y comprueban que GET /contratos
// quedó documentado en OpenAPI con las MISMAS claves que responde. El cron de mora se corre con un día
// simulado (15/03/2031): nada depende de la fecha de hoy.
import { HttpStatus, INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test, TestingModule } from '@nestjs/testing';
import {
  EstadoContrato,
  EstadoPago,
  EstadoPagoContrato,
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
import { archivoDePrueba } from './helpers/archivos.helper';
import { registrarArrendador } from './helpers/crear-datos.helper';
import { limpiarBd } from './helpers/limpiar-bd';

jest.setTimeout(120_000);

const { OK, NOT_FOUND } = HttpStatus;
const AHORA = new Date('2031-03-15T17:00:00.000Z');
const MILLON = 1_000_000;
const URL_FIRMADA = /^https:\/\/.*\.supabase\.co\/storage\/v1\/object\/sign\//;
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

interface ContratoListaApi {
  id: string;
  estado: string;
  estado_pago: string;
  unidad: { id: string; nombre: string; tipo: string };
}
interface UnidadApi {
  id: string;
  nombre: string;
  foto_principal_url: string | null;
}
interface InmuebleApi {
  id: string;
  unidades: UnidadApi[];
}

describe('Listas rediseñadas: estado_pago y foto de la unidad (e2e, B0.7-C)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokenA: string;
  let tokenB: string;
  let idA: string;
  let idB: string;
  let contador = 0;

  const get = (ruta: string, token: string) =>
    request(app.getHttpServer())
      .get(ruta)
      .set('Authorization', `Bearer ${token}`);

  async function inmuebleCon(arrendadorId: string, unidades: string[]) {
    contador += 1;
    const inmueble = await prisma.inmueble.create({
      data: {
        arrendador_id: arrendadorId,
        direccion: `Calle Listas ${contador}`,
        ciudad: 'Bogotá',
        estrato: 3,
        matricula_inmobiliaria: `M-LISTAS-${contador}`,
        unidades: {
          create: unidades.map((nombre) => ({
            nombre,
            tipo: TipoUnidad.APARTAMENTO,
            canon_base_centavos: MILLON,
            acepta_mascotas: false,
            uso_permitido: UsoPermitido.RESIDENCIAL,
          })),
        },
      },
      select: { id: true, unidades: { select: { id: true, nombre: true } } },
    });
    return inmueble;
  }

  async function contrato(
    arrendadorId: string,
    unidadId: string,
    estado: EstadoContrato,
    inicio: string,
    fin: string,
  ): Promise<string> {
    contador += 1;
    const inquilino = await prisma.inquilino.create({
      data: {
        nombre: 'Persona Prueba',
        cedula: String(5_000_000_000 + contador),
        telefono: '3001112233',
      },
      select: { id: true },
    });
    return (
      await prisma.contrato.create({
        data: {
          arrendador_id: arrendadorId,
          unidad_id: unidadId,
          inquilino_id: inquilino.id,
          inquilino_nombre: 'Persona Prueba',
          inquilino_cedula: '1020304050',
          inquilino_telefono: '3001112233',
          tipo_plantilla: TipoPlantillaContrato.VIVIENDA_URBANA_LEY_820,
          canon_centavos: MILLON,
          dia_pago: 5,
          forma_pago: 'Transferencia',
          datos_recaudo: 'Cuenta de prueba',
          fecha_inicio: d(inicio),
          fecha_fin: d(fin),
          estado,
        },
        select: { id: true },
      })
    ).id;
  }

  async function pagar(arrendadorId: string, contratoId: string, mes: string) {
    await prisma.pago.create({
      data: {
        arrendador_id: arrendadorId,
        contrato_id: contratoId,
        monto_centavos: MILLON,
        fecha_reportada: d(`${mes}-03`),
        periodo: d(`${mes}-01`),
        estado: EstadoPago.APROBADO,
      },
    });
  }

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

    const a = await registrarArrendador(app, 'Listas A', 'listas-a@correo.com');
    const b = await registrarArrendador(app, 'Listas B', 'listas-b@correo.com');
    tokenA = a.access_token;
    tokenB = b.access_token;
    idA = a.arrendador.id;
    idB = b.arrendador.id;
  });

  afterAll(async () => {
    await limpiarBd(prisma);
    await app.close();
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------------------------------------
  describe('estado_pago en GET /contratos y en el detalle', () => {
    let ids: { alDia: string; enMora: string; cerrado: string; deB: string };

    beforeAll(async () => {
      const inmueble = await inmuebleCon(idA, ['Al día', 'En mora', 'Cerrado']);
      const [u1, u2, u3] = inmueble.unidades.map((u) => u.id);
      const alDia = await contrato(
        idA,
        u1,
        EstadoContrato.ACTIVO,
        '2031-01-01',
        '2031-12-31',
      );
      for (const mes of ['2031-01', '2031-02', '2031-03']) {
        await pagar(idA, alDia, mes);
      }
      // Enero pagado; febrero y marzo vencidos.
      const enMora = await contrato(
        idA,
        u2,
        EstadoContrato.ACTIVO,
        '2031-01-01',
        '2031-12-31',
      );
      await pagar(idA, enMora, '2031-01');
      // Terminó en enero sin pagar diciembre ni enero: cerrado con deuda.
      const cerrado = await contrato(
        idA,
        u3,
        EstadoContrato.VENCIDO,
        '2030-10-01',
        '2031-01-31',
      );
      for (const mes of ['2030-10', '2030-11']) {
        await pagar(idA, cerrado, mes);
      }
      const inmuebleB = await inmuebleCon(idB, ['De B']);
      const deB = await contrato(
        idB,
        inmuebleB.unidades[0].id,
        EstadoContrato.ACTIVO,
        '2031-01-01',
        '2031-12-31',
      );

      // El estado guardado lo recalcula la corrida diaria (también el de los cerrados, B-77).
      const scheduler = app.get(AlertaSchedulerService, { strict: false });
      await scheduler.ejecutarInquilinoEnMora(AHORA);
      ids = { alDia, enMora, cerrado, deB };
    });

    it('cada elemento de la lista trae el estado_pago guardado: al día, en mora y cerrado con deuda', async () => {
      const lista = (await get('/contratos', tokenA).expect(OK))
        .body as ContratoListaApi[];
      const de = (id: string) => lista.find((c) => c.id === id);
      expect(de(ids.alDia)?.estado_pago).toBe(EstadoPagoContrato.AL_DIA);
      expect(de(ids.enMora)?.estado_pago).toBe(EstadoPagoContrato.EN_MORA);
      expect(de(ids.cerrado)).toMatchObject({
        estado: EstadoContrato.VENCIDO,
        estado_pago: EstadoPagoContrato.EN_MORA,
      });
      // Es el valor guardado (no se recalcula en la petición).
      const guardados = await prisma.contrato.findMany({
        where: { arrendador_id: idA },
        select: { id: true, estado_pago: true },
      });
      for (const g of guardados) {
        expect(de(g.id)?.estado_pago).toBe(g.estado_pago);
      }
    });

    it('el detalle trae el mismo estado_pago', async () => {
      for (const [id, esperado] of [
        [ids.alDia, EstadoPagoContrato.AL_DIA],
        [ids.enMora, EstadoPagoContrato.EN_MORA],
        [ids.cerrado, EstadoPagoContrato.EN_MORA],
      ] as const) {
        const detalle = (await get(`/contratos/${id}`, tokenA).expect(OK))
          .body as { estado_pago: string };
        expect(detalle.estado_pago).toBe(esperado);
      }
    });

    it('aislamiento: la lista de A no trae el contrato de B y su detalle es 404', async () => {
      const lista = (await get('/contratos', tokenA).expect(OK))
        .body as ContratoListaApi[];
      expect(lista.map((c) => c.id)).not.toContain(ids.deB);
      await get(`/contratos/${ids.deB}`, tokenA).expect(NOT_FOUND);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('foto de la unidad en GET /inmuebles y en el detalle', () => {
    it('con foto: URL firmada que descarga la misma imagen; sin foto: null; lo ajeno es 404', async () => {
      const inmueble = await inmuebleCon(idA, ['Con foto', 'Sin foto']);
      const conFoto = inmueble.unidades.find((u) => u.nombre === 'Con foto')!;
      const sinFoto = inmueble.unidades.find((u) => u.nombre === 'Sin foto')!;
      const imagen = archivoDePrueba('jpeg', 'foto de la unidad B0.7-C');
      await request(app.getHttpServer())
        .post(`/inmuebles/${inmueble.id}/unidades/${conFoto.id}/foto-principal`)
        .set('Authorization', `Bearer ${tokenA}`)
        .attach('foto', imagen, {
          filename: 'unidad.jpg',
          contentType: 'image/jpeg',
        })
        .expect(OK);

      const detalle = (
        await get(`/inmuebles/${inmueble.id}`, tokenA).expect(OK)
      ).body as InmuebleApi;
      const lista = (await get('/inmuebles', tokenA).expect(OK))
        .body as InmuebleApi[];
      const enLista = lista.find((i) => i.id === inmueble.id)!;
      for (const unidades of [detalle.unidades, enLista.unidades]) {
        const con = unidades.find((u) => u.id === conFoto.id)!;
        const sin = unidades.find((u) => u.id === sinFoto.id)!;
        expect(con.foto_principal_url).toMatch(URL_FIRMADA);
        expect(sin.foto_principal_url).toBeNull();
      }

      // Descargable, como la portada del inmueble: la URL firmada entrega los mismos bytes.
      const url = detalle.unidades.find((u) => u.id === conFoto.id)!
        .foto_principal_url as string;
      const respuesta = await fetch(url);
      expect(respuesta.status).toBe(200);
      expect(Buffer.from(await respuesta.arrayBuffer()).equals(imagen)).toBe(
        true,
      );

      // B no ve el inmueble de A.
      await get(`/inmuebles/${inmueble.id}`, tokenB).expect(NOT_FOUND);
      const listaB = (await get('/inmuebles', tokenB).expect(OK))
        .body as InmuebleApi[];
      expect(listaB.map((i) => i.id)).not.toContain(inmueble.id);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('OpenAPI de GET /contratos', () => {
    interface Esquema {
      $ref?: string;
      type?: string;
      enum?: string[];
      items?: Esquema;
      properties?: Record<string, Esquema>;
      allOf?: Esquema[];
      nullable?: boolean;
    }
    let esquemas: Record<string, Esquema>;
    let respuesta200: Esquema | undefined;

    beforeAll(() => {
      const documento = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('t').build(),
      ) as unknown as {
        paths: Record<
          string,
          Record<
            string,
            {
              responses: Record<
                string,
                { content?: Record<string, { schema?: Esquema }> }
              >;
            }
          >
        >;
        components: { schemas: Record<string, Esquema> };
      };
      esquemas = documento.components.schemas;
      respuesta200 =
        documento.paths['/contratos'].get.responses['200'].content?.[
          'application/json'
        ]?.schema;
    });

    it('responde un arreglo de ContratoListaDto con estado_pago (enum EstadoPagoContrato)', () => {
      expect(respuesta200).toEqual({
        type: 'array',
        items: { $ref: '#/components/schemas/ContratoListaDto' },
      });
      // Con `example`, Swagger envuelve la referencia en `allOf`.
      const estadoPago = esquemas.ContratoListaDto.properties?.estado_pago;
      expect(estadoPago?.$ref ?? estadoPago?.allOf?.[0]?.$ref).toBe(
        '#/components/schemas/EstadoPagoContrato',
      );
      expect(esquemas.EstadoPagoContrato.enum).toEqual(
        Object.values(EstadoPagoContrato),
      );
    });

    it('el esquema documenta exactamente las claves que responde la API (sin inventar ni omitir)', async () => {
      const lista = (await get('/contratos', tokenA).expect(OK)).body as Array<
        Record<string, unknown>
      >;
      const elemento = lista[0];
      const propiedades = esquemas.ContratoListaDto.properties ?? {};
      expect(Object.keys(propiedades).sort()).toEqual(
        Object.keys(elemento).sort(),
      );
      const claves = (ref: string | undefined) =>
        Object.keys(
          esquemas[(ref ?? '').split('/').pop() ?? '']?.properties ?? {},
        ).sort();
      const refDe = (p: Esquema | undefined) => p?.$ref ?? p?.allOf?.[0]?.$ref;
      expect(claves(refDe(propiedades.unidad))).toEqual(
        Object.keys(elemento.unidad as object).sort(),
      );
      expect(claves(refDe(propiedades.inquilino))).toEqual(
        Object.keys(elemento.inquilino as object).sort(),
      );
    });
  });
});
