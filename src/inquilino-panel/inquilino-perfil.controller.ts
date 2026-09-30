import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import {
  InquilinoActual,
  InquilinoGuard,
  JwtAuthGuard,
} from '../auth/auth.module';
import { interceptorFotoPerfil } from '../common/foto-perfil';
import { InquilinoPerfilService } from './inquilino-perfil.service';

@ApiTags('Panel del Inquilino')
@Controller('inquilino/perfil')
@UseGuards(JwtAuthGuard, InquilinoGuard)
@ApiBearerAuth()
export class InquilinoPerfilController {
  constructor(private readonly perfilService: InquilinoPerfilService) {}

  @Get()
  @ApiOperation({ summary: 'Obtener el perfil del inquilino autenticado' })
  @ApiOkResponse({
    description:
      'id, nombre, cedula, telefono, correo y foto_cedula_url (firmada, o null).',
  })
  verPerfil(@InquilinoActual() inquilinoId: string) {
    return this.perfilService.verPerfil(inquilinoId);
  }

  @Post('foto-cedula')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(interceptorFotoPerfil())
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Subir o reemplazar la foto de la cédula del inquilino',
    description:
      'La ruta la genera el servidor. Al reemplazar se borra la foto anterior propia. Responde con el perfil y `foto_cedula_url` firmada (nunca la ruta interna).',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['foto'],
      properties: {
        foto: {
          type: 'string',
          format: 'binary',
          description: 'Foto de la cédula (JPEG o PNG).',
        },
      },
    },
  })
  @ApiOkResponse({ description: 'Perfil con la foto de cédula firmada.' })
  @ApiBadRequestResponse({ description: 'La foto es obligatoria.' })
  @ApiUnsupportedMediaTypeResponse({
    description: 'El tipo de archivo de la foto no está permitido.',
  })
  subirFotoCedula(
    @UploadedFile() foto: Express.Multer.File,
    @InquilinoActual() inquilinoId: string,
  ) {
    if (!foto) {
      throw new BadRequestException('La foto es obligatoria.');
    }
    return this.perfilService.subirFotoCedula(inquilinoId, foto);
  }
}
