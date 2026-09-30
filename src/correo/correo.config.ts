export type ProveedorCorreo = 'desactivado' | 'consola' | 'resend';

export interface ConfiguracionCorreo {
  proveedor: ProveedorCorreo;
  remitente?: string;
  resendApiKey?: string;
}

const PROVEEDORES: readonly ProveedorCorreo[] = [
  'desactivado',
  'consola',
  'resend',
];

/**
 * Lee y valida las variables de correo. Sin `CORREO_PROVEEDOR` (o vacía) el
 * proveedor es `desactivado`: el sistema queda exactamente como sin correo.
 * Un error aquí impide el arranque; los mensajes nombran las variables pero
 * nunca imprimen sus valores.
 */
export function leerConfiguracionCorreo(
  env: Record<string, string | undefined>,
): ConfiguracionCorreo {
  const valor = env.CORREO_PROVEEDOR?.trim();
  const proveedor = (valor ? valor : 'desactivado') as ProveedorCorreo;

  if (!PROVEEDORES.includes(proveedor)) {
    throw new Error(
      `CORREO_PROVEEDOR no es válido: usa ${PROVEEDORES.join(', ')} (o deja la variable sin definir).`,
    );
  }

  if (proveedor === 'consola' && env.NODE_ENV === 'production') {
    throw new Error(
      'CORREO_PROVEEDOR=consola no se permite en producción (escribiría los códigos en el log). Usa resend o deja la variable sin definir.',
    );
  }

  if (proveedor === 'resend') {
    const resendApiKey = env.RESEND_API_KEY?.trim();
    const remitente = env.CORREO_REMITENTE?.trim();
    if (!resendApiKey) {
      throw new Error('CORREO_PROVEEDOR=resend requiere RESEND_API_KEY.');
    }
    if (!remitente) {
      throw new Error('CORREO_PROVEEDOR=resend requiere CORREO_REMITENTE.');
    }
    return { proveedor, remitente, resendApiKey };
  }

  return { proveedor };
}
