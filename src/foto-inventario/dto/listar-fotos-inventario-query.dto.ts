import { Momento } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

export class ListarFotosInventarioQueryDto {
  @IsOptional()
  @IsEnum(Momento)
  momento?: Momento;
}
