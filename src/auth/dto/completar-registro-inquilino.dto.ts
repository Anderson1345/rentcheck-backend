import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';

export class CompletarRegistroInquilinoDto {
  @ApiProperty({ example: 'ABC123' })
  @IsString()
  @IsNotEmpty()
  codigo: string;

  @ApiProperty({ example: 'inquilino@ejemplo.com' })
  @IsEmail()
  correo: string;

  @ApiProperty({ example: 'contrasena-segura' })
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message:
      'La contraseña debe tener al menos 8 caracteres, incluyendo al menos una letra y un número.',
  })
  contrasena: string;

  @ApiPropertyOptional({ example: 'https://ejemplo.com/cedula.jpg' })
  @IsOptional()
  @IsString()
  foto_cedula_url?: string;
}
