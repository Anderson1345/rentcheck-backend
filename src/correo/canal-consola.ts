import { Logger } from '@nestjs/common';
import { CanalCorreo, MensajeCorreo } from './canal-correo.interface';

/**
 * Escribe el mensaje (con el código) en el log. SOLO para desarrollo: la
 * configuración lo rechaza en producción.
 */
export class CanalConsola implements CanalCorreo {
  private readonly logger = new Logger('CanalCorreoConsola');

  enviar(mensaje: MensajeCorreo): Promise<void> {
    this.logger.log(
      `Correo para ${mensaje.para} | ${mensaje.asunto}\n${mensaje.texto}`,
    );
    return Promise.resolve();
  }

  correoDisponible(): boolean {
    return true;
  }
}
