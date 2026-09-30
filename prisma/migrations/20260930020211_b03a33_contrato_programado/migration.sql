-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EstadoContrato" ADD VALUE 'PROGRAMADO';
ALTER TYPE "EstadoContrato" ADD VALUE 'CANCELADO';

-- AlterTable
ALTER TABLE "Contrato" ADD COLUMN     "cancelado_en" TIMESTAMP(3);
