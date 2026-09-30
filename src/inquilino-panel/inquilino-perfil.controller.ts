import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Body,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Request } from 'express';
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
import { validarCamposDePerfil } from './campos-perfil';
import { ActualizarPerfilInquilinoDto } from './dto/actualizar-perfil-inquilino.dto';
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
      'id, nombre, cedula, telefono, correo y foto_cedula_url (firmada, o null si no hay foto o el archivo no está disponible).',
  })
  verPerfil(@InquilinoActual() inquilinoId: string) {
    return this.perfilService.verPerfil(inquilinoId);
  }

  @Patch()
  @ApiOperation({
    summary: 'Cambiar el nombre y el teléfono del perfil del inquilino',
    description:
      'Solo nombre y teléfono (mismas reglas que al escribirlos en un contrato: texto no vacío, sin espacios sobrantes). Cualquier otro campo (cedula, correo, contrasena, id...) es 400 CAMPO_NO_EDITABLE con la lista de rechazados; un cuerpo sin campos, 400 SIN_CAMPOS. Solo modifica el perfil de la persona: los contratos, sus versiones de PDF y las copias de datos que el arrendador escribió NO cambian (lo firmado se conserva). Responde con el mismo formato que GET /inquilino/perfil.',
  })
  @ApiBody({ type: ActualizarPerfilInquilinoDto })
  @ApiOkResponse({
    description:
      'Perfil actualizado: id, nombre, cedula, telefono, correo y foto_cedula_url (firmada, o null si no hay foto o el archivo no está disponible).',
  })
  @ApiBadRequestResponse({
    description: 'VALIDACION, SIN_CAMPOS o CAMPO_NO_EDITABLE.',
  })
  actualizarPerfil(
    @Body() dto: ActualizarPerfilInquilinoDto,
    @Req() peticion: Request,
    @InquilinoActual() inquilinoId: string,
  ) {
    validarCamposDePerfil(peticion.body);
    return this.perfilService.actualizarPerfil(inquilinoId, dto);
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
