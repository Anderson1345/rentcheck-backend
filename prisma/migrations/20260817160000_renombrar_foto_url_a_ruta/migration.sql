-- AlterTable
ALTER TABLE "FotoInventario" RENAME COLUMN "foto_url" TO "foto_ruta";

-- AlterTable
ALTER TABLE "FotoInventario" ALTER COLUMN "foto_ruta" DROP NOT NULL;