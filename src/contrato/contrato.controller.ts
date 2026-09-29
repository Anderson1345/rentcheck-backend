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
  ApiBadRequestResponse,
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
import { AplicarIncrementoDto } from './dto/aplicar-incremento.dto';
import { CrearContratoDto } from './dto/crear-contrato.dto';
import { ProrrogarContratoDto } from './dto/prorrogar-contrato.dto';
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

  @Post(':id/aplicar-incremento')
  @ApiOperation({
    summary: 'Aplicar el incremento anual del canon',
    description:
      'Solo si pasaron 12 meses desde el último incremento (o desde el inicio). Usa el IPC del año calendario anterior; en vivienda el porcentaje no puede superarlo. No cambia la fecha de fin ni el PDF.',
  })
  @ApiCreatedResponse({
    description: 'Contrato con el canon nuevo e incremento registrado.',
  })
  @ApiBadRequestResponse({
    description:
      'PORCENTAJE_SUPERIOR_AL_IPC (vivienda) o cuerpo inválido (VALIDACION).',
  })
  @ApiNotFoundResponse({
    description: 'Contrato no encontrado o no pertenece al arrendador.',
  })
  @ApiConflictResponse({
    description:
      'CONTRATO_NO_ACTIVO, INCREMENTO_ANTES_DE_12_MESES, IPC_NO_CONFIGURADO o INCREMENTO_YA_APLICADO.',
  })
  aplicarIncremento(
    @Param('id', ParseIdPipe) id: string,
    @Body() dto: AplicarIncrementoDto,
    @ArrendadorActual() arrendadorId: string,
  ) {
    return this.contratoService.aplicarIncremento(id, arrendadorId, dto);
  }

  @Post(':id/prorrogar')
  @ApiOperation({
    summary: 'Prorrogar el contrato',
    description:
      'Solo dentro de los 90 días previos al vencimiento. Alarga la fecha de fin (por defecto, por el término inicial) sin cambiar el canon ni el PDF, y registra la prórroga.',
  })
  @ApiCreatedResponse({
    description: 'Contrato con la nueva fecha de fin y prórroga registrada.',
  })
  @ApiBadRequestResponse({ description: 'Cuerpo inválido (VALIDACION).' })
  @ApiNotFoundResponse({
    description: 'Contrato no encontrado o no pertenece al arrendador.',
  })
  @ApiConflictResponse({
    description:
      'CONTRATO_NO_ACTIVO, PRORROGA_FUERA_DE_VENTANA o PRORROGA_YA_APLICADA.',
  })
  prorrogar(
    @Param('id', ParseIdPipe) id: string,
    @Body() dto: ProrrogarContratoDto,
    @ArrendadorActual() arrendadorId: string,
  ) {
    return this.contratoService.prorrogar(id, arrendadorId, dto);
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
