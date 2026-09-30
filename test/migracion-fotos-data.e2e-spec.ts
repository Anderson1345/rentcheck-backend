import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import { PrismaService } from '../src/prisma/prisma.service';
import { limpiarBd } from './helpers/limpiar-bd';

const DATA_URI = 'data:image/png;base64,iVBORw0KGgo=';
const RUTA_VALIDA = 'arrendadores/x/cedula.jpg';
const RUTA_LEGADA = 'contratos/y/v1-CONTRATO_ORIGINAL.pdf';

function leerMigracion(): string {
  const carpeta = readdirSync(join(__dirname, '..', 'prisma', 'migrations'))
    .filter((nombre) => nombre.includes('_b04b2_'))
    .sort();
  expect(carpeta).toHaveLength(1);
  return readFileSync(
    join(__dirname, '..', 'prisma', 'migrations', carpeta[0], 'migration.sql'),
    'utf8',
  );
}

describe('Migración B0.4-B2: limpiar fotos de cédula con data: (e2e)', () => {
  let prisma: PrismaService;
  let cliente: Client;
  let sql: string;

  beforeEach(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await limpiarBd(prisma);
    cliente = new Client({ connectionString: process.env.DATABASE_URL });
    await cliente.connect();
    sql = leerMigracion();
  });

  afterEach(async () => {
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS deshacer_limpieza ON "Arrendador"',
    );
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS contaminar_otra_fila ON "Arrendador"',
    );
    await prisma.$executeRawUnsafe(
      'DROP FUNCTION IF EXISTS deshacer_limpieza()',
    );
    await prisma.$executeRawUnsafe(
      'DROP FUNCTION IF EXISTS contaminar_otra_fila()',
    );
    await cliente.end();
    await limpiarBd(prisma);
    await prisma.$disconnect();
  });

  async function sembrar() {
    const crearArrendador = (correo: string, foto: string | null) =>
      prisma.arrendador.create({
        data: {
          nombre: correo,
          correo,
          telefono: '3000000000',
          contrasena_hash: 'x',
          foto_cedula_nit_url: foto,
        },
        select: { id: true },
      });
    const conData = await crearArrendador('con-data@correo.com', DATA_URI);
    const valida = await crearArrendador('valida@correo.com', RUTA_VALIDA);
    const legada = await crearArrendador('legada@correo.com', RUTA_LEGADA);
    const sinFoto = await crearArrendador('sin-foto@correo.com', null);

    const crearInquilinoFila = (cedula: string, foto: string | null) =>
      prisma.inquilino.create({
        data: {
          nombre: cedula,
          cedula,
          telefono: '3000000000',
          foto_cedula_url: foto,
        },
        select: { id: true },
      });
    const inqData = await crearInquilinoFila('111', DATA_URI);
    const inqValida = await crearInquilinoFila(
      '222',
      'inquilinos/z/cedula.png',
    );
    const inqSinFoto = await crearInquilinoFila('333', null);
    return { conData, valida, legada, sinFoto, inqData, inqValida, inqSinFoto };
  }

  const fotoArr = async (id: string) =>
    (
      await prisma.arrendador.findUniqueOrThrow({
        where: { id },
        select: { foto_cedula_nit_url: true },
      })
    ).foto_cedula_nit_url;
  const fotoInq = async (id: string) =>
    (
      await prisma.inquilino.findUniqueOrThrow({
        where: { id },
        select: { foto_cedula_url: true },
      })
    ).foto_cedula_url;

  it('deja en NULL solo los valores que empiezan por data: y no toca nada más', async () => {
    const f = await sembrar();

    await cliente.query(sql);

    expect(await fotoArr(f.conData.id)).toBeNull();
    expect(await fotoArr(f.valida.id)).toBe(RUTA_VALIDA);
    expect(await fotoArr(f.legada.id)).toBe(RUTA_LEGADA);
    expect(await fotoArr(f.sinFoto.id)).toBeNull();
    expect(await fotoInq(f.inqData.id)).toBeNull();
    expect(await fotoInq(f.inqValida.id)).toBe('inquilinos/z/cedula.png');
    expect(await fotoInq(f.inqSinFoto.id)).toBeNull();
    const restantes = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT (SELECT COUNT(*) FROM "Arrendador" WHERE "foto_cedula_nit_url" LIKE 'data:%')::int
            + (SELECT COUNT(*) FROM "Inquilino" WHERE "foto_cedula_url" LIKE 'data:%')::int AS n`,
    );
    expect(restantes[0].n).toBe(0);
  });

  it('es idempotente: una segunda ejecución no cambia nada', async () => {
    const f = await sembrar();
    await cliente.query(sql);
    await cliente.query(sql);
    expect(await fotoArr(f.valida.id)).toBe(RUTA_VALIDA);
    expect(await fotoArr(f.conData.id)).toBeNull();
  });

  it('ABORTA y no cambia nada si tras la limpieza quedan filas con data:', async () => {
    const f = await sembrar();
    // El trigger "deshace" la limpieza: la fila vuelve a quedar con data:.
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION deshacer_limpieza() RETURNS trigger AS $$ BEGIN NEW."foto_cedula_nit_url" := OLD."foto_cedula_nit_url"; RETURN NEW; END; $$ LANGUAGE plpgsql`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER deshacer_limpieza BEFORE UPDATE ON "Arrendador" FOR EACH ROW EXECUTE FUNCTION deshacer_limpieza()`,
    );

    await expect(cliente.query(sql)).rejects.toThrow(/Migración abortada/);

    expect(await fotoArr(f.conData.id)).toBe(DATA_URI);
    expect(await fotoInq(f.inqData.id)).toBe(DATA_URI);
  });

  it('ABORTA si la migración modificó una fila que no tenía data:', async () => {
    const f = await sembrar();
    // Al limpiar una fila con data:, el trigger borra también la foto de otra fila válida.
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION contaminar_otra_fila() RETURNS trigger AS $$ BEGIN UPDATE "Arrendador" SET "foto_cedula_nit_url" = NULL WHERE "foto_cedula_nit_url" = '${RUTA_VALIDA}'; RETURN NEW; END; $$ LANGUAGE plpgsql`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER contaminar_otra_fila AFTER UPDATE ON "Arrendador" FOR EACH ROW WHEN (OLD."foto_cedula_nit_url" LIKE 'data:%') EXECUTE FUNCTION contaminar_otra_fila()`,
    );

    await expect(cliente.query(sql)).rejects.toThrow(/Migración abortada/);

    expect(await fotoArr(f.conData.id)).toBe(DATA_URI);
    expect(await fotoArr(f.valida.id)).toBe(RUTA_VALIDA);
  });
});
