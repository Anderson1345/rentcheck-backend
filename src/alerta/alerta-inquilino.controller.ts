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
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  InquilinoActual,
  InquilinoGuard,
  JwtAuthGuard,
} from '../auth/auth.module';
import { ParseIdPipe } from '../common/pipes/parse-id.pipe';
import { AlertaService } from './alerta.service';
import {
  AlertaDto,
  ConteoAlertasDto,
  FeedAlertasDto,
  MarcadasDto,
} from './dto/alerta-respuesta.dto';
import { FeedAlertasQueryDto } from './dto/feed-alertas-query.dto';

const SIN_SESION = 'Sin sesión, con un token vencido o de otro rol.';

@ApiTags('Alertas del inquilino')
@Controller('inquilino/alertas')
@UseGuards(JwtAuthGuard, InquilinoGuard)
@ApiBearerAuth()
export class AlertaInquilinoController {
  constructor(private readonly alertaService: AlertaService) {}

  @Get()
  @ApiOperation({
    summary: 'Feed de alertas del inquilino (paginado por cursor)',
    description:
      'Más recientes primero. `no_leidas` es el total de no leídas del inquilino, con o sin filtro. `recurso` dice a dónde navegar (pago, solicitud de mantenimiento, período o contrato).',
  })
  @ApiOkResponse({ type: FeedAlertasDto })
  @ApiBadRequestResponse({
    description:
      '400 VALIDACION: `limite` fuera de 1 a 50, `leida` que no es booleano o `cursor` inválido.',
  })
  @ApiUnauthorizedResponse({ description: SIN_SESION })
  feed(
    @InquilinoActual() inquilinoId: string,
    @Query() query: FeedAlertasQueryDto,
  ) {
    return this.alertaService.feed({ inquilino_id: inquilinoId }, query);
  }

  @Get('conteo')
  @ApiOperation({ summary: 'Cuántas alertas sin leer tiene el inquilino' })
  @ApiOkResponse({ type: ConteoAlertasDto })
  @ApiUnauthorizedResponse({ description: SIN_SESION })
  async conteo(
    @InquilinoActual() inquilinoId: string,
  ): Promise<ConteoAlertasDto> {
    return {
      no_leidas: await this.alertaService.contar({
        inquilino_id: inquilinoId,
      }),
    };
  }

  @Patch('leidas')
  @ApiOperation({
    summary: 'Marcar como leídas todas las alertas del inquilino',
    description: 'Solo las propias y solo las que seguían sin leer.',
  })
  @ApiOkResponse({ type: MarcadasDto })
  @ApiUnauthorizedResponse({ description: SIN_SESION })
  marcarTodasLeidas(@InquilinoActual() inquilinoId: string) {
    return this.alertaService.marcarTodasLeidas({ inquilino_id: inquilinoId });
  }

  @Patch(':id/leida')
  @ApiOperation({
    summary: 'Marcar una alerta del inquilino como leída',
    description: 'Idempotente: marcar una ya leída devuelve la misma alerta.',
  })
  @ApiOkResponse({ type: AlertaDto })
  @ApiUnauthorizedResponse({ description: SIN_SESION })
  @ApiNotFoundResponse({
    description: 'Alerta inexistente o de otro usuario (no se distingue).',
  })
  marcarLeida(
    @Param('id', ParseIdPipe) id: string,
    @InquilinoActual() inquilinoId: string,
  ) {
    return this.alertaService.marcarLeida({ inquilino_id: inquilinoId }, id);
  }
}
