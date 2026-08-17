import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
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
  ApiConsumes,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import { randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import {
  ArrendadorActual,
  ArrendadorGuard,
  JwtAuthGuard,
} from '../auth/auth.module';
import {
  TAMANO_MAXIMO_FOTO_INVENTARIO,
  TIPOS_ARCHIVO_FOTO_INVENTARIO,
} from '../common/limites-archivo.constants';
import { CrearFotoInventarioDto } from './dto/crear-foto-inventario.dto';
import { ListarFotosInventarioQueryDto } from './dto/listar-fotos-inventario-query.dto';
import { FotoInventarioService } from './foto-inventario.service';

@ApiTags('Contratos')
@Controller('contratos')
@UseGuards(JwtAuthGuard, ArrendadorGuard)
@ApiBearerAuth()
export class FotoInventarioController {
  constructor(private readonly fotoInventarioService: FotoInventarioService) {}

  @Post(':contratoId/fotos-inventario')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('foto', {
      storage: diskStorage({
        destination: (_req, _file, callback) => {
          const directorio = join(process.cwd(), 'uploads/fotos-inventario');
          mkdirSync(directorio, { recursive: true });
          callback(null, directorio);
        },
        filename: (_req, file, callback) => {
          const nombre = `${randomUUID()}${extname(file.originalname)}`;
          callback(null, nombre);
        },
      }),
      fileFilter: (_req, file, callback) => {
        if (!TIPOS_ARCHIVO_FOTO_INVENTARIO.includes(file.mimetype)) {
          callback(
            new UnsupportedMediaTypeException(
              'Tipo de archivo no permitido. Solo se aceptan imágenes JPEG o PNG.',
            ),
            false,
          );
          return;
        }
        callback(null, true);
      },
      limits: { fileSize: TAMANO_MAXIMO_FOTO_INVENTARIO },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Subir una foto de inventario de un contrato' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['momento', 'zona', 'foto'],
      properties: {
        momento: {
          type: 'string',
          enum: ['ENTREGA', 'DEVOLUCION'],
          description: 'Momento del inventario (entrega o devolución).',
        },
        zona: {
          type: 'string',
          description: 'Zona del inmueble fotografiada (ej. Cocina).',
        },
        foto: {
          type: 'string',
          format: 'binary',
          description: 'Foto de la zona (JPEG o PNG).',
        },
      },
    },
  })
  @ApiCreatedResponse({
    description: 'Foto de inventario creada exitosamente.',
  })
  @ApiBadRequestResponse({ description: 'Datos del formulario inválidos.' })
  @ApiNotFoundResponse({
    description: 'Contrato no encontrado o no pertenece al arrendador.',
  })
  @ApiUnsupportedMediaTypeResponse({
    description: 'El tipo de archivo de la foto no está permitido.',
  })
  crear(
    @Param('contratoId') contratoId: string,
    @UploadedFile() foto: Express.Multer.File,
    @Body() dto: CrearFotoInventarioDto,
    @ArrendadorActual() arrendadorId: string,
  ) {
    if (!foto) {
      throw new BadRequestException('La foto es obligatoria.');
    }

    return this.fotoInventarioService.crear(
      contratoId,
      arrendadorId,
      dto,
      foto,
    );
  }

  @Get(':contratoId/fotos-inventario')
  @ApiOperation({ summary: 'Listar fotos de inventario de un contrato' })
  @ApiOkResponse({
    description:
      'Fotos de inventario del contrato ordenadas por momento, zona y fecha de creación.',
  })
  @ApiQuery({
    name: 'momento',
    required: false,
    enum: ['ENTREGA', 'DEVOLUCION'],
    description: 'Filtrar fotos por momento.',
  })
  @ApiNotFoundResponse({
    description: 'Contrato no encontrado o no pertenece al arrendador.',
  })
  listar(
    @Param('contratoId') contratoId: string,
    @Query() query: ListarFotosInventarioQueryDto,
    @ArrendadorActual() arrendadorId: string,
  ) {
    return this.fotoInventarioService.listar(
      contratoId,
      arrendadorId,
      query.momento,
    );
  }
}
