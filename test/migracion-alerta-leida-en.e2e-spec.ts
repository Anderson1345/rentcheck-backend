// Migración B0.7-A (B-80): agrega Alerta.leida_en y la rellena con creado_en en las ya leídas. Se prueba en
// un esquema TEMPORAL de rentcheck_test con la tabla como estaba antes de la migración (solo las columnas
// que la migración usa), con filas viejas leídas y no leídas, y con la sesión en la zona de Bogotá para
// comprobar que el relleno no depende de la zona horaria.
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';

const ESQUEMA = 'b07a_migracion_tmp';

function leerMigracion(): string {
  const carpetas = readdirSync(join(__dirname, '..', 'prisma', 'migrations'))
    .filter((nombre) => nombre.includes('_b07a_'))
    .sort();
  expect(carpetas).toHaveLength(1);
  return readFileSync(
    join(__dirname, '..', 'prisma', 'migrations', carpetas[0], 'migration.sql'),
    'utf8',
  );
}

describe('Migración B0.7-A: Alerta.leida_en con relleno (e2e)', () => {
  let cliente: Client;

  beforeEach(async () => {
    cliente = new Client({ connectionString: process.env.DATABASE_URL });
    await cliente.connect();
    await cliente.query(`DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE`);
    await cliente.query(`CREATE SCHEMA ${ESQUEMA}`);
    // La tabla antes de la migración: "creado_en" es timestamp(3) sin zona, como la crea Prisma.
    await cliente.query(`
      CREATE TABLE ${ESQUEMA}."Alerta" (
        "id" TEXT PRIMARY KEY,
        "leida" BOOLEAN NOT NULL DEFAULT false,
        "creado_en" TIMESTAMP(3) NOT NULL
      )`);
  });

  afterEach(async () => {
    await cliente.query(`DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE`);
    await cliente.end();
  });

  it('las leídas reciben leida_en = creado_en (el mismo instante UTC); las no leídas quedan en NULL', async () => {
    await cliente.query(`
      INSERT INTO ${ESQUEMA}."Alerta" ("id", "leida", "creado_en") VALUES
        ('leida-vieja', true, '2025-01-10 03:30:00.123'),
        ('leida-reciente', true, '2026-09-30 23:59:59.999'),
        ('sin-leer-vieja', false, '2024-05-01 12:00:00'),
        ('sin-leer', false, '2026-10-01 08:00:00')`);

    // La zona de la sesión no debe cambiar el resultado.
    await cliente.query(`SET TIME ZONE 'America/Bogota'`);
    await cliente.query(`SET search_path TO ${ESQUEMA}`);
    await cliente.query(leerMigracion());
    await cliente.query('RESET search_path');

    const { rows } = await cliente.query<{
      id: string;
      leida_en: Date | null;
    }>(`SELECT "id", "leida_en" FROM ${ESQUEMA}."Alerta" ORDER BY "id"`);
    const porId = Object.fromEntries(rows.map((r) => [r.id, r.leida_en]));
    expect(porId['leida-vieja']?.toISOString()).toBe(
      '2025-01-10T03:30:00.123Z',
    );
    expect(porId['leida-reciente']?.toISOString()).toBe(
      '2026-09-30T23:59:59.999Z',
    );
    expect(porId['sin-leer-vieja']).toBeNull();
    expect(porId['sin-leer']).toBeNull();

    // La columna es timestamptz(3) y admite nulos.
    const { rows: columnas } = await cliente.query<{
      data_type: string;
      is_nullable: string;
      datetime_precision: number;
    }>(
      `SELECT data_type, is_nullable, datetime_precision FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'Alerta' AND column_name = 'leida_en'`,
      [ESQUEMA],
    );
    expect(columnas).toEqual([
      {
        data_type: 'timestamp with time zone',
        is_nullable: 'YES',
        datetime_precision: 3,
      },
    ]);
  });
});
