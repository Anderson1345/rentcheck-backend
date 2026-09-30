import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PropositoCodigoCorreo } from '@prisma/client';
import type { CanalCorreo } from './canal-correo.interface';
import { CANAL_CORREO, VIGENCIA_CODIGO_MINUTOS } from './correo.constants';

/** Fachada del canal: arma los mensajes en español y dice si hay proveedor. */
@Injectable()
export class CorreoService {
  constructor(@Inject(CANAL_CORREO) private readonly canal: CanalCorreo) {}

  /** false cuando `CORREO_PROVEEDOR` es `desactivado` (o no está definida). */
  correoDisponible(): boolean {
    return this.canal.correoDisponible();
  }

  /** Sin un proveedor configurado las funciones de correo responden 503. */
  exigirDisponible(): void {
    if (!this.correoDisponible()) {
      throw new ServiceUnavailableException({
        codigo: 'CORREO_NO_DISPONIBLE',
        mensaje: 'El envío de correos no está disponible por ahora.',
      });
    }
  }

  /**
   * Envía un código de 6 dígitos con la plantilla de su propósito. Sin
   * enlaces y nunca con contraseñas.
   */
  enviarCodigo(
    para: string,
    codigo: string,
    proposito: PropositoCodigoCorreo,
  ): Promise<void> {
    const vigencia = `Vence en ${VIGENCIA_CODIGO_MINUTOS} minutos.`;
    const plantilla =
      proposito === PropositoCodigoCorreo.RECUPERACION
        ? {
            asunto: 'Tu código para restablecer la contraseña de RentCheck',
            presentacion:
              'Tu código para restablecer la contraseña de RentCheck es:',
            ignorar:
              'Si no fuiste tú, ignora este mensaje y considera cambiar tu contraseña.',
          }
        : {
            asunto: 'Tu código de verificación de RentCheck',
            presentacion: 'Tu código de verificación de RentCheck es:',
            ignorar: 'Si no fuiste tú, ignora este mensaje.',
          };
    return this.canal.enviar({
      para,
      asunto: plantilla.asunto,
      texto: `${plantilla.presentacion} ${codigo}\n\n${vigencia}\n\n${plantilla.ignorar}`,
      html: `<p>${plantilla.presentacion}</p><p style="font-size:24px;letter-spacing:4px"><strong>${codigo}</strong></p><p>${vigencia}</p><p>${plantilla.ignorar}</p>`,
    });
  }

  /** Aviso de seguridad tras cambiar la contraseña: no lleva código ni contraseña. */
  enviarAvisoCambioContrasena(para: string): Promise<void> {
    const aviso =
      'La contraseña de tu cuenta de RentCheck fue cambiada. Si no fuiste tú, restablécela de nuevo desde "Olvidé mi contraseña".';
    return this.canal.enviar({
      para,
      asunto: 'Tu contraseña de RentCheck fue cambiada',
      texto: aviso,
      html: `<p>${aviso}</p>`,
    });
  }
}
