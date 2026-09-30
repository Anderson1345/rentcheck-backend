import { IsOptional, IsString } from 'class-validator';

/**
 * Datos del inquilino escritos en el contrato (B-35). Se normalizan y validan
 * en el servicio con las mismas reglas que `inquilino_nuevo` al crear.
 */
export class CorregirInquilinoContratoDto {
  @IsOptional()
  @IsString()
  nombre?: string;

  @IsOptional()
  @IsString()
  telefono?: string;

  @IsOptional()
  @IsString()
  cedula?: string;
}
