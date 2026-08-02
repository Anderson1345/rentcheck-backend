import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class LoginArrendadorDto {
  @IsEmail()
  correo: string;

  @IsString()
  @IsNotEmpty()
  contrasena: string;
}
