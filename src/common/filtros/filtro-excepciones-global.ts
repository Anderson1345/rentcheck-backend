import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

interface CuerpoErrorRespuesta {
  statusCode: number;
  codigo: string;
  mensaje: string;
  detalles?: unknown;
  message: string;
}

const CODIGOS_POR_ESTADO: Record<number, string> = {
  400: 'SOLICITUD_INVALIDA',
  401: 'NO_AUTENTICADO',
  403: 'PROHIBIDO',
  404: 'NO_ENCONTRADO',
  409: 'CONFLICTO',
  413: 'CARGA_DEMASIADO_GRANDE',
  429: 'DEMASIADAS_SOLICITUDES',
};

function codigoPorEstado(statusCode: number): string {
  return CODIGOS_POR_ESTADO[statusCode] ?? `ERROR_${statusCode}`;
}

interface CuerpoConCodigo {
  codigo: string;
  mensaje: string;
  detalles?: unknown;
}

function tieneCodigoPropio(cuerpo: unknown): cuerpo is CuerpoConCodigo {
  return (
    typeof cuerpo === 'object' &&
    cuerpo !== null &&
    typeof (cuerpo as Record<string, unknown>).codigo === 'string' &&
    typeof (cuerpo as Record<string, unknown>).mensaje === 'string'
  );
}

@Catch()
export class FiltroExcepcionesGlobal implements ExceptionFilter {
  private readonly logger = new Logger(FiltroExcepcionesGlobal.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const respuestaHttp = host.switchToHttp().getResponse<Response>();
    const cuerpo = this.construirCuerpo(exception);
    respuestaHttp.status(cuerpo.statusCode).json(cuerpo);
  }

  private construirCuerpo(exception: unknown): CuerpoErrorRespuesta {
    if (exception instanceof HttpException) {
      return this.desdeHttpException(exception);
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.desdePrisma(exception);
    }
    return this.desdeDesconocido(exception);
  }

  private desdeHttpException(exception: HttpException): CuerpoErrorRespuesta {
    const statusCode = exception.getStatus();
    const cuerpoRespuesta = exception.getResponse();

    if (tieneCodigoPropio(cuerpoRespuesta)) {
      return {
        statusCode,
        codigo: cuerpoRespuesta.codigo,
        mensaje: cuerpoRespuesta.mensaje,
        ...(cuerpoRespuesta.detalles !== undefined
          ? { detalles: cuerpoRespuesta.detalles }
          : {}),
        message: cuerpoRespuesta.mensaje,
      };
    }

    const mensaje = exception.message;
    return {
      statusCode,
      codigo: codigoPorEstado(statusCode),
      mensaje,
      message: mensaje,
    };
  }

  private desdePrisma(
    exception: Prisma.PrismaClientKnownRequestError,
  ): CuerpoErrorRespuesta {
    if (exception.code === 'P2025' || exception.code === 'P2023') {
      const mensaje = 'Recurso no encontrado.';
      return {
        statusCode: HttpStatus.NOT_FOUND,
        codigo: 'NO_ENCONTRADO',
        mensaje,
        message: mensaje,
      };
    }
    if (exception.code === 'P2002') {
      const mensaje = 'Ya existe un registro con esos datos.';
      return {
        statusCode: HttpStatus.CONFLICT,
        codigo: 'CONFLICTO',
        mensaje,
        message: mensaje,
      };
    }
    return this.desdeDesconocido(exception);
  }

  private desdeDesconocido(exception: unknown): CuerpoErrorRespuesta {
    this.logger.error(
      'Error inesperado',
      exception instanceof Error ? exception.stack : String(exception),
    );
    const mensaje = 'Ocurrió un error inesperado.';
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      codigo: 'ERROR_INTERNO',
      mensaje,
      message: mensaje,
    };
  }
}
