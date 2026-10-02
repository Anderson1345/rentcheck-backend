import {
  Body,
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
  ApiBody,
  ApiConflictResponse,
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
import { ActualizarEstadoSolicitudMantenimientoDto } from './dto/actualizar-estado-solicitud-mantenimiento.dto';
import { ListarSolicitudesMantenimientoQueryDto } from './dto/listar-solicitudes-mantenimiento-query.dto';
import { SolicitudArrendadorDto } from './dto/solicitud-respuesta.dto';
import { SolicitudMantenimientoService } from './solicitud-mantenimiento.service';

@ApiTags('Solicitudes de Mantenimiento')
@Controller('solicitudes-mantenimiento')
@UseGuards(JwtAuthGuard, ArrendadorGuard)
@ApiBearerAuth()
export class SolicitudMantenimientoArrendadorController {
  constructor(
    private readonly solicitudMantenimientoService: SolicitudMantenimientoService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Listar solicitudes de mantenimiento (vista del arrendador)',
  })
  @ApiOkResponse({
    type: SolicitudArrendadorDto,
    isArray: true,
    description:
      'Solicitudes del arrendador con unidad, inmueble e inquilino relacionados, ordenadas por urgencia (ALTO primero) y fecha de creación (la más reciente primero). `adjunto_url` es una URL firmada (null si el archivo no está disponible) y `adjunto_tipo` dice si es IMAGEN, VIDEO o null.',
  })
  @ApiQuery({
    name: 'estado',
    required: false,
    enum: ['PENDIENTE', 'EN_PROCESO', 'RESUELTO'],
    description: 'Filtrar por estado de la solicitud.',
  })
  @ApiQuery({
    name: 'urgencia',
    required: false,
    enum: ['BAJO', 'MEDIO', 'ALTO'],
    description: 'Filtrar por urgencia.',
  })
  @ApiQuery({
    name: 'unidadId',
    required: false,
    type: 'string',
    description: 'Filtrar por unidad.',
  })
  listar(
    @ArrendadorActual() arrendadorId: string,
    @Query() query: ListarSolicitudesMantenimientoQueryDto,
  ) {
    return this.solicitudMantenimientoService.listar(arrendadorId, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Obtener el detalle de una solicitud de mantenimiento',
  })
  @ApiOkResponse({
    type: SolicitudArrendadorDto,
    description:
      'Detalle completo de la solicitud con sus relaciones (unidad, inmueble e inquilino).',
  })
  @ApiNotFoundResponse({
    description:
      'Solicitud no encontrada o no pertenece al arrendador autenticado.',
  })
  encontrarUno(
    @Param('id', ParseIdPipe) id: string,
    @ArrendadorActual() arrendadorId: string,
  ) {
    return this.solicitudMantenimientoService.encontrarUno(id, arrendadorId);
  }

  @Patch(':id/estado')
  @ApiOperation({
    summary: 'Actualizar el estado de una solicitud de mantenimiento',
    description:
      'Transiciones permitidas: PENDIENTE → EN_PROCESO, PENDIENTE → RESUELTO y EN_PROCESO → RESUELTO. Una solicitud RESUELTO no admite más cambios y EN_PROCESO no se puede repetir (409 TRANSICION_INVALIDA).',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['estado'],
      properties: {
        estado: {
          type: 'string',
          enum: ['EN_PROCESO', 'RESUELTO'],
          description: 'Nuevo estado de la solicitud.',
        },
      },
    },
  })
  @ApiOkResponse({
    type: SolicitudArrendadorDto,
    description: 'Solicitud actualizada correctamente.',
  })
  @ApiBadRequestResponse({
    description: 'El estado debe ser EN_PROCESO o RESUELTO (VALIDACION).',
  })
  @ApiNotFoundResponse({
    description:
      'Solicitud no encontrada o no pertenece al arrendador autenticado.',
  })
  @ApiConflictResponse({
    description:
      'La transición de estado no es válida: ya está RESUELTO o la transición no está permitida (TRANSICION_INVALIDA).',
  })
  actualizarEstado(
    @Param('id', ParseIdPipe) id: string,
    @Body() dto: ActualizarEstadoSolicitudMantenimientoDto,
    @ArrendadorActual() arrendadorId: string,
  ) {
    return this.solicitudMantenimientoService.actualizarEstado(
      id,
      arrendadorId,
      dto,
    );
  }
}
