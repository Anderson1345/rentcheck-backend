export interface PosicionAlerta {
  creado_en: Date;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cursor opaco del feed: base64url de `{ creado_en, id }` de la última alerta entregada. */
export function codificarCursor(posicion: PosicionAlerta): string {
  return Buffer.from(
    JSON.stringify({
      creado_en: posicion.creado_en.toISOString(),
      id: posicion.id,
    }),
    'utf8',
  ).toString('base64url');
}

/** La posición que codifica un cursor, o null si no es uno válido (vacío, mal formado, id no uuid…). */
export function decodificarCursor(cursor: string): PosicionAlerta | null {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) {
    return null;
  }
  let contenido: unknown;
  try {
    contenido = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof contenido !== 'object' || contenido === null) {
    return null;
  }
  const { creado_en, id } = contenido as Record<string, unknown>;
  if (typeof creado_en !== 'string' || typeof id !== 'string') {
    return null;
  }
  const fecha = new Date(creado_en);
  if (Number.isNaN(fecha.getTime()) || fecha.toISOString() !== creado_en) {
    return null;
  }
  if (!UUID.test(id)) {
    return null;
  }
  return { creado_en: fecha, id };
}
