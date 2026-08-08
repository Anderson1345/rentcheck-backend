import { IsEnum } from 'class-validator';
import { TipoDocumentoInmueble } from '@prisma/client';

export class CrearDocumentoInmuebleDto {
  @IsEnum(TipoDocumentoInmueble)
  tipo!: TipoDocumentoInmueble;
}
