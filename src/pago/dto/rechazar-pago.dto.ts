import { BadRequestException } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { MotivoRechazoPago } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

/** Tope del mensaje del rechazo (B-59). */
export const MAXIMO_MENSAJE_RECHAZO = 200;

/**
 * Cuerpo OPCIONAL de `PATCH /pagos/:id/rechazar`: sin cuerpo el pago queda RECHAZADO sin motivo, como
 * antes. Reglas entre campos (ver `validarReglasMotivoRechazo`): un mensaje exige motivo
 * (400 `MOTIVO_REQUERIDO`) y el motivo `OTRO` exige un mensaje (400 `MENSAJE_REQUERIDO`).
 */
export class RechazarPagoDto {
  /** Motivo de una lista fija. Opcional. */
  @ApiPropertyOptional({
    enum: MotivoRechazoPago,
    enumName: 'MotivoRechazoPago',
  })
  @IsOptional()
  @IsEnum(MotivoRechazoPago)
  motivo?: MotivoRechazoPago;

  /**
   * Mensaje opcional para el inquilino, de 1 a 200 caracteres tras recortar espacios. Un mensaje en
   * blanco cuenta como no enviado.
   */
  @ApiPropertyOptional({ minLength: 1, maxLength: MAXIMO_MENSAJE_RECHAZO })
  @Transform(({ value }): unknown => {
    if (typeof value !== 'string') return value;
    const recortado = value.trim();
    return recortado === '' ? undefined : recortado;
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAXIMO_MENSAJE_RECHAZO)
  mensaje?: string;
}

/**
 * Reglas que dependen de los dos campos a la vez. Se revisan ANTES de tocar la base: si fallan, no se
 * escribe nada.
 */
export function validarReglasMotivoRechazo(dto: RechazarPagoDto): void {
  if (dto.mensaje !== undefined && dto.motivo === undefined) {
    throw new BadRequestException({
      codigo: 'MOTIVO_REQUERIDO',
      mensaje: 'Para enviar un mensaje del rechazo debes indicar el motivo.',
    });
  }
  if (dto.motivo === MotivoRechazoPago.OTRO && dto.mensaje === undefined) {
    throw new BadRequestException({
      codigo: 'MENSAJE_REQUERIDO',
      mensaje:
        'Con el motivo OTRO debes escribir un mensaje que explique el rechazo.',
    });
  }
}
