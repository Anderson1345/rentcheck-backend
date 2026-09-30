import { BadRequestException, ConflictException } from '@nestjs/common';
import { EstadoContrato, Prisma, TipoPlantillaContrato } from '@prisma/client';
import { buscarTraslape } from '../common/traslape.util';

/**
 * Reglas de creación de un contrato que también aplican al corregirlo
 * (`PATCH /contratos/:id`): un solo lugar para que `crear()` y la corrección
 * no puedan divergir.
 */

/** Un valor de depósito de 0 o nulo significa "sin depósito". */
export function normalizarDeposito(
  deposito: number | null | undefined,
): number | null {
  return deposito || null;
}

/** Ley 820 de 2003, art. 16: sin depósito en dinero en vivienda urbana. */
export function validarDepositoSegunPlantilla(
  plantilla: TipoPlantillaContrato,
  depositoCentavos: number | null,
): void {
  if (
    plantilla === TipoPlantillaContrato.VIVIENDA_URBANA_LEY_820 &&
    depositoCentavos !== null
  ) {
    throw new BadRequestException({
      codigo: 'DEPOSITO_NO_PERMITIDO_VIVIENDA',
      mensaje:
        'La Ley 820 de 2003, art. 16, no permite depósitos en dinero en arriendos de vivienda urbana. Se pueden pactar garantías como fiador, codeudor o póliza.',
    });
  }
}

/**
 * B-41: con fecha de inicio futura el contrato es PROGRAMADO (no bloquea la
 * unidad); si no, ACTIVO. `hoy` es el día calendario de Bogotá.
 */
export function estadoInicialSegunFecha(
  fechaInicio: Date,
  hoy: Date,
): EstadoContrato {
  return fechaInicio.getTime() > hoy.getTime()
    ? EstadoContrato.PROGRAMADO
    : EstadoContrato.ACTIVO;
}

/** Misma respuesta que el validador `FechaFinPosteriorAFechaInicio` del DTO. */
export function validarFinPosteriorAInicio(inicio: Date, fin: Date): void {
  if (fin.getTime() <= inicio.getTime()) {
    throw new BadRequestException({
      codigo: 'VALIDACION',
      mensaje: 'Los datos enviados no son válidos.',
      detalles: [
        'La fecha de fin (fecha_fin) debe ser posterior a la fecha de inicio (fecha_inicio).',
      ],
    });
  }
}

/**
 * Bloquea la fila de la unidad: el índice único solo cubre los ACTIVO, así que
 * dos operaciones simultáneas que dejen contratos PROGRAMADO traslapados se
 * serializan aquí. ORDEN DE BLOQUEOS (fijo, para no provocar interbloqueos):
 * unidad y después contrato.
 */
export async function bloquearUnidad(
  tx: Prisma.TransactionClient,
  unidadId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Unidad" WHERE id = ${unidadId}::uuid FOR UPDATE`;
}

/** Bloquea la fila del contrato (siempre DESPUÉS de la unidad si se bloquean las dos). */
export async function bloquearContrato(
  tx: Prisma.TransactionClient,
  contratoId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Contrato" WHERE id = ${contratoId}::uuid FOR UPDATE`;
}

/**
 * Valida que el rango no se traslape con los contratos ACTIVO y PROGRAMADO de
 * la unidad (`buscarTraslape`). Debe llamarse con la unidad ya bloqueada.
 * `excluirContratoId` deja fuera al propio contrato al corregir sus fechas.
 * `estado` es el estado que tendrá el contrato (un ACTIVO sobre un ACTIVO
 * conserva el mensaje de siempre).
 */
export async function verificarTraslapeEnUnidad(
  tx: Prisma.TransactionClient,
  datos: {
    unidadId: string;
    inicio: Date;
    fin: Date;
    estado: EstadoContrato;
    excluirContratoId?: string;
  },
): Promise<void> {
  const existentes = await tx.contrato.findMany({
    where: {
      unidad_id: datos.unidadId,
      estado: { in: [EstadoContrato.ACTIVO, EstadoContrato.PROGRAMADO] },
      ...(datos.excluirContratoId
        ? { id: { not: datos.excluirContratoId } }
        : {}),
    },
    select: {
      estado: true,
      fecha_inicio: true,
      fecha_fin: true,
      terminacion_fecha_efectiva: true,
      terminacionAnticipadaConfirmadaEn: true,
    },
  });
  const choque = buscarTraslape(
    { inicio: datos.inicio, fin: datos.fin },
    existentes.map((existente) => ({
      estado: existente.estado,
      inicio: existente.fecha_inicio,
      fin: existente.fecha_fin,
      terminacion_fecha_efectiva: existente.terminacion_fecha_efectiva,
      confirmada: existente.terminacionAnticipadaConfirmadaEn !== null,
    })),
  );
  if (!choque) {
    return;
  }
  // Compatibilidad: un contrato ACTIVO sobre uno ACTIVO conserva el error de siempre.
  if (
    datos.estado === EstadoContrato.ACTIVO &&
    choque.estado === EstadoContrato.ACTIVO
  ) {
    throw new ConflictException('Esta unidad ya tiene un contrato activo');
  }
  throw new ConflictException({
    codigo: 'TRASLAPE_DE_CONTRATOS',
    mensaje:
      'Las fechas se traslapan con otro contrato de esta unidad. El siguiente contrato debe empezar después del último día del anterior.',
    detalles: {
      fecha_inicio: choque.inicio.toISOString().slice(0, 10),
      fecha_fin: choque.fin.toISOString().slice(0, 10),
    },
  });
}

/**
 * ¿El error es la colisión (P2002) del código de acceso único? Con el adaptador
 * de pg el error no trae `meta.target`: la restricción viene en el mensaje del
 * driver (`meta.driverAdapterError.cause`).
 */
export function esColisionDeCodigoAcceso(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  ) {
    return false;
  }
  const target = error.meta?.target;
  const causa = (
    error.meta?.driverAdapterError as
      { cause?: { originalMessage?: unknown } } | undefined
  )?.cause;
  const mensajeDelDriver =
    typeof causa?.originalMessage === 'string' ? causa.originalMessage : '';
  return (
    (Array.isArray(target) && target.includes('codigo')) ||
    (typeof target === 'string' &&
      target.includes('CodigoAcceso_codigo_key')) ||
    mensajeDelDriver.includes('CodigoAcceso_codigo_key')
  );
}
