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
import { interceptorContenidoArchivo } from '../common/validar-contenido-archivo';
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
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
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
import { SolicitudCreadaDto } from './dto/solicitud-respuesta.dto';
import { SolicitudMantenimientoService } from './solicitud-mantenimiento.service';

// Los límites del adjunto se documentan desde las constantes (una sola fuente de verdad).
const MAXIMO_ADJUNTO_MB = TAMANO_MAXIMO_ADJUNTO / (1024 * 1024);
const TIPOS_ADJUNTO_TEXTO = (() => {
  const tipos = TIPOS_ARCHIVO_ADJUNTO.map((t) => t.split('/')[1].toUpperCase());
  return `${tipos.slice(0, -1).join(', ')} o ${tipos[tipos.length - 1]}`;
})();

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
    interceptorContenidoArchivo(TIPOS_ARCHIVO_ADJUNTO),
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
          description: `Foto o video de evidencia (opcional): un solo archivo, ${TIPOS_ADJUNTO_TEXTO}, hasta ${MAXIMO_ADJUNTO_MB} MB. El contenido real debe coincidir con el tipo declarado.`,
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
    type: SolicitudCreadaDto,
    description:
      'Solicitud de mantenimiento creada exitosamente (la misma respuesta, con `Idempotent-Replayed: true`, si se repite la clave con el mismo contenido). `adjunto_url` es una URL firmada que caduca; `adjunto_tipo` dice si es IMAGEN o VIDEO.',
  })
  @ApiBadRequestResponse({
    description:
      'Datos del formulario inválidos (VALIDACION) o Idempotency-Key con formato inválido (IDEMPOTENCY_KEY_INVALIDA).',
  })
  @ApiNotFoundResponse({
    description: 'No existe un contrato del inquilino en esa unidad.',
  })
  @ApiConflictResponse({
    description:
      'El contrato del inquilino no está activo y no puede reportar solicitudes (CONTRATO_NO_ACTIVO), o ya hay una solicitud en proceso con la misma Idempotency-Key (SOLICITUD_EN_PROCESO).',
  })
  @ApiUnsupportedMediaTypeResponse({
    description:
      'El tipo de archivo del adjunto no está permitido, o su contenido real no coincide con el tipo declarado (ARCHIVO_CONTENIDO_INVALIDO).',
  })
  @ApiPayloadTooLargeResponse({
    description: `El adjunto pesa más de ${MAXIMO_ADJUNTO_MB} MB (CARGA_DEMASIADO_GRANDE).`,
  })
  @ApiUnprocessableEntityResponse({
    description:
      'La misma Idempotency-Key ya se usó con un contenido distinto (IDEMPOTENCY_KEY_REUTILIZADA).',
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
