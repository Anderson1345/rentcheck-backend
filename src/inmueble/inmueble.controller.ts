import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
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
import { ArrendadorActual, JwtAuthGuard } from '../auth/auth.module';
import { ActualizarInmuebleDto } from './dto/actualizar-inmueble.dto';
import { ActualizarUnidadDto } from './dto/actualizar-unidad.dto';
import { CrearDocumentoInmuebleDto } from './dto/crear-documento-inmueble.dto';
import { CrearInmuebleDto } from './dto/crear-inmueble.dto';
import { CrearUnidadDto } from './dto/crear-unidad.dto';
import { ListarDocumentosInmuebleQueryDto } from './dto/listar-documentos-inmueble-query.dto';
import { InmuebleService } from './inmueble.service';

const TIPOS_DE_ARCHIVO_PERMITIDOS = [
  'image/jpeg',
  'image/png',
  'application/pdf',
];
const TAMANO_MAXIMO_DOCUMENTO = 10 * 1024 * 1024;

@ApiTags('Inmuebles')
@Controller('inmuebles')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class InmuebleController {
  constructor(private readonly inmuebleService: InmuebleService) {}

  @Get()
  @ApiOperation({ summary: 'Listar inmuebles del arrendador autenticado' })
  @ApiOkResponse({
    description: 'Lista de inmuebles con sus unidades.',
  })
  listar(@ArrendadorActual() arrendadorId: string) {
    return this.inmuebleService.listar(arrendadorId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener detalle de un inmueble por ID' })
  @ApiOkResponse({
    description: 'Inmueble con sus unidades.',
  })
  @ApiNotFoundResponse({
    description: 'Inmueble no encontrado.',
  })
  async encontrarUno(
    @Param('id') id: string,
    @ArrendadorActual() arrendadorId: string,
  ) {
    const inmueble = await this.inmuebleService.encontrarUno(id, arrendadorId);
    if (!inmueble) {
      throw new NotFoundException('Inmueble no encontrado.');
    }
    return inmueble;
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar un inmueble por ID' })
  @ApiOkResponse({
    description: 'Inmueble actualizado con sus unidades.',
  })
  @ApiNotFoundResponse({
    description: 'Inmueble no encontrado.',
  })
  async actualizar(
    @Param('id') id: string,
    @Body() dto: ActualizarInmuebleDto,
    @ArrendadorActual() arrendadorId: string,
  ) {
    const inmueble = await this.inmuebleService.actualizar(
      id,
      dto,
      arrendadorId,
    );
    if (!inmueble) {
      throw new NotFoundException('Inmueble no encontrado.');
    }
    return inmueble;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear un inmueble con su unidad principal' })
  @ApiCreatedResponse({
    description: 'Inmueble creado exitosamente junto con su unidad principal.',
  })
  crear(
    @Body() dto: CrearInmuebleDto,
    @ArrendadorActual() arrendadorId: string,
  ) {
    return this.inmuebleService.crear(dto, arrendadorId);
  }

  @Post(':inmuebleId/unidades')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear una unidad dentro de un inmueble existente' })
  @ApiCreatedResponse({
    description: 'Unidad creada exitosamente.',
  })
  @ApiNotFoundResponse({
    description: 'Inmueble no encontrado o no pertenece al arrendador.',
  })
  async crearUnidad(
    @Param('inmuebleId') inmuebleId: string,
    @Body() dto: CrearUnidadDto,
    @ArrendadorActual() arrendadorId: string,
  ) {
    const unidad = await this.inmuebleService.crearUnidad(
      inmuebleId,
      dto,
      arrendadorId,
    );
    if (!unidad) {
      throw new NotFoundException('Inmueble no encontrado.');
    }
    return unidad;
  }

  @Patch(':inmuebleId/unidades/:unidadId')
  @ApiOperation({ summary: 'Actualizar una unidad por ID' })
  @ApiOkResponse({
    description: 'Unidad actualizada exitosamente.',
  })
  @ApiNotFoundResponse({
    description: 'Inmueble o unidad no encontrada.',
  })
  async actualizarUnidad(
    @Param('inmuebleId') inmuebleId: string,
    @Param('unidadId') unidadId: string,
    @Body() dto: ActualizarUnidadDto,
    @ArrendadorActual() arrendadorId: string,
  ) {
    const unidad = await this.inmuebleService.actualizarUnidad(
      inmuebleId,
      unidadId,
      dto,
      arrendadorId,
    );
    if (!unidad) {
      throw new NotFoundException('Inmueble o unidad no encontrada.');
    }
    return unidad;
  }

  @Post(':inmuebleId/documentos')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('archivo', {
      storage: diskStorage({
        destination: (_req, _file, callback) => {
          const directorio = join(process.cwd(), 'uploads/documentos-inmueble');
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
              'Tipo de archivo no permitido. Solo se aceptan imágenes JPEG, PNG o documentos PDF.',
            ),
            false,
          );
          return;
        }
        callback(null, true);
      },
      limits: { fileSize: TAMANO_MAXIMO_DOCUMENTO },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Subir un documento de un inmueble' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['tipo', 'archivo'],
      properties: {
        tipo: {
          type: 'string',
          enum: [
            'CERTIFICADO_TRADICION_LIBERTAD',
            'RECIBO_PREDIAL',
            'PAZ_Y_SALVO_ADMINISTRACION',
          ],
          description: 'Tipo de documento del inmueble.',
        },
        archivo: {
          type: 'string',
          format: 'binary',
          description: 'Documento (JPEG, PNG o PDF).',
        },
      },
    },
  })
  @ApiCreatedResponse({ description: 'Documento creado exitosamente.' })
  @ApiBadRequestResponse({ description: 'Datos del formulario inválidos.' })
  @ApiNotFoundResponse({
    description: 'Inmueble no encontrado o no pertenece al arrendador.',
  })
  @ApiUnsupportedMediaTypeResponse({
    description: 'El tipo de archivo del documento no está permitido.',
  })
  async crearDocumento(
    @Param('inmuebleId') inmuebleId: string,
    @UploadedFile() archivo: Express.Multer.File,
    @Body() dto: CrearDocumentoInmuebleDto,
    @ArrendadorActual() arrendadorId: string,
  ) {
    if (!archivo) {
      throw new BadRequestException('El archivo es obligatorio.');
    }

    const documento = await this.inmuebleService.crearDocumento(
      inmuebleId,
      arrendadorId,
      dto,
      archivo,
    );
    if (!documento) {
      throw new NotFoundException(
        'Inmueble no encontrado o no pertenece al arrendador.',
      );
    }
    return documento;
  }

  @Get(':inmuebleId/documentos')
  @ApiOperation({ summary: 'Listar documentos de un inmueble' })
  @ApiOkResponse({
    description: 'Documentos del inmueble ordenados por fecha de creación.',
  })
  @ApiQuery({
    name: 'tipo',
    required: false,
    enum: [
      'CERTIFICADO_TRADICION_LIBERTAD',
      'RECIBO_PREDIAL',
      'PAZ_Y_SALVO_ADMINISTRACION',
    ],
    description: 'Filtrar documentos por tipo.',
  })
  @ApiNotFoundResponse({
    description: 'Inmueble no encontrado o no pertenece al arrendador.',
  })
  async listarDocumentos(
    @Param('inmuebleId') inmuebleId: string,
    @Query() query: ListarDocumentosInmuebleQueryDto,
    @ArrendadorActual() arrendadorId: string,
  ) {
    const documentos = await this.inmuebleService.listarDocumentos(
      inmuebleId,
      arrendadorId,
      query.tipo,
    );
    if (!documentos) {
      throw new NotFoundException(
        'Inmueble no encontrado o no pertenece al arrendador.',
      );
    }
    return documentos;
  }
}
