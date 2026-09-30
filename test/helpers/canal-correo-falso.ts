import {
  CanalCorreo,
  MensajeCorreo,
} from '../../src/correo/canal-correo.interface';

/** Canal de correo de prueba: guarda los mensajes y puede simular una caída. */
export class CanalCorreoFalso implements CanalCorreo {
  readonly mensajes: MensajeCorreo[] = [];
  falla = false;

  correoDisponible(): boolean {
    return true;
  }

  enviar(mensaje: MensajeCorreo): Promise<void> {
    if (this.falla) {
      return Promise.reject(new Error('canal de correo caído (simulado)'));
    }
    this.mensajes.push(mensaje);
    return Promise.resolve();
  }

  para(correo: string): MensajeCorreo[] {
    return this.mensajes.filter((m) => m.para === correo);
  }

  /** Código de 6 dígitos del último mensaje enviado a ese correo. */
  ultimoCodigo(correo: string): string {
    const mensajes = this.para(correo);
    const texto = mensajes[mensajes.length - 1]?.texto ?? '';
    return /\b(\d{6})\b/.exec(texto)?.[1] ?? '';
  }
}
