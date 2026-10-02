-- Alertas con destinatario arrendador O inquilino (B0.6-B1, B-18). Migración ADITIVA: valores nuevos del
-- enum, columnas nulas, índices y una restricción CHECK. Sin backfill: las filas existentes ya tienen
-- arrendador_id y quedan intactas (cumplen el CHECK tal cual).

-- AlterEnum
-- Todos los tipos que necesitan B0.6-B2 y B0.6-B3 (es la única migración de enum de la serie).
ALTER TYPE "TipoAlerta" ADD VALUE 'PAGO_APROBADO';
ALTER TYPE "TipoAlerta" ADD VALUE 'PAGO_RECHAZADO';
ALTER TYPE "TipoAlerta" ADD VALUE 'PAGO_ANULADO';
ALTER TYPE "TipoAlerta" ADD VALUE 'SOLICITUD_MANTENIMIENTO_CREADA';
ALTER TYPE "TipoAlerta" ADD VALUE 'MANTENIMIENTO_CAMBIO_ESTADO';
ALTER TYPE "TipoAlerta" ADD VALUE 'PRORROGA_APLICADA';
ALTER TYPE "TipoAlerta" ADD VALUE 'INCREMENTO_APLICADO';

-- AlterTable
ALTER TABLE "Alerta" ADD COLUMN     "inquilino_id" UUID,
ADD COLUMN     "pago_id" UUID,
ADD COLUMN     "periodo" DATE,
ADD COLUMN     "push_enviado_en" TIMESTAMP(3),
ALTER COLUMN "arrendador_id" DROP NOT NULL;

-- Exactamente un destinatario: arrendador_id o inquilino_id, nunca los dos ni ninguno. Prisma no modela
-- las restricciones CHECK; `prisma migrate diff` no la ve y no hay deriva.
ALTER TABLE "Alerta" ADD CONSTRAINT "alerta_un_solo_destinatario" CHECK (num_nonnulls("arrendador_id", "inquilino_id") = 1);

-- CreateIndex
CREATE INDEX "Alerta_arrendador_id_leida_creado_en_idx" ON "Alerta"("arrendador_id", "leida", "creado_en" DESC);

-- CreateIndex
CREATE INDEX "Alerta_inquilino_id_leida_creado_en_idx" ON "Alerta"("inquilino_id", "leida", "creado_en" DESC);

-- CreateIndex
CREATE INDEX "Alerta_arrendador_id_creado_en_id_idx" ON "Alerta"("arrendador_id", "creado_en" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "Alerta_inquilino_id_creado_en_id_idx" ON "Alerta"("inquilino_id", "creado_en" DESC, "id" DESC);

-- AddForeignKey
ALTER TABLE "Alerta" ADD CONSTRAINT "Alerta_inquilino_id_fkey" FOREIGN KEY ("inquilino_id") REFERENCES "Inquilino"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alerta" ADD CONSTRAINT "Alerta_pago_id_fkey" FOREIGN KEY ("pago_id") REFERENCES "Pago"("id") ON DELETE SET NULL ON UPDATE CASCADE;
