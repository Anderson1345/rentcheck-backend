import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import {
  InquilinoActual,
  InquilinoGuard,
  JwtAuthGuard,
} from '../auth/auth.module';
import {
  TAMANO_MAXIMO_ADJUNTO,
  TIPOS_ARCHIVO_ADJUNTO,
} from '../common/limites-archivo.constants';
import { CrearSolicitudMantenimientoDto } from './dto/crear-solicitud-mantenimiento.dto';
import { SolicitudMantenimientoService } from './solicitud-mantenimiento.service';

@ApiTags('Solicitudes de Mantenimiento')
@Controller('solicitudes-mantenimiento')
@UseGuards(JwtAuthGuard, InquilinoGuard)
@ApiBearerAuth()
export class SolicitudMantenimientoController {
  constructor(
    private readonly solicitudMantenimientoService: SolicitudMantenimientoService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('adjunto', {
      storage: memoryStorage(),
      fileFilter: (_req, file, callback) => {
        if (!TIPOS_ARCHIVO_ADJUNTO.includes(file.mimetype)) {
          callback(
            new UnsupportedMediaTypeException(
              'Tipo de archivo no permitido. Solo se aceptan imágenes JPEG, PNG o video MP4.',
            ),
            false,
          );
          return;
        }
        callback(null, true);
      },
      limits: { fileSize: TAMANO_MAXIMO_ADJUNTO },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Reportar una solicitud de mantenimiento como inquilino',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['unidadId', 'descripcion', 'urgencia'],
      properties: {
        unidadId: {
          type: 'string',
          description: 'ID de la unidad sobre la que se reporta.',
        },
        descripcion: {
          type: 'string',
          description: 'Descripción de la solicitud de mantenimiento.',
        },
        urgencia: {
          type: 'string',
          enum: ['BAJO', 'MEDIO', 'ALTO'],
          description: 'Nivel de urgencia de la solicitud.',
        },
        adjunto: {
          type: 'string',
          format: 'binary',
          description: 'Foto o video de evidencia (opcional).',
        },
      },
    },
  })
  @ApiCreatedResponse({
    description: 'Solicitud de mantenimiento creada exitosamente.',
  })
  @ApiBadRequestResponse({ description: 'Datos del formulario inválidos.' })
  @ApiNotFoundResponse({
    description: 'No existe un contrato del inquilino en esa unidad.',
  })
  @ApiConflictResponse({
    description:
      'El contrato del inquilino ya no está activo y no puede reportar solicitudes.',
  })
  @ApiUnsupportedMediaTypeResponse({
    description: 'El tipo de archivo del adjunto no está permitido.',
  })
  crear(
    @UploadedFile() adjunto: Express.Multer.File | undefined,
    @Body() dto: CrearSolicitudMantenimientoDto,
    @InquilinoActual() inquilinoId: string,
  ) {
    return this.solicitudMantenimientoService.crear(dto, inquilinoId, adjunto);
  }

  @Get('mias')
  @ApiOperation({
    summary: 'Listar las solicitudes de mantenimiento del inquilino',
  })
  @ApiOkResponse({
    description:
      'Solicitudes de mantenimiento del inquilino ordenadas por fecha de creación.',
  })
  listarMias(@InquilinoActual() inquilinoId: string) {
    return this.solicitudMantenimientoService.listarMias(inquilinoId);
  }
}
