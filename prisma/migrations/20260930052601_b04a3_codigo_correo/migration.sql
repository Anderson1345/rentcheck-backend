-- Código de acceso seguro y correo normalizado (B0.4-A3).

-- ---------------------------------------------------------------------------
-- 1) Correos: comprobar ANTES de normalizar que no habrá duplicados.
--    (Sin esto el UPDATE fallaría con un error de índice único poco claro, y
--    los duplicados entre Arrendador e Inquilino no los detecta ningún índice.)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  grupos_arrendador INTEGER;
  grupos_inquilino INTEGER;
  cruzados INTEGER;
BEGIN
  SELECT COUNT(*) INTO grupos_arrendador FROM (
    SELECT lower(regexp_replace("correo", '^\s+|\s+$', '', 'g')) AS c
    FROM "Arrendador" GROUP BY 1 HAVING COUNT(*) > 1
  ) t;
  IF grupos_arrendador > 0 THEN
    RAISE EXCEPTION 'Migración abortada: % correo(s) de Arrendador quedarían duplicados al normalizar (trim + minúsculas). Resuélvelos a mano antes de migrar.', grupos_arrendador;
  END IF;

  SELECT COUNT(*) INTO grupos_inquilino FROM (
    SELECT lower(regexp_replace("correo", '^\s+|\s+$', '', 'g')) AS c
    FROM "Inquilino" WHERE "correo" IS NOT NULL GROUP BY 1 HAVING COUNT(*) > 1
  ) t;
  IF grupos_inquilino > 0 THEN
    RAISE EXCEPTION 'Migración abortada: % correo(s) de Inquilino quedarían duplicados al normalizar (trim + minúsculas). Resuélvelos a mano antes de migrar.', grupos_inquilino;
  END IF;

  SELECT COUNT(*) INTO cruzados
  FROM "Arrendador" a
  JOIN "Inquilino" i
    ON lower(regexp_replace(i."correo", '^\s+|\s+$', '', 'g'))
     = lower(regexp_replace(a."correo", '^\s+|\s+$', '', 'g'));
  IF cruzados > 0 THEN
    RAISE EXCEPTION 'Migración abortada: % correo(s) están registrados a la vez como Arrendador y como Inquilino (regla 24). Resuélvelos a mano antes de migrar.', cruzados;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Normalizar los correos existentes: lower(trim(correo)).
-- ---------------------------------------------------------------------------
UPDATE "Arrendador"
SET "correo" = lower(regexp_replace("correo", '^\s+|\s+$', '', 'g'))
WHERE "correo" <> lower(regexp_replace("correo", '^\s+|\s+$', '', 'g'));

UPDATE "Inquilino"
SET "correo" = lower(regexp_replace("correo", '^\s+|\s+$', '', 'g'))
WHERE "correo" IS NOT NULL
  AND "correo" <> lower(regexp_replace("correo", '^\s+|\s+$', '', 'g'));

-- ---------------------------------------------------------------------------
-- 3) Expiración del código de acceso: columna nula → backfill → NOT NULL.
--    Un código sin usar de un contrato no cancelado vive 7 días más; el resto
--    (contrato ya vinculado o cancelado) queda expirado. Los códigos viejos
--    conservan su formato hasta que expiren.
-- ---------------------------------------------------------------------------
ALTER TABLE "CodigoAcceso" ADD COLUMN "expira_en" TIMESTAMP(3);

UPDATE "CodigoAcceso" a
SET "expira_en" = CASE
  WHEN c."vinculado_en" IS NULL AND c."estado" <> 'CANCELADO'
    THEN NOW() + INTERVAL '7 days'
  ELSE NOW()
END
FROM "Contrato" c
WHERE c."id" = a."contrato_id";

-- ---------------------------------------------------------------------------
-- 4) Verificación posterior.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  sin_expiracion INTEGER;
  correos_sin_normalizar INTEGER;
  duplicados INTEGER;
BEGIN
  SELECT COUNT(*) INTO sin_expiracion FROM "CodigoAcceso" WHERE "expira_en" IS NULL;
  IF sin_expiracion > 0 THEN
    RAISE EXCEPTION 'Migración abortada: % código(s) de acceso quedaron sin expira_en', sin_expiracion;
  END IF;

  SELECT COUNT(*) INTO correos_sin_normalizar FROM (
    SELECT "correo" FROM "Arrendador"
    UNION ALL
    SELECT "correo" FROM "Inquilino" WHERE "correo" IS NOT NULL
  ) t
  WHERE "correo" <> lower(regexp_replace("correo", '^\s+|\s+$', '', 'g'));
  IF correos_sin_normalizar > 0 THEN
    RAISE EXCEPTION 'Migración abortada: % correo(s) siguen sin normalizar', correos_sin_normalizar;
  END IF;

  SELECT COUNT(*) INTO duplicados FROM (
    SELECT "correo" FROM "Arrendador"
    UNION ALL
    SELECT "correo" FROM "Inquilino" WHERE "correo" IS NOT NULL
  ) t
  GROUP BY "correo" HAVING COUNT(*) > 1;
  IF COALESCE(duplicados, 0) > 0 THEN
    RAISE EXCEPTION 'Migración abortada: hay correos duplicados dentro de una tabla o entre Arrendador e Inquilino tras normalizar';
  END IF;
END $$;

ALTER TABLE "CodigoAcceso" ALTER COLUMN "expira_en" SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 5) Intentos fallidos con códigos de acceso.
-- ---------------------------------------------------------------------------
-- CreateTable
CREATE TABLE "IntentoCodigo" (
    "origen" TEXT NOT NULL,
    "fallidos" INTEGER NOT NULL DEFAULT 0,
    "bloqueado_hasta" TIMESTAMP(3),
    "actualizado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntentoCodigo_pkey" PRIMARY KEY ("origen")
);
