-- CreateTable
CREATE TABLE "ClaveIdempotencia" (
    "id" UUID NOT NULL,
    "inquilino_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "huella" TEXT NOT NULL,
    "recurso_id" UUID,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaveIdempotencia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClaveIdempotencia_inquilino_id_endpoint_clave_key" ON "ClaveIdempotencia"("inquilino_id", "endpoint", "clave");
