-- CreateEnum
CREATE TYPE "TipoUnidad" AS ENUM ('APARTAMENTO', 'CASA', 'LOCAL', 'PARQUEADERO', 'HABITACION');

-- CreateEnum
CREATE TYPE "UsoPermitido" AS ENUM ('RESIDENCIAL', 'COMERCIAL');

-- CreateTable
CREATE TABLE "Unidad" (
    "id" UUID NOT NULL,
    "inmueble_id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" "TipoUnidad" NOT NULL,
    "metros_cuadrados" DECIMAL(65,30) NOT NULL,
    "numero_habitaciones" INTEGER NOT NULL,
    "numero_banos" INTEGER NOT NULL,
    "canon_base_centavos" INTEGER NOT NULL,
    "ocupantes_maximos" INTEGER NOT NULL,
    "acepta_mascotas" BOOLEAN NOT NULL,
    "uso_permitido" "UsoPermitido" NOT NULL,
    "foto_principal_url" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Unidad_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Unidad" ADD CONSTRAINT "Unidad_inmueble_id_fkey" FOREIGN KEY ("inmueble_id") REFERENCES "Inmueble"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
