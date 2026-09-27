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
import { ParseIdPipe } from '../common/pipes/parse-id.pipe';
import { ContratoService } from './contrato.service';
import { CrearContratoDto } from './dto/crear-contrato.dto';
import { SolicitarTerminacionAnticipadaDto } from './dto/solicitar-terminacion-anticipada.dto';

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
    @Param('id', ParseIdPipe) id: string,
    @ArrendadorActual() arrendadorId: string,
  ) {
    const contrato = await this.contratoService.encontrarUno(id, arrendadorId);
    if (!contrato) {
      throw new NotFoundException('Contrato no encontrado.');
    }
    return contrato;
  }

  @Get(':id/estado-cuenta')
  @ApiOperation({ summary: 'Obtener el estado de cuenta de un contrato' })
  @ApiOkResponse({
    description: 'Estado de pago derivado y períodos calculados.',
  })
  @ApiNotFoundResponse({
    description: 'Contrato no encontrado o no pertenece al arrendador.',
  })
  async obtenerEstadoCuenta(
    @Param('id', ParseIdPipe) id: string,
    @ArrendadorActual() arrendadorId: string,
  ) {
    const estadoCuenta = await this.contratoService.obtenerEstadoCuenta(
      id,
      arrendadorId,
    );
    if (!estadoCuenta) {
      throw new NotFoundException('Contrato no encontrado.');
    }
    return estadoCuenta;
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
  renovar(
    @Param('id', ParseIdPipe) id: string,
    @ArrendadorActual() arrendadorId: string,
  ) {
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
    @Param('id', ParseIdPipe) id: string,
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

  @Post(':id/solicitar-terminacion-anticipada')
  @ApiOperation({
    summary: 'Solicitar la terminación anticipada de un contrato',
  })
  @ApiOkResponse({
    description: 'Solicitud de terminación anticipada registrada.',
  })
  @ApiNotFoundResponse({
    description: 'Contrato no encontrado o no pertenece al arrendador.',
  })
  @ApiConflictResponse({
    description:
      'El contrato no está activo o ya tiene una solicitud de terminación anticipada pendiente.',
  })
  solicitarTerminacionAnticipada(
    @Param('id', ParseIdPipe) id: string,
    @Body() dto: SolicitarTerminacionAnticipadaDto,
    @ArrendadorActual() arrendadorId: string,
  ) {
    return this.contratoService.solicitarTerminacionAnticipada(
      id,
      arrendadorId,
      dto.motivo,
    );
  }

  @Post(':id/confirmar-terminacion-anticipada')
  @ApiOperation({
    summary: 'Confirmar la terminación anticipada de un contrato',
  })
  @ApiOkResponse({
    description: 'Terminación anticipada confirmada y contrato finalizado.',
  })
  @ApiNotFoundResponse({
    description: 'Contrato no encontrado o no pertenece al arrendador.',
  })
  @ApiConflictResponse({
    description:
      'No hay una solicitud de terminación anticipada pendiente para confirmar.',
  })
  confirmarTerminacionAnticipada(
    @Param('id', ParseIdPipe) id: string,
    @ArrendadorActual() arrendadorId: string,
  ) {
    return this.contratoService.confirmarTerminacionAnticipada(
      id,
      arrendadorId,
    );
  }
}
