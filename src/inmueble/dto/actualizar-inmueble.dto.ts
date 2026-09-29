import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ActualizarInmuebleDto {
  @IsOptional()
  @IsString()
  @ApiPropertyOptional()
  direccion?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional()
  ciudad?: string;

  /** `null` quita el estrato (solo si ninguna unidad es residencial). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(6)
  @ApiPropertyOptional()
  estrato?: number | null;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional()
  matricula_inmobiliaria?: string;
}
