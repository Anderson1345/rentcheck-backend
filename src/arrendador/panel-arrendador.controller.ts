import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  ArrendadorActual,
  ArrendadorGuard,
  JwtAuthGuard,
} from '../auth/auth.module';
import { PanelArrendadorDto } from './dto/panel-arrendador.dto';
import { PanelArrendadorService } from './panel-arrendador.service';

@ApiTags('Panel del Arrendador')
@Controller('arrendadores')
@UseGuards(JwtAuthGuard, ArrendadorGuard)
@ApiBearerAuth()
export class PanelArrendadorController {
  constructor(private readonly panelService: PanelArrendadorService) {}

  @Get('panel')
  @ApiOperation({
    summary: 'Panel del arrendador (mes actual de Bogotá)',
    description:
      'Todo lo que muestra el Panel en una sola respuesta de solo lectura: ingresos del mes, recaudo esperado frente al real (aprobado, en revisión y sin reportar), ocupación, cartera en mora, tendencia de ingresos de 6 meses y centro de pendientes. Todo se calcula al día de hoy en America/Bogota y solo con los datos del arrendador autenticado. No recibe parámetros.',
  })
  @ApiOkResponse({
    type: PanelArrendadorDto,
    description:
      'El Panel del arrendador. Dinero en centavos; fechas de día `AAAA-MM-DD`; meses `AAAA-MM`. Un arrendador sin datos recibe todo en cero y la tendencia con sus 6 meses.',
  })
  @ApiUnauthorizedResponse({
    description: 'Sin sesión, con un token vencido o de otro rol.',
  })
  obtener(@ArrendadorActual() arrendadorId: string) {
    return this.panelService.obtener(arrendadorId);
  }
}
