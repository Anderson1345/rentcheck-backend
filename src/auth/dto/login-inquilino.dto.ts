import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { normalizarCorreo } from '../../common/utils/normalizar-correo';

export class LoginInquilinoDto {
  @ApiProperty({ example: 'inquilino@ejemplo.com' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizarCorreo(value) : value,
  )
  @IsEmail()
  correo: string;

  @ApiProperty({ example: 'contrasena-segura' })
  @IsString()
  @IsNotEmpty()
  contrasena: string;
}
