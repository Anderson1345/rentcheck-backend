import { EstadoContrato, Prisma } from '@prisma/client';

/**
 * Contrato "actual" de un inquilino: el ACTIVO; si no hay, el PROGRAMADO con
 * la fecha de inicio más próxima; si no, el más reciente que no esté
 * CANCELADO. Devuelve solo el id (cada llamador carga lo que necesita).
 * `donde` limita la búsqueda (siempre incluye `inquilino_id`).
 */
export async function resolverIdContratoDelInquilino(
  cliente: Pick<Prisma.TransactionClient, 'contrato'>,
  donde: Prisma.ContratoWhereInput,
): Promise<string | null> {
  const activo = await cliente.contrato.findFirst({
    where: { ...donde, estado: EstadoContrato.ACTIVO },
    select: { id: true },
  });
  if (activo) {
    return activo.id;
  }
  const programado = await cliente.contrato.findFirst({
    where: { ...donde, estado: EstadoContrato.PROGRAMADO },
    orderBy: { fecha_inicio: 'asc' },
    select: { id: true },
  });
  if (programado) {
    return programado.id;
  }
  const reciente = await cliente.contrato.findFirst({
    where: { ...donde, estado: { not: EstadoContrato.CANCELADO } },
    orderBy: { creado_en: 'desc' },
    select: { id: true },
  });
  return reciente?.id ?? null;
}
