-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TipoAlerta" ADD VALUE 'AVISO_NO_RENOVACION_DADO';
ALTER TYPE "TipoAlerta" ADD VALUE 'AVISO_NO_RENOVACION_CANCELADO';
ALTER TYPE "TipoAlerta" ADD VALUE 'CONTRATO_PRORROGADO_AUTOMATICAMENTE';

-- CreateTable
CREATE TABLE "AvisoNoRenovacion" (
    "id" UUID NOT NULL,
    "contrato_id" UUID NOT NULL,
    "dado_por" "RolSolicitante" NOT NULL,
    "dado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "motivo" TEXT,
    "cancelado_en" TIMESTAMP(3),

    CONSTRAINT "AvisoNoRenovacion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AvisoNoRenovacion_contrato_id_key" ON "AvisoNoRenovacion"("contrato_id");

-- AddForeignKey
ALTER TABLE "AvisoNoRenovacion" ADD CONSTRAINT "AvisoNoRenovacion_contrato_id_fkey" FOREIGN KEY ("contrato_id") REFERENCES "Contrato"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
