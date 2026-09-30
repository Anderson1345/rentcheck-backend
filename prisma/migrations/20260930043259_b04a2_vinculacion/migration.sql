-- Vinculación del contrato por el inquilino (B0.4-A2).

-- AlterEnum (el valor nuevo no se usa en este archivo)
ALTER TYPE "TipoAlerta" ADD VALUE 'CONTRATO_VINCULADO_POR_INQUILINO';

-- AlterTable
ALTER TABLE "Contrato" ADD COLUMN "vinculado_en" TIMESTAMP(3);

-- Backfill: hoy el acceso al portal se da por tener cuenta, así que los
-- contratos cuyo inquilino ya tiene cuenta quedan vinculados desde su creación
-- (se conserva el acceso actual). Los demás quedan sin vincular (NULL).
UPDATE "Contrato" c
SET "vinculado_en" = c."creado_en"
FROM "Inquilino" i
WHERE i."id" = c."inquilino_id"
  AND i."correo" IS NOT NULL
  AND i."contrasena_hash" IS NOT NULL;

-- Verificación: el número de contratos vinculados debe ser exactamente el de
-- contratos cuyo inquilino tiene cuenta.
DO $$
DECLARE
  esperados INTEGER;
  vinculados INTEGER;
BEGIN
  SELECT COUNT(*) INTO esperados
  FROM "Contrato" c
  JOIN "Inquilino" i ON i."id" = c."inquilino_id"
  WHERE i."correo" IS NOT NULL AND i."contrasena_hash" IS NOT NULL;

  SELECT COUNT(*) INTO vinculados
  FROM "Contrato"
  WHERE "vinculado_en" IS NOT NULL;

  IF esperados <> vinculados THEN
    RAISE EXCEPTION 'Backfill de vinculado_en inconsistente: % contratos esperados, % vinculados', esperados, vinculados;
  END IF;
END $$;
