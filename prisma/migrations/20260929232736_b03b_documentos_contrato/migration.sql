-- CreateEnum
CREATE TYPE "TipoDocumentoContrato" AS ENUM ('CONTRATO_ORIGINAL', 'OTROSI_INCREMENTO', 'OTROSI_PRORROGA');

-- CreateTable
CREATE TABLE "DocumentoContrato" (
    "id" UUID NOT NULL,
    "contrato_id" UUID NOT NULL,
    "tipo" "TipoDocumentoContrato" NOT NULL,
    "version" INTEGER NOT NULL,
    "ruta" TEXT NOT NULL,
    "hash_sha256" TEXT,
    "incremento_id" UUID,
    "prorroga_id" UUID,
    "generado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentoContrato_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentoContrato_contrato_id_version_key" ON "DocumentoContrato"("contrato_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentoContrato_incremento_id_key" ON "DocumentoContrato"("incremento_id");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentoContrato_prorroga_id_key" ON "DocumentoContrato"("prorroga_id");

-- AddForeignKey
ALTER TABLE "DocumentoContrato" ADD CONSTRAINT "DocumentoContrato_contrato_id_fkey" FOREIGN KEY ("contrato_id") REFERENCES "Contrato"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoContrato" ADD CONSTRAINT "DocumentoContrato_incremento_id_fkey" FOREIGN KEY ("incremento_id") REFERENCES "IncrementoIPC"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoContrato" ADD CONSTRAINT "DocumentoContrato_prorroga_id_fkey" FOREIGN KEY ("prorroga_id") REFERENCES "Prorroga"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: cada contrato con PDF actual conserva ese archivo como CONTRATO_ORIGINAL v1.
-- El hash queda en NULL (los archivos heredados no se descargan durante la migración).
INSERT INTO "DocumentoContrato" ("id", "contrato_id", "tipo", "version", "ruta", "hash_sha256", "generado_en")
SELECT gen_random_uuid(), c."id", 'CONTRATO_ORIGINAL', 1, c."pdf_contrato_ruta", NULL, c."creado_en"
FROM "Contrato" c
WHERE c."pdf_contrato_ruta" IS NOT NULL;

-- Verificación: debe haber un CONTRATO_ORIGINAL v1 por cada contrato con PDF.
DO $$
DECLARE
  con_pdf INTEGER;
  originales INTEGER;
BEGIN
  SELECT COUNT(*) INTO con_pdf FROM "Contrato" WHERE "pdf_contrato_ruta" IS NOT NULL;
  SELECT COUNT(*) INTO originales FROM "DocumentoContrato" WHERE "tipo" = 'CONTRATO_ORIGINAL' AND "version" = 1;
  IF con_pdf <> originales THEN
    RAISE EXCEPTION 'Backfill de DocumentoContrato inconsistente: % contratos con PDF, % originales v1', con_pdf, originales;
  END IF;
END $$;
