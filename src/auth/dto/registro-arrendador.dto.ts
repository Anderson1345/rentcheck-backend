import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';
import { normalizarCorreo } from '../../common/utils/normalizar-correo';

export class RegistroArrendadorDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizarCorreo(value) : value,
  )
  @IsEmail()
  correo: string;

  @IsString()
  @IsNotEmpty()
  telefono: string;

  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message:
      'La contraseña debe tener al menos 8 caracteres, incluyendo al menos una letra y un número.',
  })
  contrasena: string;
}
