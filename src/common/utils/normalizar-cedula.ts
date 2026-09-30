import { BadRequestException } from '@nestjs/common';

export function normalizarCedula(valor: string): string {
  return valor
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * Normaliza la cédula y valida su largo (5 a 20 caracteres alfanuméricos).
 * Es la misma validación de `POST /inquilinos` y de `inquilino_nuevo`.
 */
export function normalizarYValidarCedula(valor: string): string {
  const cedula = normalizarCedula(valor);
  if (cedula.length < 5 || cedula.length > 20) {
    throw new BadRequestException(
      'La cédula debe tener entre 5 y 20 caracteres alfanuméricos.',
    );
  }
  return cedula;
}
