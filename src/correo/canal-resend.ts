import { CanalCorreo, MensajeCorreo } from './canal-correo.interface';

const URL_RESEND = 'https://api.resend.com/emails';
const TIEMPO_MAXIMO_MS = 10_000;

/**
 * Envío por la API HTTP de Resend (POST /emails con Bearer y JSON
 * `{ from, to, subject, text, html }`). Los errores nunca incluyen la clave ni
 * el contenido del mensaje (que lleva el código).
 */
export class CanalResend implements CanalCorreo {
  constructor(
    private readonly apiKey: string,
    private readonly remitente: string,
  ) {}

  async enviar(mensaje: MensajeCorreo): Promise<void> {
    let respuesta: Response;
    try {
      respuesta = await fetch(URL_RESEND, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.remitente,
          to: mensaje.para,
          subject: mensaje.asunto,
          text: mensaje.texto,
          html: mensaje.html,
        }),
        signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
      });
    } catch {
      throw new Error('No se pudo contactar con Resend.');
    }
    if (!respuesta.ok) {
      // Solo el estado: el cuerpo de la respuesta puede repetir datos enviados.
      throw new Error(`Resend rechazó el envío (HTTP ${respuesta.status}).`);
    }
  }

  correoDisponible(): boolean {
    return true;
  }
}
