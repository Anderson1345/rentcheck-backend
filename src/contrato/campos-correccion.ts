import { BadRequestException } from '@nestjs/common';

/** Campos que la corrección de un contrato sin vincular NUNCA cambia. */
const CAMPOS_NO_EDITABLES = [
  'unidad_id',
  'inquilino_id',
  'inquilino_nuevo',
  'tipo_plantilla',
  'estado',
  'estado_pago',
  'codigo',
  'codigo_acceso',
  'vinculado_en',
  'arrendador_id',
];

/**
 * Revisa las claves del cuerpo tal como llegó (antes del whitelist, que
 * descarta en silencio lo desconocido): un campo no editable es 400
 * `CAMPO_NO_EDITABLE` y un cuerpo sin ningún campo corregible (vacío o solo con
 * campos desconocidos) es 400 `SIN_CAMPOS`.
 */
export function validarCamposDeCorreccion(
  cuerpo: unknown,
  permitidos: readonly string[],
): void {
  const claves =
    cuerpo && typeof cuerpo === 'object' && !Array.isArray(cuerpo)
      ? Object.keys(cuerpo)
      : [];
  const noEditables = claves.filter((clave) =>
    CAMPOS_NO_EDITABLES.includes(clave),
  );
  if (noEditables.length > 0) {
    throw new BadRequestException({
      codigo: 'CAMPO_NO_EDITABLE',
      mensaje:
        'Estos campos no se pueden cambiar al corregir un contrato: se cancela el contrato y se crea otro.',
      detalles: noEditables,
    });
  }
  if (!claves.some((clave) => permitidos.includes(clave))) {
    throw new BadRequestException({
      codigo: 'SIN_CAMPOS',
      mensaje: `Envía al menos un campo a corregir: ${permitidos.join(', ')}.`,
    });
  }
}

export const CAMPOS_CORREGIR_CONTRATO = [
  'canon_centavos',
  'dia_pago',
  'forma_pago',
  'datos_recaudo',
  'deposito_centavos',
  'datos_fiador_o_poliza',
  'condicionesParticularesTexto',
  'fecha_inicio',
  'fecha_fin',
] as const;

export const CAMPOS_CORREGIR_INQUILINO = [
  'nombre',
  'telefono',
  'cedula',
] as const;
