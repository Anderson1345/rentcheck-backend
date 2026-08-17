import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const aplicar = process.argv.includes('--apply');
const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL ?? '',
  }),
});

async function main() {
  const [pagos, documentos, contratos] = await Promise.all([
    prisma.pago.count({ where: { comprobante_ruta: { startsWith: 'uploads/' } } }),
    prisma.documentoInmueble.count({
      where: { archivo_ruta: { startsWith: 'uploads/' } },
    }),
    prisma.contrato.count({
      where: { pdf_contrato_url: { startsWith: 'uploads/' } },
    }),
  ]);

  console.log('=== RUTAS LEGACY (prefijo uploads/) ===');
  console.log(`Pago.comprobante_ruta       : ${pagos}`);
  console.log(`DocumentoInmueble.archivo_ruta: ${documentos}`);
  console.log(`Contrato.pdf_contrato_url    : ${contratos}`);

  if (!aplicar) {
    console.log('\nModo dry-run: no se aplicó ningún cambio.');
    console.log('Usa --apply para poner esos campos en NULL.');
    return;
  }

  const [, , ] = await Promise.all([
    prisma.pago.updateMany({
      where: { comprobante_ruta: { startsWith: 'uploads/' } },
      data: { comprobante_ruta: null },
    }),
    prisma.documentoInmueble.updateMany({
      where: { archivo_ruta: { startsWith: 'uploads/' } },
      data: { archivo_ruta: null },
    }),
    prisma.contrato.updateMany({
      where: { pdf_contrato_url: { startsWith: 'uploads/' } },
      data: { pdf_contrato_url: null },
    }),
  ]);

  const [pagosRestantes, documentosRestantes, contratosRestantes] =
    await Promise.all([
      prisma.pago.count({
        where: { comprobante_ruta: { startsWith: 'uploads/' } },
      }),
      prisma.documentoInmueble.count({
        where: { archivo_ruta: { startsWith: 'uploads/' } },
      }),
      prisma.contrato.count({
        where: { pdf_contrato_url: { startsWith: 'uploads/' } },
      }),
    ]);

  console.log('\n=== DESPUÉS DE APLICAR ===');
  console.log(`Pago.comprobante_ruta       : ${pagosRestantes} restantes`);
  console.log(`DocumentoInmueble.archivo_ruta: ${documentosRestantes} restantes`);
  console.log(`Contrato.pdf_contrato_url    : ${contratosRestantes} restantes`);
}

main()
  .catch((error) => {
    console.error('ERROR:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });