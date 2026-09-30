-- Limpieza de fotos de cédula guardadas como data: URI (B0.4-B2).
--
-- Antes de las subidas por archivo, `Arrendador.foto_cedula_nit_url` e
-- `Inquilino.foto_cedula_url` podían traer una imagen en base64 (`data:...`).
-- Ahora esos campos guardan la ruta del bucket que genera el servidor, así que
-- los valores `data:` se dejan en NULL. No se toca nada más: ni otras filas, ni
-- otros campos, ni `Unidad.foto_principal_url`, ni las rutas `_ruta`.
--
-- El bloque se ABORTA (y no cambia nada) si tras la limpieza quedan filas con
-- `data:` o si se modificó una fila que no lo tenía.

DO $$
DECLARE
  arr_con_data INTEGER;
  arr_con_valor INTEGER;
  arr_nulas INTEGER;
  inq_con_data INTEGER;
  inq_con_valor INTEGER;
  inq_nulas INTEGER;
  filas_arr INTEGER;
  filas_inq INTEGER;
  restantes INTEGER;
  arr_con_valor_despues INTEGER;
  arr_nulas_despues INTEGER;
  inq_con_valor_despues INTEGER;
  inq_nulas_despues INTEGER;
BEGIN
  -- Estado antes: con data:, con otro valor (no se debe tocar) y nulas.
  SELECT
    COUNT(*) FILTER (WHERE "foto_cedula_nit_url" ILIKE 'data:%'),
    COUNT(*) FILTER (WHERE "foto_cedula_nit_url" IS NOT NULL AND "foto_cedula_nit_url" NOT ILIKE 'data:%'),
    COUNT(*) FILTER (WHERE "foto_cedula_nit_url" IS NULL)
  INTO arr_con_data, arr_con_valor, arr_nulas
  FROM "Arrendador";

  SELECT
    COUNT(*) FILTER (WHERE "foto_cedula_url" ILIKE 'data:%'),
    COUNT(*) FILTER (WHERE "foto_cedula_url" IS NOT NULL AND "foto_cedula_url" NOT ILIKE 'data:%'),
    COUNT(*) FILTER (WHERE "foto_cedula_url" IS NULL)
  INTO inq_con_data, inq_con_valor, inq_nulas
  FROM "Inquilino";

  -- Limpieza.
  UPDATE "Arrendador" SET "foto_cedula_nit_url" = NULL
  WHERE "foto_cedula_nit_url" ILIKE 'data:%';
  GET DIAGNOSTICS filas_arr = ROW_COUNT;

  UPDATE "Inquilino" SET "foto_cedula_url" = NULL
  WHERE "foto_cedula_url" ILIKE 'data:%';
  GET DIAGNOSTICS filas_inq = ROW_COUNT;

  -- Estado después.
  SELECT
    COUNT(*) FILTER (WHERE "foto_cedula_nit_url" IS NOT NULL),
    COUNT(*) FILTER (WHERE "foto_cedula_nit_url" IS NULL)
  INTO arr_con_valor_despues, arr_nulas_despues
  FROM "Arrendador";

  SELECT
    COUNT(*) FILTER (WHERE "foto_cedula_url" IS NOT NULL),
    COUNT(*) FILTER (WHERE "foto_cedula_url" IS NULL)
  INTO inq_con_valor_despues, inq_nulas_despues
  FROM "Inquilino";

  SELECT
    (SELECT COUNT(*) FROM "Arrendador" WHERE "foto_cedula_nit_url" ILIKE 'data:%')
    + (SELECT COUNT(*) FROM "Inquilino" WHERE "foto_cedula_url" ILIKE 'data:%')
  INTO restantes;

  IF restantes > 0 THEN
    RAISE EXCEPTION 'Migración abortada: quedaron % fila(s) con data: tras la limpieza', restantes;
  END IF;

  IF filas_arr <> arr_con_data OR filas_inq <> inq_con_data THEN
    RAISE EXCEPTION 'Migración abortada: se modificaron % fila(s) de Arrendador y % de Inquilino, y se esperaban % y %',
      filas_arr, filas_inq, arr_con_data, inq_con_data;
  END IF;

  IF arr_con_valor_despues <> arr_con_valor
     OR arr_nulas_despues <> arr_nulas + arr_con_data
     OR inq_con_valor_despues <> inq_con_valor
     OR inq_nulas_despues <> inq_nulas + inq_con_data THEN
    RAISE EXCEPTION 'Migración abortada: se modificó una fila que no tenía data: (Arrendador con valor % -> %, Inquilino con valor % -> %)',
      arr_con_valor, arr_con_valor_despues, inq_con_valor, inq_con_valor_despues;
  END IF;

  RAISE NOTICE 'Fotos de cédula con data: dejadas en NULL: % de Arrendador, % de Inquilino', filas_arr, filas_inq;
END $$;
