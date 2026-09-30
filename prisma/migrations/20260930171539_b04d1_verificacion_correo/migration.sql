-- CreateEnum
CREATE TYPE "PropositoCodigoCorreo" AS ENUM ('VERIFICACION', 'RECUPERACION');

-- AlterTable
ALTER TABLE "Arrendador" ADD COLUMN     "correo_verificado_en" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Inquilino" ADD COLUMN     "correo_verificado_en" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CodigoCorreo" (
    "id" UUID NOT NULL,
    "correo" TEXT NOT NULL,
    "proposito" "PropositoCodigoCorreo" NOT NULL,
    "codigo_hash" TEXT NOT NULL,
    "expira_en" TIMESTAMP(3) NOT NULL,
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "consumido_en" TIMESTAMP(3),
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CodigoCorreo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CodigoCorreo_correo_proposito_creado_en_idx" ON "CodigoCorreo"("correo", "proposito", "creado_en");
