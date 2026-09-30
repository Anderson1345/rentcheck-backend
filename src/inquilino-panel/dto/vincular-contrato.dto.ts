import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class VincularContratoDto {
  @ApiProperty({
    example: 'RC-2026-AB12',
    description: 'Código de acceso del contrato que la cuenta quiere agregar.',
  })
  @IsString()
  @IsNotEmpty()
  codigo!: string;
}
