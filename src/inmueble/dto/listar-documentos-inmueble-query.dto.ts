import { TipoDocumentoInmueble } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

export class ListarDocumentosInmuebleQueryDto {
  @IsOptional()
  @IsEnum(TipoDocumentoInmueble)
  tipo?: TipoDocumentoInmueble;
}
