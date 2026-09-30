import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { normalizarCorreo } from '../../common/utils/normalizar-correo';

export class LoginArrendadorDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizarCorreo(value) : value,
  )
  @IsEmail()
  correo: string;

  @IsString()
  @IsNotEmpty()
  contrasena: string;
}
