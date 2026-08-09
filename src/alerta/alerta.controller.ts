import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
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
import { AlertaSchedulerService } from './alerta-scheduler.service';
import { AlertaService } from './alerta.service';
import { ListarAlertasQueryDto } from './dto/listar-alertas-query.dto';

@ApiTags('Alertas')
@Controller('alertas')
@UseGuards(JwtAuthGuard, ArrendadorGuard)
@ApiBearerAuth()
export class AlertaController {
  constructor(
    private readonly alertaService: AlertaService,
    private readonly alertaSchedulerService: AlertaSchedulerService,
  ) {}

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
    @Param('id') id: string,
    @ArrendadorActual() arrendadorId: string,
  ) {
    return this.alertaService.marcarComoLeida(id, arrendadorId);
  }

  // ENDPOINT TEMPORAL DE PRUEBA: permite ejecutar manualmente el cron de
  // vencimiento de contratos sin esperar a la medianoche. Eliminar en producción.
  @Post('ejecutar-cron-vencimiento')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      '[TEMPORAL] Ejecutar manualmente el cron de alertas de contratos por vencer',
  })
  @ApiOkResponse({
    description: 'Resultado de la ejecución manual del cron.',
  })
  ejecutarCronVencimiento() {
    return this.alertaSchedulerService.ejecutarVencimiento();
  }

  // ENDPOINT TEMPORAL DE PRUEBA: permite ejecutar manualmente el cron de
  // recordatorio de pago sin esperar a la medianoche. Eliminar en producción.
  @Post('ejecutar-cron-recordatorio-pago')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[TEMPORAL] Ejecutar manualmente el cron de recordatorio de pago',
  })
  @ApiOkResponse({
    description: 'Resultado de la ejecución manual del cron.',
  })
  ejecutarCronRecordatorioPago() {
    return this.alertaSchedulerService.ejecutarRecordatorioPago();
  }

  // ENDPOINT TEMPORAL DE PRUEBA: permite ejecutar manualmente el cron de
  // mantenimiento sin atender sin esperar a la medianoche. Eliminar en producción.
  @Post('ejecutar-cron-mantenimiento')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      '[TEMPORAL] Ejecutar manualmente el cron de mantenimiento sin atender',
  })
  @ApiOkResponse({
    description: 'Resultado de la ejecución manual del cron.',
  })
  ejecutarCronMantenimiento() {
    return this.alertaSchedulerService.ejecutarMantenimientoSinAtender();
  }

  // ENDPOINT TEMPORAL DE PRUEBA: permite ejecutar manualmente el cron de
  // ajuste de IPC sin esperar a la medianoche. Eliminar en producción.
  @Post('ejecutar-cron-ipc')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[TEMPORAL] Ejecutar manualmente el cron de ajuste de IPC',
  })
  @ApiOkResponse({
    description: 'Resultado de la ejecución manual del cron.',
  })
  ejecutarCronIpc() {
    return this.alertaSchedulerService.ejecutarAjusteIpcPendiente();
  }

  // ENDPOINT TEMPORAL DE PRUEBA: permite ejecutar manualmente el cron de
  // mora de inquilinos sin esperar a la medianoche. Eliminar en producción.
  @Post('ejecutar-cron-mora')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[TEMPORAL] Ejecutar manualmente el cron de mora de inquilinos',
  })
  @ApiOkResponse({
    description: 'Resultado de la ejecución manual del cron.',
  })
  ejecutarCronMora() {
    return this.alertaSchedulerService.ejecutarInquilinoEnMora();
  }
}
