import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { Momento } from '@prisma/client';

export class CrearFotoInventarioDto {
  @IsEnum(Momento)
  momento!: Momento;

  @IsString()
  @IsNotEmpty()
  zona!: string;
}
