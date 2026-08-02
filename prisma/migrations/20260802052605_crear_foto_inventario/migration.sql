-- CreateEnum
CREATE TYPE "Momento" AS ENUM ('ENTREGA', 'DEVOLUCION');

-- CreateTable
CREATE TABLE "FotoInventario" (
    "id" UUID NOT NULL,
    "contrato_id" UUID NOT NULL,
    "unidad_id" UUID NOT NULL,
    "momento" "Momento" NOT NULL,
    "zona" TEXT NOT NULL,
    "foto_url" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FotoInventario_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "FotoInventario" ADD CONSTRAINT "FotoInventario_contrato_id_fkey" FOREIGN KEY ("contrato_id") REFERENCES "Contrato"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FotoInventario" ADD CONSTRAINT "FotoInventario_unidad_id_fkey" FOREIGN KEY ("unidad_id") REFERENCES "Unidad"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
