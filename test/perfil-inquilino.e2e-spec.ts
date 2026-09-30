import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
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

const OK: number = HttpStatus.OK;
const MALA_PETICION: number = HttpStatus.BAD_REQUEST;
const NO_AUTORIZADO: number = HttpStatus.UNAUTHORIZED;

interface CuerpoError {
  codigo?: string;
  mensaje?: string;
  detalles?: unknown;
}

describe('PATCH /inquilino/perfil (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let contador = 0;

  beforeEach(async () => {
    jest.spyOn(ThrottlerGuard.prototype, 'canActivate').mockResolvedValue(true);
    prisma = new PrismaService();
    await prisma.$connect();
    await limpiarBd(prisma);
    const modulo: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = modulo.createNestApplication<INestApplication<App>>();
    configurarApp(app);
    await app.init();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
    await prisma.$disconnect();
  });

  afterAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await limpiarBd(prisma);
    await prisma.$disconnect();
  });

  /** Arrendador con un contrato vinculado por un inquilino con cuenta. */
  async function escenario() {
    contador += 1;
    const { access_token } = await registrarArrendador(
      app,
      `Arrendador Perfil ${contador}`,
      `perfil-arr-${contador}@correo.com`,
    );
    const inmueble = await crearInmueble(app, access_token, `PER-${contador}`);
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
      `perfil-inq-${contador}@correo.com`,
    );
    return {
      arr: access_token,
      inq,
      inquilinoId: ficha.id,
      contratoId: contrato.id,
    };
  }

  const patch = (token: string, cuerpo: object) =>
    request(app.getHttpServer())
      .patch('/inquilino/perfil')
      .set('Authorization', `Bearer ${token}`)
      .send(cuerpo);

  const perfil = (token: string) =>
    request(app.getHttpServer())
      .get('/inquilino/perfil')
      .set('Authorization', `Bearer ${token}`);

  const codigoError = (r: { body: unknown }) => (r.body as CuerpoError).codigo;

  it('cambia nombre y teléfono y responde con el mismo formato de GET /inquilino/perfil', async () => {
    const { inq, inquilinoId } = await escenario();
    const antes = (await perfil(inq).expect(OK)).body as Record<
      string,
      unknown
    >;

    const r = await patch(inq, {
      nombre: '  Nombre Nuevo Completo  ',
      telefono: ' 3112223344 ',
    }).expect(OK);

    const cuerpo = r.body as Record<string, unknown>;
    expect(cuerpo).toMatchObject({
      id: inquilinoId,
      nombre: 'Nombre Nuevo Completo',
      telefono: '3112223344',
    });
    // Mismo formato que el GET, y lo que no se tocó no cambia.
    expect(Object.keys(cuerpo).sort()).toEqual(Object.keys(antes).sort());
    expect(cuerpo.cedula).toBe(antes.cedula);
    expect(cuerpo.correo).toBe(antes.correo);
    const despues = (await perfil(inq).expect(OK)).body as Record<
      string,
      unknown
    >;
    expect(despues).toEqual(cuerpo);
    expect(JSON.stringify(cuerpo)).not.toContain('contrasena');
  }, 120000);

  it('se puede cambiar solo el nombre o solo el teléfono', async () => {
    const { inq } = await escenario();
    const antes = (await perfil(inq).expect(OK)).body as {
      nombre: string;
      telefono: string;
    };

    const soloNombre = (await patch(inq, { nombre: 'Solo Nombre' }).expect(OK))
      .body as { nombre: string; telefono: string };
    expect(soloNombre).toMatchObject({
      nombre: 'Solo Nombre',
      telefono: antes.telefono,
    });
    const soloTelefono = (
      await patch(inq, { telefono: '3999888777' }).expect(OK)
    ).body as { nombre: string; telefono: string };
    expect(soloTelefono).toMatchObject({
      nombre: 'Solo Nombre',
      telefono: '3999888777',
    });
  }, 120000);

  it('no modifica nada del contrato: ni la fila, ni las copias de datos, ni las versiones del PDF ni su hash; el arrendador sigue viendo lo firmado', async () => {
    const { arr, inq, contratoId } = await escenario();
    const contratoAntes = await prisma.contrato.findUniqueOrThrow({
      where: { id: contratoId },
    });
    const documentosAntes = await prisma.documentoContrato.findMany({
      where: { contrato_id: contratoId },
      orderBy: { version: 'asc' },
    });
    expect(documentosAntes.length).toBeGreaterThan(0);
    const vistaArrendadorAntes = (
      await request(app.getHttpServer())
        .get(`/contratos/${contratoId}`)
        .set('Authorization', `Bearer ${arr}`)
        .expect(OK)
    ).body as { inquilino: { nombre: string; telefono: string } };

    await patch(inq, {
      nombre: 'Nombre Cambiado',
      telefono: '3000000001',
    }).expect(OK);

    expect(
      await prisma.contrato.findUniqueOrThrow({ where: { id: contratoId } }),
    ).toEqual(contratoAntes);
    const documentosDespues = await prisma.documentoContrato.findMany({
      where: { contrato_id: contratoId },
      orderBy: { version: 'asc' },
    });
    expect(documentosDespues).toEqual(documentosAntes);
    expect(documentosDespues.map((d) => d.hash_sha256)).toEqual(
      documentosAntes.map((d) => d.hash_sha256),
    );
    // La copia del contrato conserva lo que escribió el arrendador.
    expect(contratoAntes.inquilino_nombre).toBe('Inquilino Prueba');
    const vistaArrendadorDespues = (
      await request(app.getHttpServer())
        .get(`/contratos/${contratoId}`)
        .set('Authorization', `Bearer ${arr}`)
        .expect(OK)
    ).body as { inquilino: { nombre: string; telefono: string } };
    expect(vistaArrendadorDespues.inquilino).toEqual(
      vistaArrendadorAntes.inquilino,
    );
    expect(vistaArrendadorDespues.inquilino.nombre).toBe('Inquilino Prueba');
  }, 120000);

  it('cualquier otro campo (cedula, correo, contrasena, id...) es 400 CAMPO_NO_EDITABLE con la lista y no cambia nada', async () => {
    const { inq } = await escenario();
    const antes = (await perfil(inq).expect(OK)).body as unknown;

    for (const cuerpo of [
      { cedula: '999999999' },
      { correo: 'otro@correo.com' },
      { contrasena: 'NuevaClave-1' },
      { id: '00000000-0000-4000-8000-000000000000' },
      { foto_cedula_url: 'inquilinos/x/cedula.jpg' },
      { inventado: 1 },
    ]) {
      const r = await patch(inq, { nombre: 'Intento', ...cuerpo });
      expect([JSON.stringify(cuerpo), r.status]).toEqual([
        JSON.stringify(cuerpo),
        MALA_PETICION,
      ]);
      expect(codigoError(r)).toBe('CAMPO_NO_EDITABLE');
      expect((r.body as CuerpoError).detalles).toEqual(Object.keys(cuerpo));
    }
    const varios = await patch(inq, {
      nombre: 'Intento',
      cedula: '1',
      correo: 'a@b.com',
    });
    expect(codigoError(varios)).toBe('CAMPO_NO_EDITABLE');
    expect((varios.body as CuerpoError).detalles).toEqual(['cedula', 'correo']);

    expect((await perfil(inq).expect(OK)).body).toEqual(antes);
  }, 120000);

  it('un cuerpo sin campos es 400 SIN_CAMPOS', async () => {
    const { inq } = await escenario();
    for (const cuerpo of [{}, { nombre: undefined }]) {
      const r = await patch(inq, cuerpo);
      expect(r.status).toBe(MALA_PETICION);
      expect(codigoError(r)).toBe('SIN_CAMPOS');
    }
  }, 60000);

  it('nombre o teléfono inválidos (vacíos, solo espacios o no texto) son 400 VALIDACION y no cambian nada', async () => {
    const { inq } = await escenario();
    const antes = (await perfil(inq).expect(OK)).body as unknown;

    for (const cuerpo of [
      { nombre: '' },
      { nombre: '   ' },
      { nombre: 123 },
      { telefono: '' },
      { telefono: '   ' },
      { telefono: ['3001112233'] },
      { nombre: 'Válido', telefono: '' },
    ]) {
      const r = await patch(inq, cuerpo);
      expect([JSON.stringify(cuerpo), r.status, codigoError(r)]).toEqual([
        JSON.stringify(cuerpo),
        MALA_PETICION,
        'VALIDACION',
      ]);
    }
    expect((await perfil(inq).expect(OK)).body).toEqual(antes);
  }, 120000);

  it('exige sesión de inquilino: 401 sin token y con un token de arrendador', async () => {
    const { arr } = await escenario();
    await request(app.getHttpServer())
      .patch('/inquilino/perfil')
      .send({ nombre: 'X Y' })
      .expect(NO_AUTORIZADO);
    const r = await patch(arr, { nombre: 'X Y' });
    // El guard de inquilino rechaza otros roles con 401 (comportamiento existente).
    expect(r.status).toBe(NO_AUTORIZADO);
  }, 60000);

  it('un inquilino no puede afectar a otro: el id sale del token', async () => {
    const a = await escenario();
    const b = await escenario();
    const perfilBAntes = (await perfil(b.inq).expect(OK)).body as unknown;

    // Ni por id en el cuerpo (rechazado) ni por ninguna otra vía.
    const r = await patch(a.inq, { nombre: 'Solo Yo', id: b.inquilinoId });
    expect(codigoError(r)).toBe('CAMPO_NO_EDITABLE');
    await patch(a.inq, { nombre: 'Solo Yo' }).expect(OK);

    expect((await perfil(b.inq).expect(OK)).body).toEqual(perfilBAntes);
    expect(
      (
        await prisma.inquilino.findUniqueOrThrow({
          where: { id: a.inquilinoId },
        })
      ).nombre,
    ).toBe('Solo Yo');
    expect(
      (
        await prisma.inquilino.findUniqueOrThrow({
          where: { id: b.inquilinoId },
        })
      ).nombre,
    ).not.toBe('Solo Yo');
  }, 120000);
});
