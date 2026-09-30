import { BadRequestException } from '@nestjs/common';

/** Siempre el mismo error: no distingue código equivocado, vencido, consumido, de otro propósito ni correo desconocido. */
export class CodigoCorreoInvalidoException extends BadRequestException {
  constructor() {
    super({
      codigo: 'CODIGO_INVALIDO',
      mensaje: 'El código no es válido o ya venció.',
    });
  }
}

/** Un intento con este error cuenta para el bloqueo por origen. */
export function esCodigoCorreoInvalido(error: unknown): boolean {
  return error instanceof CodigoCorreoInvalidoException;
}
