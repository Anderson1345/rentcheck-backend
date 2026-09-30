/**
 * Los datos del inquilino que ve el arrendador (nombre, cédula, teléfono) son
 * los que ÉL escribió y se guardan como copia dentro del contrato
 * (`Contrato.inquilino_nombre/cedula/telefono`); nunca se leen del perfil
 * global de la persona (`Inquilino.nombre/cedula/telefono`).
 */
export interface CopiaInquilino {
  inquilino_id: string;
  inquilino_nombre: string;
  inquilino_cedula: string;
  inquilino_telefono: string;
}

/** Campos del contrato que hay que seleccionar para armar `inquilino`. */
export const SELECT_COPIA_INQUILINO = {
  inquilino_id: true,
  inquilino_nombre: true,
  inquilino_cedula: true,
  inquilino_telefono: true,
} as const;

type SinCopia<T> = Omit<
  T,
  'inquilino_nombre' | 'inquilino_cedula' | 'inquilino_telefono'
>;

/** Reemplaza las columnas de la copia por `inquilino: { id, nombre, cedula, telefono }`. */
export function conInquilinoDeLaCopia<T extends CopiaInquilino>(
  contrato: T,
): SinCopia<T> & {
  inquilino: { id: string; nombre: string; cedula: string; telefono: string };
} {
  const { inquilino_nombre, inquilino_cedula, inquilino_telefono, ...resto } =
    contrato;
  return {
    ...resto,
    inquilino: {
      id: contrato.inquilino_id,
      nombre: inquilino_nombre,
      cedula: inquilino_cedula,
      telefono: inquilino_telefono,
    },
  };
}

/** Igual, pero con el subconjunto `{ id, nombre }` (listados). */
export function conInquilinoResumido<T extends CopiaInquilino>(
  contrato: T,
): SinCopia<T> & { inquilino: { id: string; nombre: string } } {
  const { inquilino_nombre, inquilino_cedula, inquilino_telefono, ...resto } =
    contrato;
  void inquilino_cedula;
  void inquilino_telefono;
  return {
    ...resto,
    inquilino: { id: contrato.inquilino_id, nombre: inquilino_nombre },
  };
}

/**
 * Para las respuestas que devuelven el contrato "crudo": la copia del
 * inquilino no forma parte de su forma actual (se expone en `inquilino` solo
 * donde ya existía).
 */
export const OMITIR_COPIA_INQUILINO = {
  inquilino_nombre: true,
  inquilino_cedula: true,
  inquilino_telefono: true,
} as const;
