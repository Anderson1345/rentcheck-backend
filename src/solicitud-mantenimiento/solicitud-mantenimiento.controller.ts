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
import { randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import {
  InquilinoActual,
  InquilinoGuard,
  JwtAuthGuard,
} from '../auth/auth.module';
import { CrearSolicitudMantenimientoDto } from './dto/crear-solicitud-mantenimiento.dto';
import { SolicitudMantenimientoService } from './solicitud-mantenimiento.service';

const TIPOS_DE_ARCHIVO_PERMITIDOS = ['image/jpeg', 'image/png', 'video/mp4'];
const TAMANO_MAXIMO_ADJUNTO = 20 * 1024 * 1024;

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
      storage: diskStorage({
        destination: (_req, _file, callback) => {
          const directorio = join(
            process.cwd(),
            'uploads/solicitudes-mantenimiento',
          );
          mkdirSync(directorio, { recursive: true });
          callback(null, directorio);
        },
        filename: (_req, file, callback) => {
          const nombre = `${randomUUID()}${extname(file.originalname)}`;
          callback(null, nombre);
        },
      }),
      fileFilter: (_req, file, callback) => {
        if (!TIPOS_DE_ARCHIVO_PERMITIDOS.includes(file.mimetype)) {
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
