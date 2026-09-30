import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';
import { normalizarCodigoAcceso } from '../../common/utils/codigo-acceso';

export class ValidarCodigoAccesoDto {
  @ApiProperty({ example: 'RC-AB3D-9KPX' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizarCodigoAcceso(value) : value,
  )
  @IsString()
  @IsNotEmpty()
  codigo: string;
}
