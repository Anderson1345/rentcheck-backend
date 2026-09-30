-- Copia de los datos del inquilino dentro del contrato (B0.4-A1).
-- 1) columnas nulas, 2) backfill desde el Inquilino de cada contrato,
-- 3) verificación, 4) NOT NULL. Todo en un solo archivo.

-- Conteo previo, para comprobar al final que no cambió el número de contratos.
CREATE TEMP TABLE "_conteo_b04a1" AS SELECT COUNT(*)::INTEGER AS contratos FROM "Contrato";

-- AlterTable
ALTER TABLE "Contrato"
ADD COLUMN "inquilino_nombre" TEXT,
ADD COLUMN "inquilino_cedula" TEXT,
ADD COLUMN "inquilino_telefono" TEXT;

-- Backfill: lo que hoy figura en el perfil del inquilino es lo que el arrendador escribió.
UPDATE "Contrato" c
SET "inquilino_nombre" = i."nombre",
    "inquilino_cedula" = i."cedula",
    "inquilino_telefono" = i."telefono"
FROM "Inquilino" i
WHERE i."id" = c."inquilino_id";

-- Verificación: ningún contrato puede quedar sin copia.
DO $$
DECLARE
  sin_copia INTEGER;
  antes INTEGER;
  despues INTEGER;
BEGIN
  SELECT contratos INTO antes FROM "_conteo_b04a1";
  SELECT COUNT(*) INTO despues FROM "Contrato";
  IF antes <> despues THEN
    RAISE EXCEPTION 'El número de contratos cambió durante la migración: % antes, % después', antes, despues;
  END IF;
  SELECT COUNT(*) INTO sin_copia
  FROM "Contrato"
  WHERE "inquilino_nombre" IS NULL
     OR "inquilino_cedula" IS NULL
     OR "inquilino_telefono" IS NULL;
  IF sin_copia > 0 THEN
    RAISE EXCEPTION 'Backfill de la copia del inquilino incompleto: % contrato(s) sin copia', sin_copia;
  END IF;
END $$;

DROP TABLE "_conteo_b04a1";

-- AlterTable
ALTER TABLE "Contrato"
ALTER COLUMN "inquilino_nombre" SET NOT NULL,
ALTER COLUMN "inquilino_cedula" SET NOT NULL,
ALTER COLUMN "inquilino_telefono" SET NOT NULL;
