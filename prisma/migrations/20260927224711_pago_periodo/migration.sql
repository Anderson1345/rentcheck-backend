-- AlterTable: agrega la columna como nullable primero, para poder
-- rellenar los registros existentes antes de exigir NOT NULL.
ALTER TABLE "Pago" ADD COLUMN     "periodo" DATE;

-- Backfill: el período de cada pago existente es el primer día calendario
-- (UTC) del mes de su fecha_reportada.
UPDATE "Pago"
SET "periodo" = DATE_TRUNC('month', "fecha_reportada")
WHERE "periodo" IS NULL;

-- AlterTable: ahora que todos los registros tienen período, se exige NOT NULL.
ALTER TABLE "Pago" ALTER COLUMN "periodo" SET NOT NULL;
