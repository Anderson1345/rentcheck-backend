import { IsNotEmpty, IsString } from 'class-validator';

export class CrearInquilinoDto {
  @IsString()
  @IsNotEmpty()
  nombre!: string;

  @IsString()
  @IsNotEmpty()
  cedula!: string;

  @IsString()
  @IsNotEmpty()
  telefono!: string;
}
