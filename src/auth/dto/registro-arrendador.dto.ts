import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { normalizarCorreo } from '../../common/utils/normalizar-correo';
import { ContrasenaValida } from '../contrasena.util';

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

  @ContrasenaValida()
  contrasena: string;
}
