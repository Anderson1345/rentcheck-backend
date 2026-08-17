import {
  BadRequestException,
  Body,
  Controller,
  Get,
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
  ArrendadorActual,
  ArrendadorGuard,
  InquilinoActual,
  InquilinoGuard,
  JwtAuthGuard,
} from '../auth/auth.module';
import {
  TAMANO_MAXIMO_COMPROBANTE,
  TIPOS_ARCHIVO_COMPROBANTE,
} from '../common/limites-archivo.constants';
import { CrearPagoDto } from './dto/crear-pago.dto';
import { ListarPagosQueryDto } from './dto/listar-pagos-query.dto';
import { PagoService } from './pago.service';

@ApiTags('Pagos')
@Controller('pagos')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PagoController {
  constructor(private readonly pagoService: PagoService) {}

  @Get()
  @UseGuards(ArrendadorGuard)
  @ApiOperation({
    summary: 'Listar pagos del arrendador autenticado (cola de validación)',
  })
  @ApiOkResponse({
    description:
      'Lista de pagos con el contrato, la unidad y el inquilino relacionados.',
  })
  listar(
    @ArrendadorActual() arrendadorId: string,
    @Query() query: ListarPagosQueryDto,
  ) {
    return this.pagoService.listar(arrendadorId, query.estado);
  }

  @Get('mios')
  @UseGuards(InquilinoGuard)
  @ApiOperation({
    summary: 'Listar los pagos reportados por el inquilino autenticado',
  })
  @ApiOkResponse({
    description: 'Lista de pagos del inquilino con sus datos de contrato.',
  })
  listarMios(@InquilinoActual() inquilinoId: string) {
    return this.pagoService.listarMios(inquilinoId);
  }

  @Get(':id')
  @UseGuards(ArrendadorGuard)
  @ApiOperation({
    summary: 'Obtener el detalle de un pago por ID (arrendador)',
  })
  @ApiOkResponse({
    description: 'Detalle del pago con los datos relacionados.',
  })
  @ApiNotFoundResponse({
    description: 'Pago no encontrado o no pertenece al arrendador.',
  })
  encontrarUno(
    @Param('id') id: string,
    @ArrendadorActual() arrendadorId: string,
  ) {
    return this.pagoService.encontrarUno(id, arrendadorId);
  }

  @Patch(':id/aprobar')
  @UseGuards(ArrendadorGuard)
  @ApiOperation({ summary: 'Aprobar un pago pendiente del arrendador' })
  @ApiOkResponse({
    description: 'Pago aprobado y contrato marcado como al día.',
  })
  @ApiNotFoundResponse({
    description: 'Pago no encontrado o no pertenece al arrendador.',
  })
  @ApiConflictResponse({
    description: 'El pago ya fue procesado y no puede aprobarse ni rechazarse.',
  })
  aprobar(@Param('id') id: string, @ArrendadorActual() arrendadorId: string) {
    return this.pagoService.aprobar(id, arrendadorId);
  }

  @Patch(':id/rechazar')
  @UseGuards(ArrendadorGuard)
  @ApiOperation({ summary: 'Rechazar un pago pendiente del arrendador' })
  @ApiOkResponse({ description: 'Pago rechazado correctamente.' })
  @ApiNotFoundResponse({
    description: 'Pago no encontrado o no pertenece al arrendador.',
  })
  @ApiConflictResponse({
    description: 'El pago ya fue procesado y no puede aprobarse ni rechazarse.',
  })
  rechazar(@Param('id') id: string, @ArrendadorActual() arrendadorId: string) {
    return this.pagoService.rechazar(id, arrendadorId);
  }

  @Post()
  @UseGuards(InquilinoGuard)
  @UseInterceptors(
    FileInterceptor('comprobante', {
      storage: diskStorage({
        destination: (_req, _file, callback) => {
          const directorio = join(process.cwd(), 'uploads/comprobantes');
          mkdirSync(directorio, { recursive: true });
          callback(null, directorio);
        },
        filename: (_req, file, callback) => {
          const nombre = `${randomUUID()}${extname(file.originalname)}`;
          callback(null, nombre);
        },
      }),
      fileFilter: (_req, file, callback) => {
        if (!TIPOS_ARCHIVO_COMPROBANTE.includes(file.mimetype)) {
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
      limits: { fileSize: TAMANO_MAXIMO_COMPROBANTE },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Registrar un pago como inquilino' })
  @ApiBody({
    schema: {
      type: 'object',
      required: [
        'contratoId',
        'monto_centavos',
        'fecha_reportada',
        'comprobante',
      ],
      properties: {
        contratoId: {
          type: 'string',
          description: 'ID del contrato del inquilino autenticado.',
        },
        monto_centavos: {
          type: 'integer',
          description: 'Monto del pago expresado en centavos.',
        },
        fecha_reportada: {
          type: 'string',
          format: 'date',
          description: 'Fecha en la que se realizó el pago.',
        },
        comprobante: {
          type: 'string',
          format: 'binary',
          description: 'Comprobante de pago (JPEG, PNG o PDF).',
        },
      },
    },
  })
  @ApiCreatedResponse({ description: 'Pago creado exitosamente.' })
  @ApiBadRequestResponse({ description: 'Datos del formulario inválidos.' })
  @ApiNotFoundResponse({
    description: 'Contrato no encontrado o no pertenece al inquilino.',
  })
  @ApiConflictResponse({
    description:
      'El contrato del inquilino ya no está activo y no puede reportar pagos.',
  })
  @ApiUnsupportedMediaTypeResponse({
    description: 'El tipo de archivo del comprobante no está permitido.',
  })
  crear(
    @UploadedFile() comprobante: Express.Multer.File,
    @Body() dto: CrearPagoDto,
    @InquilinoActual() inquilinoId: string,
  ) {
    if (!comprobante) {
      throw new BadRequestException('El comprobante es obligatorio.');
    }

    return this.pagoService.crear(dto, inquilinoId, comprobante);
  }
}
