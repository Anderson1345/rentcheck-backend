-- CreateEnum
CREATE TYPE "EstadoPagoContrato" AS ENUM ('AL_DIA', 'PENDIENTE', 'EN_MORA');

-- AlterTable
ALTER TABLE "Contrato" ADD COLUMN     "estado_pago" "EstadoPagoContrato" NOT NULL DEFAULT 'PENDIENTE';
