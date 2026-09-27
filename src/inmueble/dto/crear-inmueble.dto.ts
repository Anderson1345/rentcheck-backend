import { IsInt, IsNotEmpty, IsString, Max, Min } from 'class-validator';

export class CrearInmuebleDto {
  @IsString()
  @IsNotEmpty()
  direccion!: string;

  @IsString()
  @IsNotEmpty()
  ciudad!: string;

  @IsInt()
  @Min(1)
  @Max(6)
  estrato!: number;

  @IsString()
  @IsNotEmpty()
  matricula_inmobiliaria!: string;
}
