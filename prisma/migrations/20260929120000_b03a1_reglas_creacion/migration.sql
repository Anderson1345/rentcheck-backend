-- AlterTable
ALTER TABLE "Contrato" ALTER COLUMN "deposito_centavos" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Inmueble" ALTER COLUMN "estrato" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Unidad" ALTER COLUMN "metros_cuadrados" DROP NOT NULL,
ALTER COLUMN "numero_habitaciones" DROP NOT NULL,
ALTER COLUMN "numero_banos" DROP NOT NULL,
ALTER COLUMN "ocupantes_maximos" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "ConfiguracionIpc_anio_key" ON "ConfiguracionIpc"("anio");
