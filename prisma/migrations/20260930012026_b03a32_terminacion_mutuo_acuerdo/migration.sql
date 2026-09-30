-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TipoAlerta" ADD VALUE 'TERMINACION_ANTICIPADA_SOLICITADA';
ALTER TYPE "TipoAlerta" ADD VALUE 'TERMINACION_ANTICIPADA_CANCELADA';
ALTER TYPE "TipoAlerta" ADD VALUE 'TERMINACION_ANTICIPADA_CONFIRMADA';

-- AlterTable
ALTER TABLE "Contrato" ADD COLUMN     "terminacion_confirmada_por" "RolSolicitante",
ADD COLUMN     "terminacion_fecha_efectiva" DATE;

-- Backfill: todas las confirmaciones históricas las hizo el arrendador (el inquilino
-- no podía confirmar). Su fecha efectiva queda nula: el estado de cuenta usa la
-- fecha calendario (Bogotá) de terminacionAnticipadaConfirmadaEn como tope.
UPDATE "Contrato"
SET "terminacion_confirmada_por" = 'ARRENDADOR'
WHERE "terminacionAnticipadaConfirmadaEn" IS NOT NULL;
