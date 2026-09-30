import { Inject, Injectable } from '@nestjs/common';
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

  /** Envía el código de verificación. Sin enlaces y nunca con contraseñas. */
  enviarCodigoVerificacion(para: string, codigo: string): Promise<void> {
    const vigencia = `Vence en ${VIGENCIA_CODIGO_MINUTOS} minutos.`;
    const ignorar = 'Si no fuiste tú, ignora este mensaje.';
    return this.canal.enviar({
      para,
      asunto: 'Tu código de verificación de RentCheck',
      texto: `Tu código de verificación de RentCheck es: ${codigo}\n\n${vigencia}\n\n${ignorar}`,
      html: `<p>Tu código de verificación de RentCheck es:</p><p style="font-size:24px;letter-spacing:4px"><strong>${codigo}</strong></p><p>${vigencia}</p><p>${ignorar}</p>`,
    });
  }
}
