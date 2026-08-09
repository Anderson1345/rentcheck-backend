-- CreateEnum
CREATE TYPE "RolSolicitante" AS ENUM ('ARRENDADOR', 'INQUILINO');

-- AlterTable
ALTER TABLE "Contrato" ADD COLUMN     "terminacionAnticipadaConfirmadaEn" TIMESTAMP(3),
ADD COLUMN     "terminacionAnticipadaMotivo" TEXT,
ADD COLUMN     "terminacionAnticipadaSolicitada" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "terminacionAnticipadaSolicitadaEn" TIMESTAMP(3),
ADD COLUMN     "terminacionAnticipadaSolicitadaPor" "RolSolicitante";
