import { PrismaClient } from '@prisma/client';

export async function limpiarBd(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.claveIdempotencia.deleteMany();
    await tx.intentoCodigo.deleteMany();
    await tx.codigoCorreo.deleteMany();
    await tx.alerta.deleteMany();
    await tx.codigoAcceso.deleteMany();
    await tx.fotoInventario.deleteMany();
    await tx.pago.deleteMany();
    await tx.avisoNoRenovacion.deleteMany();
    await tx.documentoContrato.deleteMany();
    await tx.incrementoIPC.deleteMany();
    await tx.solicitudMantenimiento.deleteMany();
    await tx.documentoInmueble.deleteMany();
    await tx.prorroga.deleteMany();
    await tx.contrato.deleteMany();
    await tx.unidad.deleteMany();
    await tx.inquilino.deleteMany();
    await tx.inmueble.deleteMany();
    await tx.configuracionIpc.deleteMany();
    await tx.arrendador.deleteMany();
  });
}
