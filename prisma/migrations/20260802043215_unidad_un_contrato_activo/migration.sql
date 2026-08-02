CREATE UNIQUE INDEX "unidad_contrato_activo_unico" ON "Contrato" ("unidad_id") WHERE "estado" = 'ACTIVO';
