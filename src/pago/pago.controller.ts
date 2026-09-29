import {
  BadRequestException,
  Body,
  Controller,
  Get,
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
import { ParseIdPipe } from '../common/pipes/parse-id.pipe';
import { ClaveIdempotencia } from '../idempotencia/clave-idempotencia.decorator';
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
    @Param('id', ParseIdPipe) id: string,
    @ArrendadorActual() arrendadorId: string,
  ) {
    return this.pagoService.encontrarUno(id, arrendadorId);
  }

  @Patch(':id/aprobar')
  @UseGuards(ArrendadorGuard)
  @ApiOperation({ summary: 'Aprobar un pago pendiente del arrendador' })
  @ApiOkResponse({
    description:
      'Pago aprobado; el estado de pago del contrato se recalcula a partir de sus períodos.',
  })
  @ApiNotFoundResponse({
    description: 'Pago no encontrado o no pertenece al arrendador.',
  })
  @ApiConflictResponse({
    description: 'El pago ya fue procesado y no puede aprobarse ni rechazarse.',
  })
  aprobar(
    @Param('id', ParseIdPipe) id: string,
    @ArrendadorActual() arrendadorId: string,
  ) {
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
  rechazar(
    @Param('id', ParseIdPipe) id: string,
    @ArrendadorActual() arrendadorId: string,
  ) {
    return this.pagoService.rechazar(id, arrendadorId);
  }

  @Post()
  @UseGuards(InquilinoGuard)
  @UseInterceptors(
    FileInterceptor('comprobante', {
      storage: memoryStorage(),
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
        periodo: {
          type: 'string',
          format: 'date',
          description:
            'Período (mes) que cubre el pago. Opcional: si no se envía, se usa el período no pagado más antiguo.',
        },
        comprobante: {
          type: 'string',
          format: 'binary',
          description: 'Comprobante de pago (JPEG, PNG o PDF).',
        },
      },
    },
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Clave de idempotencia (8 a 128 caracteres [A-Za-z0-9_-]). La misma clave con el mismo contenido devuelve el mismo pago con el encabezado Idempotent-Replayed: true; con distinto contenido responde 422 IDEMPOTENCY_KEY_REUTILIZADA.',
  })
  @ApiCreatedResponse({ description: 'Pago creado exitosamente.' })
  @ApiBadRequestResponse({
    description:
      'Datos del formulario inválidos, fecha_reportada anterior al inicio del contrato (FECHA_REPORTADA_ANTERIOR_A_INICIO) o periodo que no corresponde a ningún período del contrato (PERIODO_INVALIDO).',
  })
  @ApiNotFoundResponse({
    description: 'Contrato no encontrado o no pertenece al inquilino.',
  })
  @ApiConflictResponse({
    description:
      'El contrato ya no está activo y el período indicado no quedó pendiente al cierre (CONTRATO_NO_ACTIVO), no hay períodos pendientes (SIN_PERIODOS_PENDIENTES), o el período indicado ya está pagado (PERIODO_YA_PAGADO).',
  })
  @ApiUnsupportedMediaTypeResponse({
    description: 'El tipo de archivo del comprobante no está permitido.',
  })
  async crear(
    @UploadedFile() comprobante: Express.Multer.File,
    @Body() dto: CrearPagoDto,
    @InquilinoActual() inquilinoId: string,
    @ClaveIdempotencia() claveIdempotencia: string | undefined,
    @Res({ passthrough: true }) respuesta: Response,
  ) {
    if (!comprobante) {
      throw new BadRequestException('El comprobante es obligatorio.');
    }

    const { pago, reproducido } = await this.pagoService.crear(
      dto,
      inquilinoId,
      comprobante,
      claveIdempotencia,
    );
    if (reproducido) {
      respuesta.setHeader('Idempotent-Replayed', 'true');
    }
    return pago;
  }
}
