import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ActualizarPerfilArrendadorDto {
  @IsOptional()
  @IsString()
  @ApiPropertyOptional()
  nombre?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional()
  telefono?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional()
  cedula?: string;
}
