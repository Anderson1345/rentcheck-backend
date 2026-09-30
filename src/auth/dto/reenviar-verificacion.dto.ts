import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail } from 'class-validator';
import { normalizarCorreo } from '../../common/utils/normalizar-correo';

export class ReenviarVerificacionDto {
  @ApiProperty({ example: 'persona@ejemplo.com' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizarCorreo(value) : value,
  )
  @IsEmail()
  correo!: string;
}
