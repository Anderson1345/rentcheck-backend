import { NotFoundException } from '@nestjs/common';
import { EstadoContrato, Prisma } from '@prisma/client';

/**
 * Contrato del portal del inquilino por id (B0.4-B): solo se devuelve si es de
 * ese inquilino, ya fue VINCULADO con el código de acceso y no está CANCELADO.
 * En cualquier otro caso (ajeno, sin vincular, cancelado o inexistente) lanza
 * el mismo 404, sin distinguir la causa. Toda ruta del inquilino que reciba un
 * id de contrato pasa por aquí.
 */
export async function contratoVinculadoDelInquilino<
  S extends Prisma.ContratoSelect,
>(
  cliente: Pick<Prisma.TransactionClient, 'contrato'>,
  inquilinoId: string,
  contratoId: string,
  select: S,
): Promise<Prisma.ContratoGetPayload<{ select: S }>> {
  const contrato = await cliente.contrato.findFirst({
    where: {
      id: contratoId,
      inquilino_id: inquilinoId,
      vinculado_en: { not: null },
      estado: { not: EstadoContrato.CANCELADO },
    },
    select,
  });
  if (!contrato) {
    throw new NotFoundException('Contrato no encontrado.');
  }
  return contrato;
}
