-- CreateTable
CREATE TABLE "ConfiguracionIpc" (
    "id" TEXT NOT NULL,
    "porcentaje" DECIMAL(65,30) NOT NULL,
    "anio" INTEGER NOT NULL,
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConfiguracionIpc_pkey" PRIMARY KEY ("id")
);
