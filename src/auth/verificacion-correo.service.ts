import { Injectable } from '@nestjs/common';
import { PropositoCodigoCorreo } from '@prisma/client';
import { CodigoCorreoService } from '../correo/codigo-correo.service';
import { CorreoService } from '../correo/correo.service';
import { IntentosCodigoService } from '../contrato/intentos-codigo.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CodigoCorreoInvalidoException,
  esCodigoCorreoInvalido,
} from './codigo-correo-invalido.exception';
import { ReenviarVerificacionDto } from './dto/reenviar-verificacion.dto';
import { VerificarCorreoDto } from './dto/verificar-correo.dto';

export const MENSAJE_REENVIO =
  'Si el correo corresponde a una cuenta sin verificar, te enviamos un código.';

/**
 * Verificación del correo con código (D-10, parte 1). Solo funciona con un
 * proveedor de correo configurado; sin él responde 503 y el resto del sistema
 * queda como siempre.
 */
@Injectable()
export class VerificacionCorreoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly correo: CorreoService,
    private readonly codigos: CodigoCorreoService,
    private readonly intentos: IntentosCodigoService,
  ) {}

  capacidades() {
    const disponible = this.correo.correoDisponible();
    return {
      verificacion_correo: disponible,
      // La recuperación de contraseña la implementa B0.4-D2; depende del mismo proveedor.
      recuperacion_contrasena: disponible,
    };
  }

  /**
   * Reenvía el código SOLO si el correo es de una cuenta existente sin
   * verificar y no está en espera ni en el tope por hora. La respuesta no
   * depende de nada de eso.
   */
  async reenviar(dto: ReenviarVerificacionDto) {
    this.correo.exigirDisponible();
    const [arrendador, inquilino] = await Promise.all([
      this.prisma.arrendador.findUnique({
        where: { correo: dto.correo },
        select: { correo_verificado_en: true },
      }),
      this.prisma.inquilino.findUnique({
        where: { correo: dto.correo },
        select: { correo_verificado_en: true },
      }),
    ]);
    const sinVerificar = [arrendador, inquilino].some(
      (cuenta) => cuenta !== null && cuenta.correo_verificado_en === null,
    );
    if (sinVerificar) {
      await this.codigos.emitir(dto.correo, PropositoCodigoCorreo.VERIFICACION);
    }
    return { mensaje: MENSAJE_REENVIO };
  }

  /**
   * Verifica el correo con el código. El bloqueo por origen (IP) cuenta los
   * fallos; el código en sí admite 5 intentos y se consume al usarse.
   */
  verificar(dto: VerificarCorreoDto, ip: string) {
    this.correo.exigirDisponible();
    return this.intentos.ejecutar(
      `verificacion:${ip}`,
      async () => {
        const verificado = await this.codigos.verificar(
          dto.correo,
          PropositoCodigoCorreo.VERIFICACION,
          dto.codigo,
          async (tx) => {
            const ahora = new Date();
            const arrendador = await tx.arrendador.updateMany({
              where: { correo: dto.correo, correo_verificado_en: null },
              data: { correo_verificado_en: ahora },
            });
            const inquilino = await tx.inquilino.updateMany({
              where: { correo: dto.correo, correo_verificado_en: null },
              data: { correo_verificado_en: ahora },
            });
            // Sin cuenta (o ya verificada) el código no se gasta.
            return arrendador.count + inquilino.count > 0;
          },
        );
        if (!verificado) {
          throw new CodigoCorreoInvalidoException();
        }
        return { correo_verificado: true as const };
      },
      esCodigoCorreoInvalido,
    );
  }
}
