-- CreateEnum
CREATE TYPE "UrgenciaMantenimiento" AS ENUM ('BAJO', 'MEDIO', 'ALTO');

-- CreateEnum
CREATE TYPE "EstadoSolicitudMantenimiento" AS ENUM ('PENDIENTE', 'EN_PROCESO', 'RESUELTO');

-- CreateTable
CREATE TABLE "SolicitudMantenimiento" (
    "id" UUID NOT NULL,
    "arrendador_id" UUID NOT NULL,
    "unidad_id" UUID NOT NULL,
    "inquilino_id" UUID NOT NULL,
    "descripcion" TEXT NOT NULL,
    "adjunto_url" TEXT,
    "urgencia" "UrgenciaMantenimiento" NOT NULL,
    "estado" "EstadoSolicitudMantenimiento" NOT NULL DEFAULT 'PENDIENTE',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SolicitudMantenimiento_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "SolicitudMantenimiento" ADD CONSTRAINT "SolicitudMantenimiento_arrendador_id_fkey" FOREIGN KEY ("arrendador_id") REFERENCES "Arrendador"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SolicitudMantenimiento" ADD CONSTRAINT "SolicitudMantenimiento_unidad_id_fkey" FOREIGN KEY ("unidad_id") REFERENCES "Unidad"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SolicitudMantenimiento" ADD CONSTRAINT "SolicitudMantenimiento_inquilino_id_fkey" FOREIGN KEY ("inquilino_id") REFERENCES "Inquilino"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
