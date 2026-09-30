import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
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
import { FiltroContratoQueryDto } from '../common/dto/filtro-contrato-query.dto';
import { ParseIdPipe } from '../common/pipes/parse-id.pipe';
import { SolicitudMantenimientoService } from './solicitud-mantenimiento.service';

@ApiTags('Solicitudes de Mantenimiento')
@Controller('inquilino/solicitudes')
@UseGuards(JwtAuthGuard, InquilinoGuard)
@ApiBearerAuth()
export class InquilinoSolicitudesController {
  constructor(
    private readonly solicitudMantenimientoService: SolicitudMantenimientoService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Listar las solicitudes de mantenimiento del inquilino',
    description:
      'Solo las de unidades donde el inquilino tiene un contrato vinculado. Con `?contratoId=` solo las de la unidad de ese contrato (404 si el contrato no es suyo, no está vinculado o está cancelado).',
  })
  @ApiOkResponse({
    description:
      'Solicitudes ordenadas de la más reciente a la más antigua, con `adjunto_url` firmada (null si el archivo no está disponible).',
  })
  @ApiNotFoundResponse({ description: 'El contrato del filtro no es válido.' })
  listar(
    @InquilinoActual() inquilinoId: string,
    @Query() query: FiltroContratoQueryDto,
  ) {
    return this.solicitudMantenimientoService.listarMias(
      inquilinoId,
      query.contratoId,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de una solicitud de mantenimiento propia' })
  @ApiOkResponse({
    description:
      'La solicitud con `adjunto_url` firmada (null si el archivo no está disponible).',
  })
  @ApiNotFoundResponse({
    description:
      'La solicitud no existe, es de otro inquilino o su unidad no tiene un contrato suyo vinculado.',
  })
  encontrarUna(
    @Param('id', ParseIdPipe) id: string,
    @InquilinoActual() inquilinoId: string,
  ) {
    return this.solicitudMantenimientoService.encontrarUnaDelInquilino(
      id,
      inquilinoId,
    );
  }
}
