import {
  BadRequestException,
  INestApplication,
  Logger,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import type { Express, NextFunction, Request, Response } from 'express';
import { FiltroExcepcionesGlobal } from './common/filtros/filtro-excepciones-global';

const logger = new Logger('DiagnosticoIp');

function aplanarErroresValidacion(errores: ValidationError[]): string[] {
  return errores.flatMap((error) => [
    ...Object.values(error.constraints ?? {}),
    ...(error.children?.length ? aplanarErroresValidacion(error.children) : []),
  ]);
}

function construirOpcionesCors(): CorsOptions {
  return {
    origin: (origin: string | undefined, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      const esLocalhost = /^https?:\/\/localhost(:\d+)?$/.test(origin);
      const esVercel = /(^|\.)vercel\.app$/.test(origin);
      callback(null, esLocalhost || esVercel);
    },
    credentials: false,
  };
}

export function configurarApp(app: INestApplication): void {
  const instanciaExpress = app.getHttpAdapter().getInstance() as Express;
  instanciaExpress.set('trust proxy', 1);

  if (process.env.LOG_IP_DIAGNOSTICO === 'true') {
    app.use((req: Request, _res: Response, next: NextFunction) => {
      const xForwardedFor = req.headers['x-forwarded-for'];
      const xForwardedForTexto = Array.isArray(xForwardedFor)
        ? xForwardedFor.join(',')
        : (xForwardedFor ?? '');
      logger.log(
        `${req.method} ${req.originalUrl} ip=${req.ip} x-forwarded-for=${xForwardedForTexto}`,
      );
      next();
    });
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      exceptionFactory: (errores: ValidationError[]) =>
        new BadRequestException({
          codigo: 'VALIDACION',
          mensaje: 'Los datos enviados no son válidos.',
          detalles: aplanarErroresValidacion(errores),
        }),
    }),
  );

  app.useGlobalFilters(new FiltroExcepcionesGlobal());

  app.enableCors(construirOpcionesCors());
}
