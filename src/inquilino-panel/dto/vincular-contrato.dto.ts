import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';
import { normalizarCodigoAcceso } from '../../common/utils/codigo-acceso';

export class VincularContratoDto {
  @ApiProperty({
    example: 'RC-AB3D-9KPX',
    description: 'Código de acceso del contrato que la cuenta quiere agregar.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizarCodigoAcceso(value) : value,
  )
  @IsString()
  @IsNotEmpty()
  codigo!: string;
}
