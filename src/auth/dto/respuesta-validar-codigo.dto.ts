import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RespuestaValidarCodigoDto {
  @ApiProperty({
    description:
      'true si la persona ya tiene cuenta: debe iniciar sesión y agregar el código desde la app (POST /inquilino/contratos/vincular).',
  })
  requiere_inicio_sesion!: boolean;

  @ApiProperty({ example: 'Puede continuar completando su registro.' })
  mensaje!: string;

  @ApiPropertyOptional({
    description:
      'Nombre tal como lo escribió el arrendador en el contrato (solo si no hay cuenta).',
  })
  nombreInquilino?: string;

  @ApiPropertyOptional({ description: 'Solo si no hay cuenta.' })
  nombreUnidad?: string;

  @ApiPropertyOptional({ description: 'Solo si no hay cuenta.' })
  direccionInmueble?: string;
}
