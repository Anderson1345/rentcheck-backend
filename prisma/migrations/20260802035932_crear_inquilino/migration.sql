-- CreateTable
CREATE TABLE "Inquilino" (
    "id" UUID NOT NULL,
    "arrendador_id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "cedula" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "correo" TEXT,
    "contrasena_hash" TEXT,
    "foto_cedula_url" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Inquilino_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Inquilino_correo_key" ON "Inquilino"("correo");

-- AddForeignKey
ALTER TABLE "Inquilino" ADD CONSTRAINT "Inquilino_arrendador_id_fkey" FOREIGN KEY ("arrendador_id") REFERENCES "Arrendador"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
