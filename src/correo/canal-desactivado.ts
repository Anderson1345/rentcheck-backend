import { CanalCorreo } from './canal-correo.interface';

/** No envía nada: la verificación de correo no se ofrece. */
export class CanalDesactivado implements CanalCorreo {
  enviar(): Promise<void> {
    return Promise.resolve();
  }

  correoDisponible(): boolean {
    return false;
  }
}
