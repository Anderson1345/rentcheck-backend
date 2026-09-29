-- Corrección de ConfiguracionIpc (B0.3-A1): IPC 2024 = 5,20 % e IPC 2025 = 5,10 %.
--
-- Idempotente: se puede correr varias veces. Va dentro de una transacción.
-- No borra filas. Si encuentra años duplicados, LOS LISTA Y ABORTA sin
-- cambiar nada (resuélvelos a mano y vuelve a correrlo).
-- No corrige IncrementoIPC ya aplicados: solo informa cuántos usaron 9,28 %.
--
-- Cómo correrlo (siempre en este orden):
--   1. Local: psql "<url-local>" -v ON_ERROR_STOP=1 -f scripts/sql/corregir-ipc.sql
--   2. rentcheck_test: lo mismo con la URL de la base de pruebas.
--   3. Producción: SOLO después de un pg_dump reciente
--        pg_dump "<url-prod>" -Fc -f respaldo-antes-ipc.dump
--      y pegando este archivo completo en el editor SQL de Supabase (o
--      con psql y -v ON_ERROR_STOP=1). Revisa los SELECT de antes y después.
--
-- NO lo ejecutes contra rentcheck_test ni producción desde el asistente.

BEGIN;

-- 1. Estado ANTES
SELECT 'ANTES' AS momento, id, anio, porcentaje, "actualizadoEn"
FROM "ConfiguracionIpc"
ORDER BY anio, "actualizadoEn";

-- 2. Abortar si hay años duplicados (no se borra nada)
DO $$
DECLARE
  duplicados text;
BEGIN
  SELECT string_agg(anio::text || ' (' || n || ' filas)', ', ' ORDER BY anio)
    INTO duplicados
  FROM (
    SELECT anio, COUNT(*) AS n
    FROM "ConfiguracionIpc"
    GROUP BY anio
    HAVING COUNT(*) > 1
  ) d;

  IF duplicados IS NOT NULL THEN
    RAISE EXCEPTION
      'ConfiguracionIpc tiene años duplicados: %. No se cambió nada. Deja una sola fila por año a mano y vuelve a correr el script.',
      duplicados;
  END IF;
END $$;

-- 3. Upsert por año (UPDATE si existe y cambia; INSERT si falta)
UPDATE "ConfiguracionIpc"
SET porcentaje = 5.20, "actualizadoEn" = now()
WHERE anio = 2024 AND porcentaje IS DISTINCT FROM 5.20;

INSERT INTO "ConfiguracionIpc" (id, porcentaje, anio)
SELECT gen_random_uuid()::text, 5.20, 2024
WHERE NOT EXISTS (SELECT 1 FROM "ConfiguracionIpc" WHERE anio = 2024);

UPDATE "ConfiguracionIpc"
SET porcentaje = 5.10, "actualizadoEn" = now()
WHERE anio = 2025 AND porcentaje IS DISTINCT FROM 5.10;

INSERT INTO "ConfiguracionIpc" (id, porcentaje, anio)
SELECT gen_random_uuid()::text, 5.10, 2025
WHERE NOT EXISTS (SELECT 1 FROM "ConfiguracionIpc" WHERE anio = 2025);

-- 4. Estado DESPUÉS
SELECT 'DESPUES' AS momento, id, anio, porcentaje, "actualizadoEn"
FROM "ConfiguracionIpc"
ORDER BY anio, "actualizadoEn";

-- 5. Solo informativo: incrementos ya aplicados con el valor erróneo (9,28 %)
SELECT COUNT(*) AS incrementos_con_9_28_por_ciento
FROM "IncrementoIPC"
WHERE porcentaje_ipc_aplicado = 9.28;

COMMIT;
