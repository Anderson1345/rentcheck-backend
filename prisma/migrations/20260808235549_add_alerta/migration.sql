-- CreateEnum
CREATE TYPE "TipoAlerta" AS ENUM ('AJUSTE_IPC_PENDIENTE', 'INQUILINO_EN_MORA', 'CONTRATO_PROXIMO_A_VENCER', 'RECORDATORIO_PAGO_PROXIMO', 'SOLICITUD_MANTENIMIENTO_SIN_ATENDER');

-- CreateTable
CREATE TABLE "Alerta" (
    "id" UUID NOT NULL,
    "arrendador_id" UUID NOT NULL,
    "tipo" "TipoAlerta" NOT NULL,
    "mensaje" TEXT NOT NULL,
    "contrato_id" UUID,
    "solicitud_mantenimiento_id" UUID,
    "leida" BOOLEAN NOT NULL DEFAULT false,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alerta_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Alerta" ADD CONSTRAINT "Alerta_arrendador_id_fkey" FOREIGN KEY ("arrendador_id") REFERENCES "Arrendador"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alerta" ADD CONSTRAINT "Alerta_contrato_id_fkey" FOREIGN KEY ("contrato_id") REFERENCES "Contrato"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alerta" ADD CONSTRAINT "Alerta_solicitud_mantenimiento_id_fkey" FOREIGN KEY ("solicitud_mantenimiento_id") REFERENCES "SolicitudMantenimiento"("id") ON DELETE SET NULL ON UPDATE CASCADE;
