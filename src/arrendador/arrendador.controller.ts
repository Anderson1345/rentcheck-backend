import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Patch,
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
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import {
  ArrendadorActual,
  ArrendadorGuard,
  JwtAuthGuard,
} from '../auth/auth.module';
import { interceptorFotoPerfil } from '../common/foto-perfil';
import { ArrendadorService } from './arrendador.service';
import { ActualizarPerfilArrendadorDto } from './dto/actualizar-perfil-arrendador.dto';

@ApiTags('Arrendadores')
@Controller('arrendadores')
@UseGuards(JwtAuthGuard, ArrendadorGuard)
@ApiBearerAuth()
export class ArrendadorController {
  constructor(private readonly arrendadorService: ArrendadorService) {}

  @Get('perfil')
  @ApiOperation({ summary: 'Obtener el perfil del arrendador autenticado' })
  @ApiOkResponse({
    description:
      'Datos del arrendador: nombre, correo, telefono, cedula y foto de cedula/NIT.',
  })
  @ApiNotFoundResponse({ description: 'Arrendador no encontrado.' })
  async verPerfil(@ArrendadorActual() arrendadorId: string) {
    const perfil = await this.arrendadorService.verPerfil(arrendadorId);
    if (!perfil) {
      throw new NotFoundException('Arrendador no encontrado.');
    }
    return perfil;
  }

  @Post('perfil/foto-cedula')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(interceptorFotoPerfil())
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Subir o reemplazar la foto de la cédula/NIT del arrendador',
    description:
      'La ruta la genera el servidor. Al reemplazar se borra la foto anterior propia. Responde con el perfil y `foto_cedula_nit_url` firmada (nunca la ruta interna).',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['foto'],
      properties: {
        foto: {
          type: 'string',
          format: 'binary',
          description: 'Foto de la cédula o NIT (JPEG o PNG).',
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
    @ArrendadorActual() arrendadorId: string,
  ) {
    if (!foto) {
      throw new BadRequestException('La foto es obligatoria.');
    }
    return this.arrendadorService.subirFotoCedula(arrendadorId, foto);
  }

  @Patch('perfil')
  @ApiOperation({
    summary: 'Actualizar el perfil del arrendador autenticado',
    description:
      'Actualiza solo los campos recibidos (nombre, telefono, cedula). No permite cambiar el correo ni la contraseña.',
  })
  @ApiOkResponse({
    description: 'Arrendador actualizado sin contrasena_hash.',
  })
  @ApiNotFoundResponse({ description: 'Arrendador no encontrado.' })
  actualizarPerfil(
    @Body() dto: ActualizarPerfilArrendadorDto,
    @ArrendadorActual() arrendadorId: string,
  ) {
    return this.arrendadorService.actualizarPerfil(arrendadorId, dto);
  }
}
