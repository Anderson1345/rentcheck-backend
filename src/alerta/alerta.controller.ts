import {
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  ArrendadorActual,
  ArrendadorGuard,
  JwtAuthGuard,
} from '../auth/auth.module';
import { ParseIdPipe } from '../common/pipes/parse-id.pipe';
import { AlertaService } from './alerta.service';
import {
  ConteoAlertasDto,
  FeedAlertasDto,
  MarcadasDto,
} from './dto/alerta-respuesta.dto';
import { FeedAlertasQueryDto } from './dto/feed-alertas-query.dto';
import { ListarAlertasQueryDto } from './dto/listar-alertas-query.dto';

@ApiTags('Alertas')
@Controller('alertas')
@UseGuards(JwtAuthGuard, ArrendadorGuard)
@ApiBearerAuth()
export class AlertaController {
  constructor(private readonly alertaService: AlertaService) {}

  @Get('feed')
  @ApiOperation({
    summary: 'Feed de alertas del arrendador (paginado por cursor)',
    description:
      'Más recientes primero. `no_leidas` es el total de no leídas del arrendador, con o sin filtro. `recurso` dice a dónde navegar (pago, solicitud de mantenimiento, período o contrato).',
  })
  @ApiOkResponse({ type: FeedAlertasDto })
  @ApiBadRequestResponse({
    description:
      '400 VALIDACION: `limite` fuera de 1 a 50, `leida` que no es booleano o `cursor` inválido.',
  })
  @ApiUnauthorizedResponse({
    description: 'Sin sesión, con un token vencido o de otro rol.',
  })
  feed(
    @ArrendadorActual() arrendadorId: string,
    @Query() query: FeedAlertasQueryDto,
  ) {
    return this.alertaService.feed({ arrendador_id: arrendadorId }, query);
  }

  @Get('conteo')
  @ApiOperation({ summary: 'Cuántas alertas sin leer tiene el arrendador' })
  @ApiOkResponse({ type: ConteoAlertasDto })
  @ApiUnauthorizedResponse({
    description: 'Sin sesión, con un token vencido o de otro rol.',
  })
  async conteo(
    @ArrendadorActual() arrendadorId: string,
  ): Promise<ConteoAlertasDto> {
    return {
      no_leidas: await this.alertaService.contar({
        arrendador_id: arrendadorId,
      }),
    };
  }

  @Patch('leidas')
  @ApiOperation({
    summary: 'Marcar como leídas todas las alertas del arrendador',
    description: 'Solo las propias y solo las que seguían sin leer.',
  })
  @ApiOkResponse({ type: MarcadasDto })
  @ApiUnauthorizedResponse({
    description: 'Sin sesión, con un token vencido o de otro rol.',
  })
  marcarTodasLeidas(@ArrendadorActual() arrendadorId: string) {
    return this.alertaService.marcarTodasLeidas({
      arrendador_id: arrendadorId,
    });
  }

  @Get()
  @ApiOperation({
    summary: 'Listar alertas del arrendador autenticado',
    deprecated: true,
    description:
      'OBSOLETO: usar `GET /alertas/feed` (paginado, con contador y recurso). Se conserva sin cambios para clientes antiguos.',
  })
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
