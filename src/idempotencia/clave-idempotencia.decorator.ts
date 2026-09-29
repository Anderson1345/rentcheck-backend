import {
  BadRequestException,
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';

const FORMATO_CLAVE = /^[A-Za-z0-9_-]{8,128}$/;

/**
 * Lee el encabezado opcional `Idempotency-Key`. Sin encabezado entrega
 * `undefined`; si viene y no cumple el formato, responde 400.
 */
export const ClaveIdempotencia = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | undefined => {
    const request = context.switchToHttp().getRequest<Request>();
    const valor = request.headers['idempotency-key'];

    if (valor === undefined) {
      return undefined;
    }

    if (typeof valor !== 'string' || !FORMATO_CLAVE.test(valor)) {
      throw new BadRequestException({
        codigo: 'IDEMPOTENCY_KEY_INVALIDA',
        mensaje:
          'El encabezado Idempotency-Key debe tener entre 8 y 128 caracteres: letras, números, guion o guion bajo.',
      });
    }

    return valor;
  },
);
