-- CreateTable
CREATE TABLE "CodigoAcceso" (
    "id" UUID NOT NULL,
    "codigo" TEXT NOT NULL,
    "contrato_id" UUID NOT NULL,
    "unidad_id" UUID NOT NULL,
    "inquilino_id" UUID NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CodigoAcceso_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CodigoAcceso_codigo_key" ON "CodigoAcceso"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "CodigoAcceso_contrato_id_key" ON "CodigoAcceso"("contrato_id");

-- AddForeignKey
ALTER TABLE "CodigoAcceso" ADD CONSTRAINT "CodigoAcceso_contrato_id_fkey" FOREIGN KEY ("contrato_id") REFERENCES "Contrato"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodigoAcceso" ADD CONSTRAINT "CodigoAcceso_unidad_id_fkey" FOREIGN KEY ("unidad_id") REFERENCES "Unidad"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodigoAcceso" ADD CONSTRAINT "CodigoAcceso_inquilino_id_fkey" FOREIGN KEY ("inquilino_id") REFERENCES "Inquilino"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
