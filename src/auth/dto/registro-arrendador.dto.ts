import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class RegistroArrendadorDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsEmail()
  correo: string;

  @IsString()
  @IsNotEmpty()
  telefono: string;

  @IsString()
  @MinLength(8)
  contrasena: string;
}
