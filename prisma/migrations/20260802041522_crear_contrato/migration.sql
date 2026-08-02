-- CreateEnum
CREATE TYPE "TipoPlantillaContrato" AS ENUM ('VIVIENDA_URBANA_LEY_820', 'LOCAL_COMERCIAL', 'PARQUEADERO');

-- CreateEnum
CREATE TYPE "EstadoContrato" AS ENUM ('ACTIVO', 'VENCIDO', 'PROXIMO_A_VENCER');

-- CreateTable
CREATE TABLE "Contrato" (
    "id" UUID NOT NULL,
    "arrendador_id" UUID NOT NULL,
    "unidad_id" UUID NOT NULL,
    "inquilino_id" UUID NOT NULL,
    "tipo_plantilla" "TipoPlantillaContrato" NOT NULL,
    "canon_centavos" INTEGER NOT NULL,
    "dia_pago" INTEGER NOT NULL,
    "forma_pago" TEXT NOT NULL,
    "deposito_centavos" INTEGER NOT NULL,
    "datos_recaudo" TEXT NOT NULL,
    "datos_fiador_o_poliza" TEXT,
    "fecha_inicio" DATE NOT NULL,
    "fecha_fin" DATE NOT NULL,
    "pdf_contrato_url" TEXT,
    "estado" "EstadoContrato" NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contrato_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Contrato" ADD CONSTRAINT "Contrato_arrendador_id_fkey" FOREIGN KEY ("arrendador_id") REFERENCES "Arrendador"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contrato" ADD CONSTRAINT "Contrato_unidad_id_fkey" FOREIGN KEY ("unidad_id") REFERENCES "Unidad"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contrato" ADD CONSTRAINT "Contrato_inquilino_id_fkey" FOREIGN KEY ("inquilino_id") REFERENCES "Inquilino"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
