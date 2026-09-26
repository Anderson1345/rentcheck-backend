-- Normalize existing cedula values before enforcing uniqueness
UPDATE "Inquilino" SET "cedula" = regexp_replace(upper("cedula"), '[^A-Z0-9]', '', 'g');

-- DropForeignKey
ALTER TABLE "Inquilino" DROP CONSTRAINT "Inquilino_arrendador_id_fkey";

-- AlterTable
ALTER TABLE "Inquilino" ALTER COLUMN "arrendador_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Inquilino" ADD CONSTRAINT "Inquilino_arrendador_id_fkey" FOREIGN KEY ("arrendador_id") REFERENCES "Arrendador"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "Inquilino_cedula_key" ON "Inquilino"("cedula");
