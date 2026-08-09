import { IsNotEmpty, IsString } from 'class-validator';

export class SolicitarTerminacionAnticipadaDto {
  @IsString()
  @IsNotEmpty()
  motivo!: string;
}
