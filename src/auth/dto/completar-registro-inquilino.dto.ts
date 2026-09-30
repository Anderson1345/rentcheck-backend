import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { normalizarCodigoAcceso } from '../../common/utils/codigo-acceso';
import { normalizarCorreo } from '../../common/utils/normalizar-correo';
import { ContrasenaValida } from '../contrasena.util';

export class CompletarRegistroInquilinoDto {
  @ApiProperty({ example: 'RC-AB3D-9KPX' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizarCodigoAcceso(value) : value,
  )
  @IsString()
  @IsNotEmpty()
  codigo: string;

  @ApiProperty({ example: 'inquilino@ejemplo.com' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizarCorreo(value) : value,
  )
  @IsEmail()
  correo: string;

  @ApiProperty({ example: 'contrasena-segura' })
  @ContrasenaValida()
  contrasena: string;
}
