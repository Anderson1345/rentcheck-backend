import { EstadoPago } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

export class ListarPagosQueryDto {
  @IsOptional()
  @IsEnum(EstadoPago)
  estado?: EstadoPago;
}
