-- CreateTable
CREATE TABLE "IncrementoIPC" (
    "id" UUID NOT NULL,
    "contrato_id" UUID NOT NULL,
    "fecha_aplicacion" DATE NOT NULL,
    "canon_anterior_centavos" INTEGER NOT NULL,
    "canon_nuevo_centavos" INTEGER NOT NULL,
    "porcentaje_ipc_aplicado" DECIMAL(65,30) NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncrementoIPC_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "IncrementoIPC" ADD CONSTRAINT "IncrementoIPC_contrato_id_fkey" FOREIGN KEY ("contrato_id") REFERENCES "Contrato"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
