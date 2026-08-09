import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
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
}
