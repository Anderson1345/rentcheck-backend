/** Token de inyección del canal de correo (se sustituye en las pruebas). */
export const CANAL_CORREO = Symbol('CANAL_CORREO');

/** Vigencia de un código enviado por correo. */
export const VIGENCIA_CODIGO_MINUTOS = 10;
/** Máximo de intentos por código; al llegar a este número el código se consume. */
export const MAX_INTENTOS_CODIGO = 5;
/** Espera mínima entre dos envíos al mismo correo y propósito. */
export const ESPERA_ENTRE_ENVIOS_SEGUNDOS = 60;
/** Máximo de envíos por hora al mismo correo y propósito. */
export const MAX_ENVIOS_POR_HORA = 5;
