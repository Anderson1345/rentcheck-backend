-- CreateTable
CREATE TABLE "Inmueble" (
    "id" UUID NOT NULL,
    "arrendador_id" UUID NOT NULL,
    "direccion" TEXT NOT NULL,
    "ciudad" TEXT NOT NULL,
    "estrato" INTEGER NOT NULL,
    "matricula_inmobiliaria" TEXT NOT NULL,
    "foto_portada_url" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Inmueble_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Inmueble" ADD CONSTRAINT "Inmueble_arrendador_id_fkey" FOREIGN KEY ("arrendador_id") REFERENCES "Arrendador"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
