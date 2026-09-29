-- CreateEnum
CREATE TYPE "TipoProrroga" AS ENUM ('MANUAL', 'AUTOMATICA');

-- AlterTable
ALTER TABLE "IncrementoIPC" ADD COLUMN     "ipc_referencia_anio" INTEGER,
ADD COLUMN     "ipc_referencia_porcentaje" DECIMAL(65,30);

-- CreateTable
CREATE TABLE "Prorroga" (
    "id" UUID NOT NULL,
    "contrato_id" UUID NOT NULL,
    "fecha_aplicacion" DATE NOT NULL,
    "fecha_fin_anterior" DATE NOT NULL,
    "fecha_fin_nueva" DATE NOT NULL,
    "meses" INTEGER NOT NULL,
    "tipo" "TipoProrroga" NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Prorroga_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Prorroga_contrato_id_idx" ON "Prorroga"("contrato_id");

-- AddForeignKey
ALTER TABLE "Prorroga" ADD CONSTRAINT "Prorroga_contrato_id_fkey" FOREIGN KEY ("contrato_id") REFERENCES "Contrato"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
