-- B0.7-A (B-80): fecha de lectura de las alertas, para ocultar las leídas de hace más de 7 días y
-- borrar las de más de 60. Aditiva: una columna nula, sin índices nuevos.
ALTER TABLE "Alerta" ADD COLUMN "leida_en" TIMESTAMPTZ(3);

-- Las alertas que ya estaban leídas no guardaron cuándo se leyeron: se usa su fecha de creación como
-- aproximación. Es la cota más temprana posible (nadie lee una alerta antes de que exista), así que una
-- alerta vieja ya leída se oculta y se borra a lo sumo ANTES de lo que diría su lectura real, nunca
-- después. "creado_en" es timestamp sin zona escrito en UTC por Prisma: AT TIME ZONE 'UTC' lo convierte
-- sin depender de la zona horaria de la sesión.
UPDATE "Alerta"
SET "leida_en" = "creado_en" AT TIME ZONE 'UTC'
WHERE "leida" = true AND "leida_en" IS NULL;
