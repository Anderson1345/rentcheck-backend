import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { leerConfiguracionTareas } from './tareas.config';

export const ENCABEZADO_TAREAS_SECRET = 'x-tareas-secret';

function huella(valor: string): Buffer {
  return createHash('sha256').update(valor).digest();
}

/**
 * Protege `POST /interno/tareas-diarias` con el encabezado `X-Tareas-Secret`.
 * Se comparan los hashes SHA-256 con `timingSafeEqual` (mismo largo siempre,
 * sin filtrar por tiempo). Sin la variable `TAREAS_SECRET` responde 503; sin
 * encabezado o con uno incorrecto, el mismo 401 genérico. El secreto nunca se
 * registra ni se devuelve.
 */
@Injectable()
export class TareasSecretGuard implements CanActivate {
  canActivate(contexto: ExecutionContext): boolean {
    const { secreto } = leerConfiguracionTareas(process.env);
    if (!secreto) {
      throw new ServiceUnavailableException({
        codigo: 'TAREAS_NO_CONFIGURADAS',
        mensaje: 'Las tareas diarias no están configuradas.',
      });
    }

    const peticion = contexto.switchToHttp().getRequest<Request>();
    const recibido = peticion.headers[ENCABEZADO_TAREAS_SECRET];
    const valor = Array.isArray(recibido) ? recibido[0] : recibido;
    const coincide =
      typeof valor === 'string' &&
      timingSafeEqual(huella(valor), huella(secreto));
    if (!coincide) {
      throw new UnauthorizedException('No autorizado.');
    }
    return true;
  }
}
