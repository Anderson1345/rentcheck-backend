import {
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type EndpointIdempotente =
  'POST /pagos' | 'POST /solicitudes-mantenimiento';

export interface ParametrosClave {
  inquilinoId: string;
  endpoint: EndpointIdempotente;
  clave: string;
  huella: string;
}

const MILISEGUNDOS_RECLAMO_ABANDONADO = 2 * 60 * 1000;

@Injectable()
export class IdempotenciaService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Paso (a): busca la clave. Devuelve el `recurso_id` a reproducir, o `null`
   * si no existe (o si era un reclamo abandonado, que se borra). Lanza 422
   * si la clave se reutilizó con otro contenido y 409 si sigue en curso.
   */
  async buscarRecursoExistente(
    parametros: ParametrosClave,
  ): Promise<string | null> {
    const existente = await this.prisma.claveIdempotencia.findUnique({
      where: {
        inquilino_id_endpoint_clave: {
          inquilino_id: parametros.inquilinoId,
          endpoint: parametros.endpoint,
          clave: parametros.clave,
        },
      },
    });

    if (!existente) {
      return null;
    }

    if (existente.recurso_id) {
      if (existente.huella !== parametros.huella) {
        throw new UnprocessableEntityException({
          codigo: 'IDEMPOTENCY_KEY_REUTILIZADA',
          mensaje:
            'La clave de idempotencia ya se usó con un contenido distinto.',
        });
      }
      return existente.recurso_id;
    }

    const antiguedad = Date.now() - existente.creado_en.getTime();
    if (antiguedad < MILISEGUNDOS_RECLAMO_ABANDONADO) {
      throw this.solicitudEnProceso();
    }

    await this.liberarReclamo(existente.id);
    return null;
  }

  /**
   * Paso (c): reclama la clave con `recurso_id` nulo. Si otra petición ganó
   * la carrera, repite el paso (a) una sola vez: devuelve el recurso a
   * reproducir, o lanza 409 si sigue en curso.
   */
  async reclamar(
    parametros: ParametrosClave,
  ): Promise<{ reclamoId: string } | { recursoId: string }> {
    const reclamoId = await this.intentarCrearReclamo(parametros);
    if (reclamoId) {
      return { reclamoId };
    }

    const recursoId = await this.buscarRecursoExistente(parametros);
    if (recursoId) {
      return { recursoId };
    }

    const segundoIntento = await this.intentarCrearReclamo(parametros);
    if (segundoIntento) {
      return { reclamoId: segundoIntento };
    }
    throw this.solicitudEnProceso();
  }

  /** Paso (d): asocia el recurso creado al reclamo, dentro de su transacción. */
  async asociarRecurso(
    tx: Prisma.TransactionClient,
    reclamoId: string,
    recursoId: string,
  ): Promise<void> {
    await tx.claveIdempotencia.update({
      where: { id: reclamoId },
      data: { recurso_id: recursoId },
    });
  }

  /** Paso (e): borra el reclamo solo si todavía no tiene recurso. */
  async liberarReclamo(reclamoId: string): Promise<void> {
    await this.prisma.claveIdempotencia.deleteMany({
      where: { id: reclamoId, recurso_id: null },
    });
  }

  private async intentarCrearReclamo(
    parametros: ParametrosClave,
  ): Promise<string | null> {
    try {
      const creado = await this.prisma.claveIdempotencia.create({
        data: {
          inquilino_id: parametros.inquilinoId,
          endpoint: parametros.endpoint,
          clave: parametros.clave,
          huella: parametros.huella,
        },
      });
      return creado.id;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return null;
      }
      throw error;
    }
  }

  private solicitudEnProceso(): ConflictException {
    return new ConflictException({
      codigo: 'SOLICITUD_EN_PROCESO',
      mensaje:
        'Una petición con esta clave de idempotencia sigue en proceso. Reintenta en unos segundos.',
    });
  }
}
