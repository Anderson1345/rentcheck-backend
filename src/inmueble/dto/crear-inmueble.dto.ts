import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CrearInmuebleDto {
  @IsString()
  @IsNotEmpty()
  direccion!: string;

  @IsString()
  @IsNotEmpty()
  ciudad!: string;

  @IsInt()
  @Min(1)
  @Max(6)
  estrato!: number;

  @IsString()
  @IsNotEmpty()
  matricula_inmobiliaria!: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional()
  foto_portada_ruta?: string;
}
