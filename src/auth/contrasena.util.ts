import { applyDecorators } from '@nestjs/common';
import { IsString, Matches, MinLength } from 'class-validator';

/** Costo de bcrypt de todas las contraseñas (registro, completar-registro y restablecer). */
export const COSTO_BCRYPT = 10;

const MENSAJE_CONTRASENA =
  'La contraseña debe tener al menos 8 caracteres, incluyendo al menos una letra y un número.';

/** Reglas de contraseña del registro: mínimo 8 caracteres, al menos una letra y un número. */
export function ContrasenaValida() {
  return applyDecorators(
    IsString(),
    MinLength(8),
    Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, { message: MENSAJE_CONTRASENA }),
  );
}
