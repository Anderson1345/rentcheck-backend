import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, Matches } from 'class-validator';
import { normalizarCorreo } from '../../common/utils/normalizar-correo';

export class VerificarCorreoDto {
  @ApiProperty({ example: 'persona@ejemplo.com' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizarCorreo(value) : value,
  )
  @IsEmail()
  correo!: string;

  @ApiProperty({ example: '482913', description: 'Código de 6 dígitos.' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @Matches(/^\d{6}$/, { message: 'El código debe tener 6 dígitos.' })
  codigo!: string;
}
