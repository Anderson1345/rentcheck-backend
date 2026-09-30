import { IsOptional, IsString, MaxLength } from 'class-validator';

export class AvisoNoRenovacionDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  motivo?: string;
}
