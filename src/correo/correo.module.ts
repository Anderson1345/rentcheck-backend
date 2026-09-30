import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CodigoCorreoService } from './codigo-correo.service';
import { crearCanalCorreo } from './crear-canal-correo';
import { leerConfiguracionCorreo } from './correo.config';
import { CANAL_CORREO } from './correo.constants';
import { CorreoService } from './correo.service';

/**
 * Canales de correo intercambiables (`CORREO_PROVEEDOR`: desactivado, consola
 * o resend). Una configuración inválida (p. ej. consola en producción o resend
 * sin clave) impide el arranque.
 */
@Module({
  providers: [
    {
      provide: CANAL_CORREO,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        crearCanalCorreo(
          leerConfiguracionCorreo({
            CORREO_PROVEEDOR: config.get<string>('CORREO_PROVEEDOR'),
            CORREO_REMITENTE: config.get<string>('CORREO_REMITENTE'),
            RESEND_API_KEY: config.get<string>('RESEND_API_KEY'),
            NODE_ENV: config.get<string>('NODE_ENV'),
          }),
        ),
    },
    CorreoService,
    CodigoCorreoService,
    PrismaService,
  ],
  exports: [CorreoService, CodigoCorreoService],
})
export class CorreoModule {}
