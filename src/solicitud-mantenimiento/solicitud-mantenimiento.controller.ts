import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Res,
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
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
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
import { ClaveIdempotencia } from '../idempotencia/clave-idempotencia.decorator';
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
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Clave de idempotencia (8 a 128 caracteres [A-Za-z0-9_-]). La misma clave con el mismo contenido devuelve la misma solicitud con el encabezado Idempotent-Replayed: true; con distinto contenido responde 422 IDEMPOTENCY_KEY_REUTILIZADA.',
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
  async crear(
    @UploadedFile() adjunto: Express.Multer.File | undefined,
    @Body() dto: CrearSolicitudMantenimientoDto,
    @InquilinoActual() inquilinoId: string,
    @ClaveIdempotencia() claveIdempotencia: string | undefined,
    @Res({ passthrough: true }) respuesta: Response,
  ) {
    const { solicitud, reproducido } =
      await this.solicitudMantenimientoService.crear(
        dto,
        inquilinoId,
        adjunto,
        claveIdempotencia,
      );
    if (reproducido) {
      respuesta.setHeader('Idempotent-Replayed', 'true');
    }
    return solicitud;
  }

  @Get('mias')
  @ApiOperation({
    summary: 'Listar las solicitudes de mantenimiento del inquilino',
    description: 'OBSOLETO: usa GET /inquilino/solicitudes. Se retira en B0.5.',
    deprecated: true,
  })
  @ApiOkResponse({
    description:
      'Solicitudes de mantenimiento del inquilino ordenadas por fecha de creación.',
  })
  listarMias(@InquilinoActual() inquilinoId: string) {
    return this.solicitudMantenimientoService.listarMias(inquilinoId);
  }
}
