import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class LoginInquilinoDto {
  @ApiProperty({ example: 'inquilino@ejemplo.com' })
  @IsEmail()
  correo: string;

  @ApiProperty({ example: 'contrasena-segura' })
  @IsString()
  @IsNotEmpty()
  contrasena: string;
}
