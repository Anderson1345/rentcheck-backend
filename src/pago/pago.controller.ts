import {
  BadRequestException,
  Body,
  Controller,
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
  ApiConsumes,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import { randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { InquilinoActual, JwtAuthGuard } from '../auth/auth.module';
import { CrearPagoDto } from './dto/crear-pago.dto';
import { PagoService } from './pago.service';

const TIPOS_DE_ARCHIVO_PERMITIDOS = [
  'image/jpeg',
  'image/png',
  'application/pdf',
];
const TAMANO_MAXIMO_COMPROBANTE = 10 * 1024 * 1024;

@ApiTags('Pagos')
@Controller('pagos')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PagoController {
  constructor(private readonly pagoService: PagoService) {}

  @Post()
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
