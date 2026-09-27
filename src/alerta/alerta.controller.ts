import {
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  ArrendadorActual,
  ArrendadorGuard,
  JwtAuthGuard,
} from '../auth/auth.module';
import { ParseIdPipe } from '../common/pipes/parse-id.pipe';
import { AlertaService } from './alerta.service';
import { ListarAlertasQueryDto } from './dto/listar-alertas-query.dto';

@ApiTags('Alertas')
@Controller('alertas')
@UseGuards(JwtAuthGuard, ArrendadorGuard)
@ApiBearerAuth()
export class AlertaController {
  constructor(private readonly alertaService: AlertaService) {}

  @Get()
  @ApiOperation({ summary: 'Listar alertas del arrendador autenticado' })
  @ApiOkResponse({
    description: 'Alertas del arrendador ordenadas por fecha de creación.',
  })
  @ApiQuery({
    name: 'leida',
    required: false,
    type: 'boolean',
    description: 'Filtrar por alertas leídas o no leídas.',
  })
  listar(
    @ArrendadorActual() arrendadorId: string,
    @Query() query: ListarAlertasQueryDto,
  ) {
    return this.alertaService.listar(arrendadorId, query);
  }

  @Patch(':id/leida')
  @ApiOperation({ summary: 'Marcar una alerta como leída' })
  @ApiOkResponse({ description: 'Alerta marcada como leída.' })
  @ApiNotFoundResponse({
    description: 'Alerta no encontrada o no pertenece al arrendador.',
  })
  marcarComoLeida(
    @Param('id', ParseIdPipe) id: string,
    @ArrendadorActual() arrendadorId: string,
  ) {
    return this.alertaService.marcarComoLeida(id, arrendadorId);
  }
}
