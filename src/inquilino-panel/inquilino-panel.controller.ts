import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
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
  InquilinoActual,
  InquilinoGuard,
  JwtAuthGuard,
} from '../auth/auth.module';
import { AvisoNoRenovacionDto } from '../contrato/dto/aviso-no-renovacion.dto';
import { SolicitarTerminacionAnticipadaDto } from './dto/solicitar-terminacion-anticipada.dto';
import { VincularContratoDto } from './dto/vincular-contrato.dto';
import { InquilinoPanelService } from './inquilino-panel.service';

@ApiTags('Panel del Inquilino')
@Controller('inquilino')
@UseGuards(JwtAuthGuard, InquilinoGuard)
@ApiBearerAuth()
export class InquilinoPanelController {
  constructor(private readonly inquilinoPanelService: InquilinoPanelService) {}

  @Get('mi-panel')
  @ApiOperation({ summary: 'Obtener el panel del inquilino autenticado' })
  @ApiOkResponse({
    description: 'Datos del próximo pago y estado del contrato.',
  })
  @ApiNotFoundResponse({
    description: 'El inquilino autenticado no tiene ningún contrato.',
  })
  obtenerMiPanel(@InquilinoActual() inquilinoId: string) {
    return this.inquilinoPanelService.obtenerMiPanel(inquilinoId);
  }

  @Get('mi-contrato')
  @ApiOperation({
    summary: 'Obtener las condiciones del contrato del inquilino autenticado',
  })
  @ApiOkResponse({
    description:
      'Condiciones económicas, incrementos IPC, PDF y fotos de entrega.',
  })
  @ApiNotFoundResponse({
    description: 'El inquilino autenticado no tiene ningún contrato.',
  })
  obtenerMiContrato(@InquilinoActual() inquilinoId: string) {
    return this.inquilinoPanelService.obtenerMiContrato(inquilinoId);
  }

  @Get('mi-contrato/estado-cuenta')
  @ApiOperation({
    summary:
      'Obtener el estado de cuenta del contrato del inquilino autenticado',
  })
  @ApiOkResponse({
    description: 'Estado de pago derivado y períodos calculados.',
  })
  @ApiNotFoundResponse({
    description: 'El inquilino autenticado no tiene ningún contrato.',
  })
  obtenerEstadoCuenta(@InquilinoActual() inquilinoId: string) {
    return this.inquilinoPanelService.obtenerEstadoCuenta(inquilinoId);
  }

