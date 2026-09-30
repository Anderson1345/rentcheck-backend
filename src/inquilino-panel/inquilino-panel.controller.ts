import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
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
import { SolicitarTerminacionAnticipadaDto } from './dto/solicitar-terminacion-anticipada.dto';
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
