import { NotFoundException } from '@nestjs/common';

/**
 * Un código que no se puede usar (inexistente, vencido, ajeno, ya usado o de un
 * contrato cancelado): siempre la misma respuesta, sin distinguir causas, y
 * cuenta como intento fallido para el bloqueo.
 */
export class CodigoNoValidoException extends NotFoundException {
  constructor() {
    super('Código de acceso no válido');
  }
}

export function errorCodigoNoValido(): NotFoundException {
  return new CodigoNoValidoException();
}
