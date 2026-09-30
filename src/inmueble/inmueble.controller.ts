import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
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
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiQuery,
  ApiTags,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import {
  ArrendadorActual,
  ArrendadorGuard,
  JwtAuthGuard,
} from '../auth/auth.module';
import {
  TAMANO_MAXIMO_DOCUMENTO,
  TAMANO_MAXIMO_FOTO_INVENTARIO,
  TIPOS_ARCHIVO_DOCUMENTO,
  TIPOS_ARCHIVO_FOTO_INVENTARIO,
} from '../common/limites-archivo.constants';
import { interceptorFotoPerfil } from '../common/foto-perfil';
import { ParseIdPipe } from '../common/pipes/parse-id.pipe';
import { ActualizarInmuebleDto } from './dto/actualizar-inmueble.dto';
import { ActualizarUnidadDto } from './dto/actualizar-unidad.dto';
import { CrearDocumentoInmuebleDto } from './dto/crear-documento-inmueble.dto';
import { CrearInmuebleDto } from './dto/crear-inmueble.dto';
import { CrearUnidadDto } from './dto/crear-unidad.dto';
import { ListarDocumentosInmuebleQueryDto } from './dto/listar-documentos-inmueble-query.dto';
import { InmuebleService } from './inmueble.service';

@ApiTags('Inmuebles')
@Controller('inmuebles')
@UseGuards(JwtAuthGuard, ArrendadorGuard)
@ApiBearerAuth()
export class InmuebleController {
  private readonly logger = new Logger(InmuebleController.name);

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
    @Param('id', ParseIdPipe) id: string,
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
    @Param('id', ParseIdPipe) id: string,
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

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar un inmueble por ID' })
  @ApiOkResponse({ description: 'Inmueble eliminado exitosamente.' })
  @ApiNotFoundResponse({
    description: 'Inmueble no encontrado.',
  })
  @ApiConflictResponse({
    description: 'El inmueble tiene unidades asociadas y no puede eliminarse.',
  })
  async eliminar(
    @Param('id', ParseIdPipe) id: string,
    @ArrendadorActual() arrendadorId: string,
  ) {
    const inmueble = await this.inmuebleService.eliminar(id, arrendadorId);
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
    @Param('inmuebleId', ParseIdPipe) inmuebleId: string,
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
    @Param('inmuebleId', ParseIdPipe) inmuebleId: string,
    @Param('unidadId', ParseIdPipe) unidadId: string,
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

  @Delete(':inmuebleId/unidades/:unidadId')
  @ApiOperation({ summary: 'Eliminar una unidad por ID' })
  @ApiOkResponse({ description: 'Unidad eliminada exitosamente.' })
  @ApiNotFoundResponse({
    description: 'Inmueble o unidad no encontrada.',
  })
  @ApiConflictResponse({
    description: 'La unidad tiene contratos asociados y no puede eliminarse.',
  })
  async eliminarUnidad(
    @Param('inmuebleId', ParseIdPipe) inmuebleId: string,
    @Param('unidadId', ParseIdPipe) unidadId: string,
    @ArrendadorActual() arrendadorId: string,
  ) {
    const unidad = await this.inmuebleService.eliminarUnidad(
      inmuebleId,
      unidadId,
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
      storage: memoryStorage(),
      fileFilter: (_req, file, callback) => {
        if (!TIPOS_ARCHIVO_DOCUMENTO.includes(file.mimetype)) {
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
    @Param('inmuebleId', ParseIdPipe) inmuebleId: string,
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

  @Post(':id/foto-portada')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('foto', {
      storage: memoryStorage(),
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
  @ApiOperation({
    summary: 'Subir o reemplazar la foto de portada de un inmueble',
    description:
      'Sobrescribe la foto anterior en la misma ruta del bucket; nunca acumula archivos.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['foto'],
      properties: {
        foto: {
          type: 'string',
          format: 'binary',
          description: 'Foto de portada (JPEG o PNG).',
        },
      },
    },
  })
  @ApiOkResponse({
    description: 'Foto de portada subida y ruta actualizada.',
  })
  @ApiBadRequestResponse({ description: 'La foto es obligatoria.' })
  @ApiNotFoundResponse({
    description: 'Inmueble no encontrado o no pertenece al arrendador.',
  })
  @ApiUnsupportedMediaTypeResponse({
    description: 'El tipo de archivo de la foto no está permitido.',
  })
  async subirFotoPortada(
    @Param('id', ParseIdPipe) id: string,
    @UploadedFile() foto: Express.Multer.File,
    @ArrendadorActual() arrendadorId: string,
  ) {
    if (!foto) {
      throw new BadRequestException('La foto es obligatoria.');
    }

    const inmueble = await this.inmuebleService.subirFotoPortada(
      id,
      arrendadorId,
      foto,
    );
    if (!inmueble) {
      throw new NotFoundException(
        'Inmueble no encontrado o no pertenece al arrendador.',
      );
    }
    return inmueble;
  }

  @Post(':inmuebleId/unidades/:unidadId/foto-principal')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(interceptorFotoPerfil())
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Subir o reemplazar la foto principal de una unidad',
    description:
      'La ruta la genera el servidor. Al reemplazar se borra la foto anterior propia. Responde con la unidad y `foto_principal_url` firmada (nunca la ruta interna).',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['foto'],
      properties: {
        foto: {
          type: 'string',
          format: 'binary',
          description: 'Foto principal de la unidad (JPEG o PNG).',
        },
      },
    },
  })
  @ApiOkResponse({
    description:
      'Unidad con la foto principal firmada (null si el archivo no está disponible).',
  })
  @ApiBadRequestResponse({ description: 'La foto es obligatoria.' })
  @ApiNotFoundResponse({
    description:
      'Inmueble o unidad no encontrada o no pertenece al arrendador.',
  })
  @ApiUnsupportedMediaTypeResponse({
    description: 'El tipo de archivo de la foto no está permitido.',
  })
  async subirFotoPrincipalUnidad(
    @Param('inmuebleId', ParseIdPipe) inmuebleId: string,
    @Param('unidadId', ParseIdPipe) unidadId: string,
    @UploadedFile() foto: Express.Multer.File,
    @ArrendadorActual() arrendadorId: string,
  ) {
    if (!foto) {
      throw new BadRequestException('La foto es obligatoria.');
    }

    const unidad = await this.inmuebleService.subirFotoPrincipalUnidad(
      inmuebleId,
      unidadId,
      arrendadorId,
      foto,
    );
    if (!unidad) {
      throw new NotFoundException('Inmueble o unidad no encontrada.');
    }
    return unidad;
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
    @Param('inmuebleId', ParseIdPipe) inmuebleId: string,
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

  @Get(':id/descargar-documentos')
  @ApiOperation({
    summary: 'Descargar los documentos del inmueble en un ZIP',
    description:
      'Genera un archivo ZIP con los documentos del inmueble, los contratos de sus unidades y los comprobantes de pago (para declaración de renta). No incluye fotos de inventario.',
  })
  @ApiProduces('application/zip')
  @ApiOkResponse({
    description:
      'Archivo ZIP con los documentos del inmueble, enviado por flujo. Un archivo que no se pueda descargar se omite y se lista en LEEME_ARCHIVOS_NO_DISPONIBLES.txt dentro del ZIP.',
    content: {
      'application/zip': {
        schema: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Inmueble no encontrado o no pertenece al arrendador.',
  })
  async descargarDocumentos(
    @Param('id', ParseIdPipe) id: string,
    @ArrendadorActual() arrendadorId: string,
    @Res() res: Response,
  ) {
    const resultado = await this.inmuebleService.construirZipDocumentos(
      id,
      arrendadorId,
    );
    if (!resultado) {
      throw new NotFoundException(
        'Inmueble no encontrado o no pertenece al arrendador.',
      );
    }

    resultado.stream.on('error', (error) => {
      this.logger.error(
        `Error al transmitir el ZIP del inmueble ${id}`,
        error instanceof Error ? error.stack : String(error),
      );
      res.destroy(error);
    });

    // Si el cliente corta antes de terminar, se cierra el flujo: el servicio
    // aborta el ZIP y no descarga más archivos.
    res.once('close', () => {
      if (!res.writableFinished) {
        resultado.stream.destroy();
      }
    });
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${resultado.nombreArchivo}"`,
    });
    res.flushHeaders();
    resultado.stream.pipe(res);
  }
}
