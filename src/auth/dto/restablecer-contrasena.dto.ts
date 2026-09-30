import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, Matches } from 'class-validator';
import { normalizarCorreo } from '../../common/utils/normalizar-correo';
import { ContrasenaValida } from '../contrasena.util';

export class RestablecerContrasenaDto {
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

  @ApiProperty({
    example: 'contrasena-nueva-1',
    description:
      'Mínimo 8 caracteres, con al menos una letra y un número (las mismas reglas del registro).',
  })
  @ContrasenaValida()
  nueva_contrasena!: string;
}
