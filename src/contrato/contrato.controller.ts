import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ArrendadorActual, JwtAuthGuard } from '../auth/auth.module';
import { ContratoService } from './contrato.service';
import { CrearContratoDto } from './dto/crear-contrato.dto';

@ApiTags('Contratos')
@Controller('contratos')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ContratoController {
  constructor(private readonly contratoService: ContratoService) {}

  @Get()
  @ApiOperation({ summary: 'Listar contratos del arrendador autenticado' })
  @ApiOkResponse({
    description: 'Lista de contratos con su unidad e inquilino relacionados.',
  })
  listar(@ArrendadorActual() arrendadorId: string) {
    return this.contratoService.listar(arrendadorId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener el detalle de un contrato por ID' })
  @ApiOkResponse({
    description: 'Detalle completo del contrato e historial de incrementos IPC.',
  })
  @ApiNotFoundResponse({
    description: 'Contrato no encontrado o no pertenece al arrendador.',
  })
  async encontrarUno(
    @Param('id') id: string,
    @ArrendadorActual() arrendadorId: string,
  ) {
    const contrato = await this.contratoService.encontrarUno(
      id,
      arrendadorId,
    );
    if (!contrato) {
      throw new NotFoundException('Contrato no encontrado.');
    }
    return contrato;
  }

  @Post()
  @ApiOperation({ summary: 'Crear un contrato' })
  @ApiCreatedResponse({
    description:
      'Contrato creado exitosamente, incluyendo su código de acceso generado.',
  })
  @ApiNotFoundResponse({
    description: 'La unidad o el inquilino no pertenecen al arrendador.',
  })
  @ApiConflictResponse({
    description: 'La unidad ya tiene un contrato activo.',
  })
  crear(
    @Body() dto: CrearContratoDto,
    @ArrendadorActual() arrendadorId: string,
  ) {
    return this.contratoService.crear(dto, arrendadorId);
  }
}
