import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/configurar-app';
import { ContratoService } from '../src/contrato/contrato.service';
import { DocumentoContratoService } from '../src/contrato/documento-contrato.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  autenticarInquilino,
  contratoValido,
  crearContrato,
  crearInmueble,
  crearInquilino,
  registrarArrendador,
  reportarPago,
} from './helpers/crear-datos.helper';
import { limpiarBd } from './helpers/limpiar-bd';

interface CuerpoError {
  codigo: string;
  mensaje: string;
}

interface InquilinoVista {
  id: string;
  nombre: string;
  cedula: string;
  telefono: string;
  correo?: string;
}

interface ContratoVista {
  id: string;
  inquilino: InquilinoVista;
  [clave: string]: unknown;
}

const CREADO: number = HttpStatus.CREATED;
const CONFLICTO: number = HttpStatus.CONFLICT;
const NO_ENCONTRADO: number = HttpStatus.NOT_FOUND;
const SOLICITUD_INVALIDA: number = HttpStatus.BAD_REQUEST;

describe('Identidad del inquilino: copia en el contrato e inquilino_nuevo (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let documentos: DocumentoContratoService;
  let contratoService: ContratoService;
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
    documentos = moduleFixture.get(DocumentoContratoService);
    contratoService = moduleFixture.get(ContratoService);
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

  async function arrendador() {
    contador += 1;
    const { access_token } = await registrarArrendador(
      app,
      `Arrendador ${contador}`,
      `ident-${contador}@correo.com`,
    );
    return access_token;
  }

  async function unidadNueva(token: string) {
    contador += 1;
    const inmueble = await crearInmueble(app, token, `IDENT-${contador}`);
    return inmueble.unidades[0].id;
  }

  const cedulaUnica = () => `9${Date.now().toString().slice(-8)}${contador++}`;

  const postContrato = (token: string, cuerpo: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/contratos')
      .set('Authorization', `Bearer ${token}`)
      .send(cuerpo);

  const conInquilinoNuevo = (
    unidadId: string,
    inquilino_nuevo: Record<string, unknown>,
    extra: Record<string, unknown> = {},
  ) => ({
    ...contratoValido(unidadId, 'no-se-usa', extra),
    inquilino_id: undefined,
    inquilino_nuevo,
  });

  const detalle = (token: string, id: string) =>
    request(app.getHttpServer())
      .get(`/contratos/${id}`)
      .set('Authorization', `Bearer ${token}`);

  const codigo = (r: { body: unknown }) => (r.body as CuerpoError).codigo;

  // ------------------------------------------------------------------
  // TEST-FIRST: los lectores del arrendador salen de la copia
  // ------------------------------------------------------------------
  it('detalle, listado, PDF, pagos y mantenimiento del arrendador muestran la copia aunque cambie el perfil global', async () => {
    const token = await arrendador();
    const unidadId = await unidadNueva(token);
    const ficha = await request(app.getHttpServer())
      .post('/inquilinos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: 'Nombre Copia',
        cedula: cedulaUnica(),
        telefono: '3001111111',
      })
      .expect(CREADO);
    const contrato = await crearContrato(
      app,
      token,
      unidadId,
      (ficha.body as { id: string }).id,
    );
    const inquilinoToken = await autenticarInquilino(
      app,
      contrato.codigo_acceso?.codigo ?? '',
      'copia@correo.com',
    );
    await reportarPago(app, inquilinoToken, contrato.id);
    await request(app.getHttpServer())
      .post('/solicitudes-mantenimiento')
      .set('Authorization', `Bearer ${inquilinoToken}`)
      .field('unidadId', unidadId)
      .field('descripcion', 'Fuga en el baño')
      .field('urgencia', 'ALTO')
      .expect(CREADO);

    // La persona cambia su perfil global (o lo cambia otro arrendador).
    await prisma.inquilino.update({
      where: { id: (ficha.body as { id: string }).id },
      data: { nombre: 'Nombre Global Cambiado', telefono: '3999999999' },
    });

    const vistaDetalle = await detalle(token, contrato.id).expect(
      HttpStatus.OK,
    );
    expect((vistaDetalle.body as ContratoVista).inquilino).toMatchObject({
      nombre: 'Nombre Copia',
      telefono: '3001111111',
    });

    const listado = await request(app.getHttpServer())
      .get('/contratos')
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    expect((listado.body as ContratoVista[])[0].inquilino.nombre).toBe(
      'Nombre Copia',
    );

    const pagos = await request(app.getHttpServer())
      .get('/pagos')
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    expect(
      (pagos.body as Array<{ contrato: { inquilino: InquilinoVista } }>)[0]
        .contrato.inquilino,
    ).toMatchObject({ nombre: 'Nombre Copia', telefono: '3001111111' });

    const mantenimiento = await request(app.getHttpServer())
      .get('/solicitudes-mantenimiento')
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    expect(
      (mantenimiento.body as Array<{ inquilino: InquilinoVista }>)[0].inquilino,
    ).toMatchObject({ nombre: 'Nombre Copia', telefono: '3001111111' });

    // El PDF original regenerado usa la copia.
    await prisma.documentoContrato.deleteMany({
      where: { contrato_id: contrato.id },
    });
    const generarPdf = jest.spyOn(documentos, 'generarPdf');
    await request(app.getHttpServer())
      .post(`/contratos/${contrato.id}/documentos/regenerar`)
      .set('Authorization', `Bearer ${token}`)
      .expect(CREADO);
    const texto = generarPdf.mock.calls[0][0];
    expect(texto).toContain('Nombre Copia');
    expect(texto).not.toContain('Nombre Global Cambiado');
  }, 90000);

  // ------------------------------------------------------------------
  // inquilino_nuevo
  // ------------------------------------------------------------------
  it('(a) inquilino_nuevo con cédula inexistente crea la identidad y el contrato', async () => {
    const token = await arrendador();
    const unidadId = await unidadNueva(token);
    const cedula = cedulaUnica();

    const respuesta = await postContrato(
      token,
      conInquilinoNuevo(unidadId, {
        nombre: 'Persona Nueva',
        cedula: ` ${cedula.slice(0, 3)}.${cedula.slice(3)} `,
        telefono: '3005550000',
      }),
    ).expect(CREADO);

    const cuerpo = respuesta.body as ContratoVista;
    expect(cuerpo.inquilino).toEqual({
      id: expect.any(String) as string,
      nombre: 'Persona Nueva',
      cedula,
      telefono: '3005550000',
    });
    const identidad = await prisma.inquilino.findUniqueOrThrow({
      where: { cedula },
    });
    expect(identidad.arrendador_id).toBeNull();
    expect(identidad.id).toBe(cuerpo.inquilino.id);
    const enBd = await prisma.contrato.findUniqueOrThrow({
      where: { id: cuerpo.id },
    });
    expect(enBd).toMatchObject({
      inquilino_id: identidad.id,
      inquilino_nombre: 'Persona Nueva',
      inquilino_cedula: cedula,
      inquilino_telefono: '3005550000',
    });
  }, 60000);

  it('(b) con cédula existente de otro arrendador reutiliza la identidad sin modificarla y sin filtrar datos', async () => {
    const tokenA = await arrendador();
    const tokenB = await arrendador();
    const cedula = cedulaUnica();
    const uno = (
      await postContrato(
        tokenA,
        conInquilinoNuevo(await unidadNueva(tokenA), {
          nombre: 'Ana Uno',
          cedula,
          telefono: '3001110001',
        }),
      ).expect(CREADO)
    ).body as ContratoVista;
    const dos = (
      await postContrato(
        tokenB,
        conInquilinoNuevo(await unidadNueva(tokenB), {
          nombre: 'Ana Dos',
          cedula,
          telefono: '3001110002',
        }),
      ).expect(CREADO)
    ).body as ContratoVista;

    expect(await prisma.inquilino.count({ where: { cedula } })).toBe(1);
    const identidad = await prisma.inquilino.findUniqueOrThrow({
      where: { cedula },
    });
    expect(identidad).toMatchObject({
      nombre: 'Ana Uno',
      telefono: '3001110001',
    });

    // Misma forma de respuesta en ambos casos.
    expect(Object.keys(dos).sort()).toEqual(Object.keys(uno).sort());
    expect(Object.keys(dos.inquilino).sort()).toEqual(
      Object.keys(uno.inquilino).sort(),
    );
    expect(dos.inquilino).toMatchObject({
      nombre: 'Ana Dos',
      telefono: '3001110002',
    });

    const detalleA = (await detalle(tokenA, uno.id).expect(HttpStatus.OK))
      .body as ContratoVista;
    const detalleB = (await detalle(tokenB, dos.id).expect(HttpStatus.OK))
      .body as ContratoVista;
    expect(detalleA.inquilino.nombre).toBe('Ana Uno');
    expect(detalleB.inquilino.nombre).toBe('Ana Dos');
    expect(detalleB.inquilino.telefono).toBe('3001110002');
    expect(detalleB.inquilino.correo).toBeUndefined();
  }, 90000);

  it('(c) dos POST /contratos simultáneos con la misma cédula nueva: ambos 201 y una sola identidad', async () => {
    const token = await arrendador();
    const cedula = cedulaUnica();
    const unidad1 = await unidadNueva(token);
    const unidad2 = await unidadNueva(token);

    const respuestas = await Promise.all([
      postContrato(
        token,
        conInquilinoNuevo(unidad1, {
          nombre: 'Carrera',
          cedula,
          telefono: '3001',
        }),
      ),
      postContrato(
        token,
        conInquilinoNuevo(unidad2, {
          nombre: 'Carrera',
          cedula,
          telefono: '3001',
        }),
      ),
    ]);

    expect(respuestas.map((r) => r.status)).toEqual([CREADO, CREADO]);
    expect(await prisma.inquilino.count({ where: { cedula } })).toBe(1);
    expect(await prisma.contrato.count()).toBe(2);
  }, 90000);

  it('(d) un contrato que falla por unidad ocupada no deja ficha huérfana y el reintento funciona', async () => {
    const token = await arrendador();
    const ocupada = await unidadNueva(token);
    const libre = await unidadNueva(token);
    const existente = await crearInquilino(app, token);
    await crearContrato(app, token, ocupada, existente.id);
    const cedula = cedulaUnica();
    const cuerpo = { nombre: 'Huérfano', cedula, telefono: '3002' };

    const fallido = await postContrato(
      token,
      conInquilinoNuevo(ocupada, cuerpo),
    );
    expect(fallido.status).toBe(CONFLICTO);
    expect(await prisma.inquilino.count({ where: { cedula } })).toBe(0);

    await postContrato(token, conInquilinoNuevo(libre, cuerpo)).expect(CREADO);
    expect(await prisma.inquilino.count({ where: { cedula } })).toBe(1);
  }, 90000);

  it('(h) nombre o teléfono vacíos (solo espacios) → 400 INQUILINO_DATOS_INVALIDOS sin filas nuevas, también en POST /inquilinos', async () => {
    const token = await arrendador();
    const unidadId = await unidadNueva(token);
    const casos = [
      { nombre: '   ', telefono: '3001' },
      { nombre: 'Persona', telefono: '   ' },
    ];

    for (const caso of casos) {
      const cedula = cedulaUnica();
      const contrato = await postContrato(
        token,
        conInquilinoNuevo(unidadId, { ...caso, cedula }),
      );
      expect(contrato.status).toBe(SOLICITUD_INVALIDA);
      expect(codigo(contrato)).toBe('INQUILINO_DATOS_INVALIDOS');
      expect((contrato.body as CuerpoError).mensaje).toBe(
        'El nombre y el teléfono del inquilino no pueden estar vacíos.',
      );

      const ficha = await request(app.getHttpServer())
        .post('/inquilinos')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...caso, cedula });
      expect(ficha.status).toBe(SOLICITUD_INVALIDA);
      expect(codigo(ficha)).toBe('INQUILINO_DATOS_INVALIDOS');

      expect(await prisma.inquilino.count({ where: { cedula } })).toBe(0);
    }
    expect(await prisma.contrato.count()).toBe(0);
    expect(await prisma.inquilino.count()).toBe(0);

    // Los valores válidos se guardan ya sin espacios sobrantes.
    const cedula = cedulaUnica();
    const ok = await postContrato(
      token,
      conInquilinoNuevo(unidadId, {
        nombre: '  Persona Válida  ',
        cedula,
        telefono: ' 3001234567 ',
      }),
    ).expect(CREADO);
    expect((ok.body as ContratoVista).inquilino).toMatchObject({
      nombre: 'Persona Válida',
      telefono: '3001234567',
    });
    const ficha = await request(app.getHttpServer())
      .post('/inquilinos')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: '  Ficha  ', cedula: cedulaUnica(), telefono: ' 3009 ' })
      .expect(CREADO);
    expect(ficha.body).toMatchObject({ nombre: 'Ficha', telefono: '3009' });
  }, 90000);

  it('(i) si la creación del contrato falla DESPUÉS de crear la identidad, la transacción revierte todo', async () => {
    const token = await arrendador();
    const existente = await crearInquilino(app, token);
    const primero = await crearContrato(
      app,
      token,
      await unidadNueva(token),
      existente.id,
    );
    const codigoExistente = primero.codigo_acceso?.codigo ?? '';
    expect(codigoExistente).not.toBe('');

    // Todos los intentos generan un código que ya existe: 5 colisiones → 500.
    // La identidad ya se creó dentro de la transacción antes de fallar.
    const generador = contratoService as unknown as {
      generarCodigoAcceso: () => string;
    };
    const espia = jest
      .spyOn(generador, 'generarCodigoAcceso')
      .mockReturnValue(codigoExistente);
    const cedula = cedulaUnica();
    const contratosAntes = await prisma.contrato.count();

    const fallido = await postContrato(
      token,
      conInquilinoNuevo(await unidadNueva(token), {
        nombre: 'Se Revierte',
        cedula,
        telefono: '3010',
      }),
    );

    expect(fallido.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(espia).toHaveBeenCalledTimes(5);
    expect(await prisma.inquilino.count({ where: { cedula } })).toBe(0);
    expect(await prisma.contrato.count()).toBe(contratosAntes);
    expect(await prisma.codigoAcceso.count()).toBe(1);
  }, 90000);

  it('(e) sin inquilino → 400 INQUILINO_REQUERIDO; con los dos → 400 INQUILINO_AMBIGUO', async () => {
    const token = await arrendador();
    const unidadId = await unidadNueva(token);
    const ficha = await crearInquilino(app, token);

    const ninguno = await postContrato(token, {
      ...contratoValido(unidadId, 'x'),
      inquilino_id: undefined,
    });
    expect(ninguno.status).toBe(SOLICITUD_INVALIDA);
    expect(codigo(ninguno)).toBe('INQUILINO_REQUERIDO');

    const ambos = await postContrato(token, {
      ...contratoValido(unidadId, ficha.id),
      inquilino_nuevo: { nombre: 'X', cedula: cedulaUnica(), telefono: '3' },
    });
    expect(ambos.status).toBe(SOLICITUD_INVALIDA);
    expect(codigo(ambos)).toBe('INQUILINO_AMBIGUO');

    const cedulaCorta = await postContrato(
      token,
      conInquilinoNuevo(unidadId, { nombre: 'X', cedula: '12', telefono: '3' }),
    );
    expect(cedulaCorta.status).toBe(SOLICITUD_INVALIDA);
    expect(await prisma.contrato.count()).toBe(0);
  }, 60000);

  it('(f) inquilino_id: ficha ajena → 404; ficha propia legada → 201; persona que ya tiene contrato con el arrendador → 201', async () => {
    const tokenA = await arrendador();
    const tokenB = await arrendador();
    const fichaDeA = await crearInquilino(app, tokenA);

    const ajena = await postContrato(
      tokenB,
      contratoValido(await unidadNueva(tokenB), fichaDeA.id),
    );
    expect(ajena.status).toBe(NO_ENCONTRADO);
    const inexistente = await postContrato(
      tokenB,
      contratoValido(
        await unidadNueva(tokenB),
        '00000000-0000-4000-8000-000000000000',
      ),
    );
    expect(inexistente.status).toBe(NO_ENCONTRADO);
    expect(await prisma.contrato.count()).toBe(0);

    await postContrato(
      tokenA,
      contratoValido(await unidadNueva(tokenA), fichaDeA.id),
    ).expect(CREADO);

    // A identidad creada por inquilino_nuevo: el segundo contrato con inquilino_id.
    const nueva = (
      await postContrato(
        tokenB,
        conInquilinoNuevo(await unidadNueva(tokenB), {
          nombre: 'Persona B',
          cedula: cedulaUnica(),
          telefono: '3003',
        }),
      ).expect(CREADO)
    ).body as ContratoVista;
    const segundo = await postContrato(
      tokenB,
      contratoValido(await unidadNueva(tokenB), nueva.inquilino.id),
    ).expect(CREADO);
    expect((segundo.body as ContratoVista).inquilino).toMatchObject({
      id: nueva.inquilino.id,
      nombre: 'Persona B',
      telefono: '3003',
    });

    // Otro arrendador no puede usar esa identidad por su id.
    const tercero = await postContrato(
      tokenA,
      contratoValido(await unidadNueva(tokenA), nueva.inquilino.id),
    );
    expect(tercero.status).toBe(NO_ENCONTRADO);
  }, 120000);

  it('(g) GET /inquilinos: personas con contrato (copia) más fichas propias sin contrato, sin correo; /:id ajeno → 404', async () => {
    const tokenA = await arrendador();
    const tokenB = await arrendador();
    const cedula = cedulaUnica();
    const conContrato = (
      await postContrato(
        tokenA,
        conInquilinoNuevo(await unidadNueva(tokenA), {
          nombre: 'Con Contrato',
          cedula,
          telefono: '3004',
        }),
      ).expect(CREADO)
    ).body as ContratoVista;
    await postContrato(
      tokenA,
      contratoValido(await unidadNueva(tokenA), conContrato.inquilino.id),
    ).expect(CREADO);
    const fichaSuelta = await crearInquilino(app, tokenA);
    // La persona cambia su perfil y tiene cuenta con correo.
    await prisma.inquilino.update({
      where: { id: conContrato.inquilino.id },
      data: { nombre: 'Perfil Global', correo: 'global@correo.com' },
    });

    const listaA = (
      await request(app.getHttpServer())
        .get('/inquilinos')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(HttpStatus.OK)
    ).body as InquilinoVista[];
    expect(listaA.map((i) => i.id).sort()).toEqual(
      [conContrato.inquilino.id, fichaSuelta.id].sort(),
    );
    const fila = listaA.find((i) => i.id === conContrato.inquilino.id);
    expect(fila).toMatchObject({
      nombre: 'Con Contrato',
      cedula,
      telefono: '3004',
    });
    // Ningún contrato está vinculado: el correo no se muestra aunque exista.
    for (const item of listaA) {
      expect(item).toMatchObject({ correo: null, vinculado: false });
    }

    const listaB = (
      await request(app.getHttpServer())
        .get('/inquilinos')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(HttpStatus.OK)
    ).body as InquilinoVista[];
    expect(listaB).toEqual([]);

    const propio = await request(app.getHttpServer())
      .get(`/inquilinos/${conContrato.inquilino.id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(HttpStatus.OK);
    expect(propio.body).toMatchObject({ nombre: 'Con Contrato' });
    expect(propio.body).toMatchObject({ correo: null, vinculado: false });
    await request(app.getHttpServer())
      .get(`/inquilinos/${conContrato.inquilino.id}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(NO_ENCONTRADO);
    await request(app.getHttpServer())
      .get(`/inquilinos/${fichaSuelta.id}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(NO_ENCONTRADO);
  }, 120000);

  it('mantenimiento sin contrato que resolver: nombre, cédula y teléfono en null (nunca los del perfil global)', async () => {
    const token = await arrendador();
    const unidadId = await unidadNueva(token);
    const contrato = (
      await postContrato(
        token,
        conInquilinoNuevo(unidadId, {
          nombre: 'Sin Contrato',
          cedula: cedulaUnica(),
          telefono: '3006',
        }),
      ).expect(CREADO)
    ).body as ContratoVista;
    const inquilinoToken = await autenticarInquilino(
      app,
      (contrato as unknown as { codigo_acceso: { codigo: string } })
        .codigo_acceso.codigo,
      'sin-contrato@correo.com',
    );
    await request(app.getHttpServer())
      .post('/solicitudes-mantenimiento')
      .set('Authorization', `Bearer ${inquilinoToken}`)
      .field('unidadId', unidadId)
      .field('descripcion', 'Fuga')
      .field('urgencia', 'ALTO')
      .expect(CREADO);
    await prisma.contrato.update({
      where: { id: contrato.id },
      data: { estado: 'CANCELADO' },
    });

    const lista = await request(app.getHttpServer())
      .get('/solicitudes-mantenimiento')
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);

    expect((lista.body as Array<{ inquilino: unknown }>)[0].inquilino).toEqual({
      id: contrato.inquilino.id,
      nombre: null,
      cedula: null,
      telefono: null,
    });
  }, 90000);

  it('POST /inquilinos sigue funcionando (obsoleto): crea la ficha y responde 409 con cédula repetida', async () => {
    const token = await arrendador();
    const cedula = cedulaUnica();
    const cuerpo = { nombre: 'Legado', cedula, telefono: '3005' };
    await request(app.getHttpServer())
      .post('/inquilinos')
      .set('Authorization', `Bearer ${token}`)
      .send(cuerpo)
      .expect(CREADO);
    await request(app.getHttpServer())
      .post('/inquilinos')
      .set('Authorization', `Bearer ${token}`)
      .send(cuerpo)
      .expect(CONFLICTO);
  }, 60000);
});
