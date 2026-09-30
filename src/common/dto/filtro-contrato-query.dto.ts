import { IsOptional, IsUUID } from 'class-validator';

/** Filtro opcional `?contratoId=` de los listados del portal del inquilino. */
export class FiltroContratoQueryDto {
  @IsOptional()
  @IsUUID()
  contratoId?: string;
}
