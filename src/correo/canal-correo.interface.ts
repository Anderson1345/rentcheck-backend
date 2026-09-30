export interface MensajeCorreo {
  para: string;
  asunto: string;
  texto: string;
  html: string;
}

/** Canal por el que sale el correo; se elige con `CORREO_PROVEEDOR`. */
export interface CanalCorreo {
  enviar(mensaje: MensajeCorreo): Promise<void>;
  /** false solo en el canal `desactivado`: las funciones que dependen del correo no se ofrecen. */
  correoDisponible(): boolean;
}
