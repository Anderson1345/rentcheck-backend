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
import {
  ArrendadorActual,
  ArrendadorGuard,
  JwtAuthGuard,
} from '../auth/auth.module';
import { ContratoService } from './contrato.service';
import { CrearContratoDto } from './dto/crear-contrato.dto';

@ApiTags('Contratos')
@Controller('contratos')
@UseGuards(JwtAuthGuard, ArrendadorGuard)
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
    description:
      'Detalle completo del contrato e historial de incrementos IPC.',
  })
  @ApiNotFoundResponse({
    description: 'Contrato no encontrado o no pertenece al arrendador.',
  })
  async encontrarUno(
    @Param('id') id: string,
    @ArrendadorActual() arrendadorId: string,
  ) {
    const contrato = await this.contratoService.encontrarUno(id, arrendadorId);
    if (!contrato) {
      throw new NotFoundException('Contrato no encontrado.');
    }
    return contrato;
  }

  @Post(':id/renovar')
  @ApiOperation({
    summary: 'Renovar un contrato activo aplicando el IPC vigente',
  })
  @ApiOkResponse({
    description: 'Contrato renovado e incremento IPC registrado exitosamente.',
  })
  @ApiNotFoundResponse({
    description: 'Contrato no encontrado o no pertenece al arrendador.',
  })
  @ApiConflictResponse({
    description: 'El contrato no está activo y no puede renovarse.',
  })
  renovar(@Param('id') id: string, @ArrendadorActual() arrendadorId: string) {
    return this.contratoService.renovar(id, arrendadorId);
  }

  @Post(':id/regenerar-codigo')
  @ApiOperation({ summary: 'Regenerar el código de acceso de un contrato' })
  @ApiOkResponse({ description: 'Código de acceso regenerado exitosamente.' })
  @ApiNotFoundResponse({
    description:
      'Contrato no encontrado, no pertenece al arrendador o no tiene código de acceso.',
  })
  regenerarCodigo(
    @Param('id') id: string,
    @ArrendadorActual() arrendadorId: string,
  ) {
    return this.contratoService.regenerarCodigo(id, arrendadorId);
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
