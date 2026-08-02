-- CreateEnum
CREATE TYPE "TipoDocumentoInmueble" AS ENUM ('CERTIFICADO_TRADICION_LIBERTAD', 'RECIBO_PREDIAL', 'PAZ_Y_SALVO_ADMINISTRACION');

-- CreateTable
CREATE TABLE "DocumentoInmueble" (
    "id" UUID NOT NULL,
    "inmueble_id" UUID NOT NULL,
    "tipo" "TipoDocumentoInmueble" NOT NULL,
    "archivo_url" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentoInmueble_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "DocumentoInmueble" ADD CONSTRAINT "DocumentoInmueble_inmueble_id_fkey" FOREIGN KEY ("inmueble_id") REFERENCES "Inmueble"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
