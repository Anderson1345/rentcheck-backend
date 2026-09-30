import { CanalConsola } from './canal-consola';
import { CanalCorreo } from './canal-correo.interface';
import { CanalDesactivado } from './canal-desactivado';
import { CanalResend } from './canal-resend';
import { ConfiguracionCorreo } from './correo.config';

export function crearCanalCorreo(config: ConfiguracionCorreo): CanalCorreo {
  switch (config.proveedor) {
    case 'consola':
      return new CanalConsola();
    case 'resend':
      return new CanalResend(config.resendApiKey ?? '', config.remitente ?? '');
    default:
      return new CanalDesactivado();
  }
}
