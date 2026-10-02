import { Prisma, RolSolicitante, TipoAlerta } from '@prisma/client';

/** Lo único que necesita el helper: el cliente de Prisma o el `tx` de una transacción. */
export type ClienteAlerta = Pick<Prisma.TransactionClient, 'alerta'>;

export interface DatosAlerta {
  /** Destinatario arrendador. Exactamente uno de `arrendador_id` e `inquilino_id`. */
  arrendador_id?: string | null;
  /** Destinatario inquilino. */
  inquilino_id?: string | null;
  tipo: TipoAlerta;
  mensaje: string;
  contrato_id?: string | null;
  solicitud_mantenimiento_id?: string | null;
  pago_id?: string | null;
  /** Primer día del mes que cubre el período (`@db.Date`). */
  periodo?: Date | null;
}

/**
 * ÚNICO punto de creación de alertas de los servicios de negocio. Recibe el cliente de Prisma o el
 * `tx` de la transacción en curso (las alertas por evento se crean dentro de la misma transacción que
 * el cambio que las origina). Solo exige un destinatario, igual que el CHECK de la base: no valida
 * reglas de negocio ni arma textos.
 */
export async function crearAlerta(db: ClienteAlerta, datos: DatosAlerta) {
  const destinatarios = [datos.arrendador_id, datos.inquilino_id].filter(
    (id) => id !== undefined && id !== null,
  );
  if (destinatarios.length !== 1) {
    throw new Error(
      'Una alerta lleva exactamente un destinatario: arrendador_id o inquilino_id.',
    );
  }
  return await db.alerta.create({ data: datos });
}

/**
 * Alerta al arrendador de un contrato (la que crean terminación, aviso de no renovación y
 * vinculación). Busca al arrendador y el nombre de la unidad con el mismo cliente y reemplaza
 * `{unidad}` en el mensaje; la creación pasa por `crearAlerta`.
 */
export async function alertarAlArrendadorDelContrato(
  db: Pick<Prisma.TransactionClient, 'alerta' | 'contrato'>,
  contratoId: string,
  tipo: TipoAlerta,
  mensaje: string,
) {
  const contrato = await db.contrato.findUniqueOrThrow({
    where: { id: contratoId },
    select: { arrendador_id: true, unidad: { select: { nombre: true } } },
  });
  return crearAlerta(db, {
    arrendador_id: contrato.arrendador_id,
    tipo,
    contrato_id: contratoId,
    // Con función: un nombre de unidad con "$&" u otro patrón de reemplazo se escribe tal cual.
    mensaje: mensaje.replace('{unidad}', () => contrato.unidad.nombre),
  });
}

/**
 * Alerta al INQUILINO de un contrato. Solo hay a quién alertar si el contrato ya está vinculado a su
 * cuenta (`vinculado_en` no nulo: el portal solo ve contratos vinculados); si no, no escribe nada y
 * devuelve null, sin error: la persona verá todo al vincular su cuenta. Reemplaza `{unidad}` en el
 * mensaje; la creación pasa por `crearAlerta`.
 */
export async function alertarAlInquilinoDelContrato(
  db: Pick<Prisma.TransactionClient, 'alerta' | 'contrato'>,
  contratoId: string,
  datos: {
    tipo: TipoAlerta;
    mensaje: string;
    pago_id?: string | null;
    periodo?: Date | null;
  },
) {
  const contrato = await db.contrato.findUniqueOrThrow({
    where: { id: contratoId },
    select: {
      inquilino_id: true,
      vinculado_en: true,
      unidad: { select: { nombre: true } },
    },
  });
  if (contrato.vinculado_en === null) {
    return null;
  }
  return crearAlerta(db, {
    ...datos,
    inquilino_id: contrato.inquilino_id,
    contrato_id: contratoId,
    mensaje: datos.mensaje.replace('{unidad}', () => contrato.unidad.nombre),
  });
}

/**
 * Cuando una de las partes actúa sobre el contrato (terminación anticipada, aviso de no renovación),
 * avisa a la OTRA: si actúa el inquilino, al arrendador; si actúa el arrendador, al inquilino (omitida
 * si no tiene cuenta vinculada). `textos` trae el mensaje según quién actúa.
 */
export async function alertarALaContraparte(
  db: Pick<Prisma.TransactionClient, 'alerta' | 'contrato'>,
  contratoId: string,
  actor: RolSolicitante,
  tipo: TipoAlerta,
  textos: Record<RolSolicitante, string>,
): Promise<void> {
  if (actor === RolSolicitante.INQUILINO) {
    await alertarAlArrendadorDelContrato(
      db,
      contratoId,
      tipo,
      textos[RolSolicitante.INQUILINO],
    );
    return;
  }
  await alertarAlInquilinoDelContrato(db, contratoId, {
    tipo,
    mensaje: textos[RolSolicitante.ARRENDADOR],
  });
}