  @Post('contratos/vincular')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary: 'Agregar un contrato con su código de acceso',
    description:
      'La cuenta autenticada vincula el contrato del código. Un contrato solo aparece en el portal después de vincularlo. Un código inexistente, de otra cuenta o de un contrato cancelado recibe la misma respuesta (404). Idempotente para la misma cuenta. Un contrato PROGRAMADO vincula pero no muestra datos de recaudo hasta estar ACTIVO.',
  })
  @ApiOkResponse({
    description:
      'Resumen del contrato: id, estado, fechas, vinculado_en, datos_recaudo (solo si está ACTIVO), unidad e inmueble.',
  })
  @ApiNotFoundResponse({ description: 'Código de acceso no válido.' })
  vincularContrato(
    @Body() dto: VincularContratoDto,
    @InquilinoActual() inquilinoId: string,
  ) {
    return this.inquilinoPanelService.vincularContrato(inquilinoId, dto.codigo);
  }

  @Post('mi-contrato/solicitar-terminacion-anticipada')
  @ApiOperation({
    summary: 'Solicitar la terminación anticipada (mutuo acuerdo)',
    description:
      'Requiere motivo y fecha efectiva (entre hoy y la fecha de fin, sin ser anterior al inicio). La confirma el arrendador; el inquilino puede cancelar mientras no esté confirmada.',
  })
  @ApiCreatedResponse({
    description: 'Contrato con el resumen `terminacion_anticipada`.',
  })
  @ApiNotFoundResponse({
    description: 'El inquilino autenticado no tiene ningún contrato.',
  })
  @ApiConflictResponse({
    description: 'CONTRATO_NO_ACTIVO o TERMINACION_YA_SOLICITADA.',
  })
  solicitarTerminacionAnticipada(
    @Body() dto: SolicitarTerminacionAnticipadaDto,
    @InquilinoActual() inquilinoId: string,
  ) {
    return this.inquilinoPanelService.solicitarTerminacionAnticipada(
      inquilinoId,
      dto.motivo,
      dto.fecha_efectiva,
    );
  }

  @Post('mi-contrato/aviso-no-renovacion')
  @ApiOperation({
    summary: 'Dar aviso de no renovación',
    description:
      'Con aviso vigente, al llegar la fecha de fin el contrato vence; sin aviso se prorroga automáticamente (D-1). Solo con el contrato ACTIVO y antes de su último día.',
  })
  @ApiCreatedResponse({
    description: 'Contrato con el resumen `aviso_no_renovacion`.',
  })
  @ApiNotFoundResponse({
    description: 'El inquilino autenticado no tiene ningún contrato.',
  })
  @ApiConflictResponse({
    description: 'CONTRATO_NO_ACTIVO, AVISO_FUERA_DE_PLAZO o AVISO_YA_DADO.',
  })
  darAvisoNoRenovacion(
    @Body() dto: AvisoNoRenovacionDto,
    @InquilinoActual() inquilinoId: string,
  ) {
    return this.inquilinoPanelService.darAvisoNoRenovacion(
      inquilinoId,
      dto.motivo,
    );
  }

  @Post('mi-contrato/cancelar-aviso-no-renovacion')
  @ApiOperation({ summary: 'Cancelar el aviso de no renovación propio' })
  @ApiCreatedResponse({
    description: 'Contrato con el resumen `aviso_no_renovacion`.',
  })
  @ApiNotFoundResponse({
    description: 'El inquilino autenticado no tiene ningún contrato.',
  })
  @ApiConflictResponse({
    description: 'CONTRATO_NO_ACTIVO, AVISO_FUERA_DE_PLAZO o AVISO_NO_DADO.',
  })
  cancelarAvisoNoRenovacion(@InquilinoActual() inquilinoId: string) {
    return this.inquilinoPanelService.cancelarAvisoNoRenovacion(inquilinoId);
  }

  @Post('mi-contrato/confirmar-terminacion-anticipada')
  @ApiOperation({
    summary: 'Confirmar la terminación anticipada solicitada por el arrendador',
  })
  @ApiCreatedResponse({
    description: 'Contrato con el resumen `terminacion_anticipada`.',
  })
  @ApiNotFoundResponse({
    description: 'El inquilino autenticado no tiene ningún contrato.',
  })
  @ApiConflictResponse({
    description:
      'CONTRATO_NO_ACTIVO, TERMINACION_NO_SOLICITADA o TERMINACION_YA_CONFIRMADA.',
  })
  confirmarTerminacionAnticipada(@InquilinoActual() inquilinoId: string) {
    return this.inquilinoPanelService.confirmarTerminacionAnticipada(
      inquilinoId,
    );
  }

  @Post('mi-contrato/cancelar-terminacion-anticipada')
  @ApiOperation({
    summary: 'Cancelar la solicitud de terminación anticipada propia',
  })
  @ApiCreatedResponse({
    description: 'Contrato con el resumen `terminacion_anticipada`.',
  })
  @ApiNotFoundResponse({
    description: 'El inquilino autenticado no tiene ningún contrato.',
  })
  @ApiConflictResponse({
    description:
      'CONTRATO_NO_ACTIVO, TERMINACION_NO_SOLICITADA o TERMINACION_YA_CONFIRMADA.',
  })
  cancelarTerminacionAnticipada(@InquilinoActual() inquilinoId: string) {
    return this.inquilinoPanelService.cancelarTerminacionAnticipada(
      inquilinoId,
    );
  }
}
