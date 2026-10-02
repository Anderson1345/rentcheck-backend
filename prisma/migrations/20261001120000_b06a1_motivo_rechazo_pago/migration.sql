-- Motivo del rechazo de un pago (B0.6-A1, B-59). Migración ADITIVA: un tipo nuevo y dos columnas
-- nulas. Sin backfill: los pagos existentes (y los rechazos anteriores) quedan con ambos en NULL.

-- CreateEnum
CREATE TYPE "MotivoRechazoPago" AS ENUM ('MONTO_NO_COINCIDE', 'PAGO_NO_VISIBLE', 'COMPROBANTE_ILEGIBLE', 'OTRO');

-- AlterTable
ALTER TABLE "Pago" ADD COLUMN     "mensaje_rechazo" TEXT,
ADD COLUMN     "motivo_rechazo" "MotivoRechazoPago";
