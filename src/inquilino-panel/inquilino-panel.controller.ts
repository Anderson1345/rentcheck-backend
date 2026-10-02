import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
import { ParseIdPipe } from '../common/pipes/parse-id.pipe';
import { AvisoNoRenovacionDto } from '../contrato/dto/aviso-no-renovacion.dto';
import { SolicitarTerminacionAnticipadaDto } from './dto/solicitar-terminacion-anticipada.dto';
import { VincularContratoDto } from './dto/vincular-contrato.dto';
import { InquilinoPanelService } from './inquilino-panel.service';

const OBSOLETO =
  'OBSOLETO: usa la ruta equivalente por id bajo /inquilino/contratos/:id. Se retira en B0.5.';

@ApiTags('Panel del Inquilino')
@Controller('inquilino')
@UseGuards(JwtAuthGuard, InquilinoGuard)
@ApiBearerAuth()
export class InquilinoPanelController {
  constructor(private readonly inquilinoPanelService: InquilinoPanelService) {}

  // ------------------------------------------------------------------
  // Rutas por contrato
  // ------------------------------------------------------------------

  @Get('contratos')
  @ApiOperation({
    summary: 'Listar los contratos vinculados del inquilino',
    description:
      'Solo los contratos vinculados con su código y no cancelados. Orden: el ACTIVO primero, luego los PROGRAMADOS por fecha de inicio y al final el resto, del más reciente al más antiguo. `estado_pago` solo se calcula si el contrato está ACTIVO.',
  })
  @ApiOkResponse({
    description:
      'Lista de contratos: id, estado, fechas, unidad (id, nombre, tipo; el id sirve para crear solicitudes de mantenimiento), inmueble (dirección, ciudad) y estado_pago (al_dia, en_mora, pendiente o null).',
  })
  listarContratos(@InquilinoActual() inquilinoId: string) {
    return this.inquilinoPanelService.listarContratos(inquilinoId);
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

  @Get('contratos/:id')
  @ApiOperation({
    summary: 'Condiciones de un contrato del inquilino',
    description:
      'Condiciones económicas, incrementos IPC, terminación, aviso de no renovación, fotos de entrega y devolución y `documentos` (original y otrosíes con URL firmada). `pdf_contrato_url` se conserva pero es obsoleto: usa `documentos`. Toda URL firmada (`pdf_contrato_url`, fotos, documentos) es null si el archivo no está disponible.',
  })
  @ApiOkResponse({
    description:
      'Detalle del contrato con sus documentos y `unidad: { id }` (el id de la unidad, para crear solicitudes de mantenimiento).',
  })
  @ApiNotFoundResponse({
    description:
      'El contrato no existe, es de otro inquilino, no está vinculado o está cancelado.',
  })
  obtenerContrato(
    @Param('id', ParseIdPipe) id: string,
    @InquilinoActual() inquilinoId: string,
  ) {
    return this.inquilinoPanelService.obtenerContrato(inquilinoId, id);
  }

  @Get('contratos/:id/panel')
  @ApiOperation({
    summary: 'Panel de un contrato del inquilino',
    description:
      'Con el contrato ACTIVO: canon vigente, estado de pago, próximo período por pagar (el primero no pagado) y períodos vencidos. PROGRAMADO y no activos conservan su respuesta simple.',
  })
  @ApiOkResponse({ description: 'Panel del contrato.' })
  @ApiNotFoundResponse({
    description:
      'El contrato no existe, es de otro inquilino, no está vinculado o está cancelado.',
  })
  obtenerPanel(
    @Param('id', ParseIdPipe) id: string,
    @InquilinoActual() inquilinoId: string,
  ) {
    return this.inquilinoPanelService.obtenerPanel(inquilinoId, id);
  }

  @Get('contratos/:id/estado-cuenta')
  @ApiOperation({ summary: 'Estado de cuenta de un contrato del inquilino' })
  @ApiOkResponse({
    description: 'Estado de pago derivado y períodos calculados.',
  })
  @ApiNotFoundResponse({
    description:
      'El contrato no existe, es de otro inquilino, no está vinculado o está cancelado.',
  })
  obtenerEstadoCuenta(
    @Param('id', ParseIdPipe) id: string,
    @InquilinoActual() inquilinoId: string,
  ) {
    return this.inquilinoPanelService.obtenerEstadoCuenta(inquilinoId, id);
  }

  @Get('contratos/:id/documentos')
  @ApiOperation({
    summary: 'Documentos legales de un contrato del inquilino',
    description:
      'Contrato original y un otrosí por cada incremento o prórroga, con hash SHA-256 y URL firmada (nula si falla la firma de ese documento).',
  })
  @ApiOkResponse({
    description:
      'Lista de documentos: id, tipo, version, hash_sha256, generado_en y url_firmada.',
  })
  @ApiNotFoundResponse({
    description:
      'El contrato no existe, es de otro inquilino, no está vinculado o está cancelado.',
  })
  listarDocumentos(
    @Param('id', ParseIdPipe) id: string,
    @InquilinoActual() inquilinoId: string,
  ) {
    return this.inquilinoPanelService.listarDocumentos(inquilinoId, id);
  }

  @Post('contratos/:id/solicitar-terminacion-anticipada')
  @ApiOperation({
    summary: 'Solicitar la terminación anticipada (mutuo acuerdo)',
    description:
      'Requiere motivo y fecha efectiva (entre hoy y la fecha de fin, sin ser anterior al inicio). La confirma el arrendador; el inquilino puede cancelar mientras no esté confirmada.',
  })
  @ApiCreatedResponse({
    description: 'Contrato con el resumen `terminacion_anticipada`.',
  })
  @ApiNotFoundResponse({ description: 'Contrato no encontrado.' })
  @ApiConflictResponse({
    description: 'CONTRATO_NO_ACTIVO o TERMINACION_YA_SOLICITADA.',
  })
  solicitarTerminacionAnticipada(
    @Param('id', ParseIdPipe) id: string,
    @Body() dto: SolicitarTerminacionAnticipadaDto,
    @InquilinoActual() inquilinoId: string,
  ) {
    return this.inquilinoPanelService.solicitarTerminacionAnticipada(
      inquilinoId,
      id,
      dto.motivo,
      dto.fecha_efectiva,
    );
  }

  @Post('contratos/:id/confirmar-terminacion-anticipada')
  @ApiOperation({
    summary: 'Confirmar la terminación anticipada solicitada por el arrendador',
  })
  @ApiCreatedResponse({
    description: 'Contrato con el resumen `terminacion_anticipada`.',
  })
  @ApiNotFoundResponse({ description: 'Contrato no encontrado.' })
  @ApiConflictResponse({
    description:
      'CONTRATO_NO_ACTIVO, TERMINACION_NO_SOLICITADA o TERMINACION_YA_CONFIRMADA.',
  })
  confirmarTerminacionAnticipada(
    @Param('id', ParseIdPipe) id: string,
    @InquilinoActual() inquilinoId: string,
  ) {
    return this.inquilinoPanelService.confirmarTerminacionAnticipada(
      inquilinoId,
      id,
    );
  }

  @Post('contratos/:id/cancelar-terminacion-anticipada')
  @ApiOperation({
    summary: 'Cancelar la solicitud de terminación anticipada propia',
  })
  @ApiCreatedResponse({
    description: 'Contrato con el resumen `terminacion_anticipada`.',
  })
  @ApiNotFoundResponse({ description: 'Contrato no encontrado.' })
  @ApiConflictResponse({
    description:
      'CONTRATO_NO_ACTIVO, TERMINACION_NO_SOLICITADA o TERMINACION_YA_CONFIRMADA.',
  })
  cancelarTerminacionAnticipada(
    @Param('id', ParseIdPipe) id: string,
    @InquilinoActual() inquilinoId: string,
  ) {
    return this.inquilinoPanelService.cancelarTerminacionAnticipada(
      inquilinoId,
      id,
    );
  }

  @Post('contratos/:id/aviso-no-renovacion')
  @ApiOperation({
    summary: 'Dar aviso de no renovación',
    description:
      'Con aviso vigente, al llegar la fecha de fin el contrato vence; sin aviso se prorroga automáticamente (D-1). Solo con el contrato ACTIVO y antes de su último día.',
  })
  @ApiCreatedResponse({
    description: 'Contrato con el resumen `aviso_no_renovacion`.',
  })
  @ApiNotFoundResponse({ description: 'Contrato no encontrado.' })
  @ApiConflictResponse({
    description: 'CONTRATO_NO_ACTIVO, AVISO_FUERA_DE_PLAZO o AVISO_YA_DADO.',
  })
  darAvisoNoRenovacion(
    @Param('id', ParseIdPipe) id: string,
    @Body() dto: AvisoNoRenovacionDto,
    @InquilinoActual() inquilinoId: string,
  ) {
    return this.inquilinoPanelService.darAvisoNoRenovacion(
      inquilinoId,
      id,
      dto.motivo,
    );
  }

  @Post('contratos/:id/cancelar-aviso-no-renovacion')
  @ApiOperation({ summary: 'Cancelar el aviso de no renovación propio' })
  @ApiCreatedResponse({
    description: 'Contrato con el resumen `aviso_no_renovacion`.',
  })
  @ApiNotFoundResponse({ description: 'Contrato no encontrado.' })
  @ApiConflictResponse({
    description: 'CONTRATO_NO_ACTIVO, AVISO_FUERA_DE_PLAZO o AVISO_NO_DADO.',
  })
  cancelarAvisoNoRenovacion(
    @Param('id', ParseIdPipe) id: string,
    @InquilinoActual() inquilinoId: string,
  ) {
    return this.inquilinoPanelService.cancelarAvisoNoRenovacion(
      inquilinoId,
      id,
    );
  }

  // ------------------------------------------------------------------
  // Alias OBSOLETOS `mi-*` (se retiran en B0.5)
  // ------------------------------------------------------------------

  @Get('mi-panel')
  @ApiOperation({
    summary: 'Obtener el panel del inquilino autenticado',
    description: OBSOLETO,
    deprecated: true,
  })
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
    description: OBSOLETO,
    deprecated: true,
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
    description: OBSOLETO,
    deprecated: true,
  })
  @ApiOkResponse({
    description: 'Estado de pago derivado y períodos calculados.',
  })
  @ApiNotFoundResponse({
    description: 'El inquilino autenticado no tiene ningún contrato.',
  })
  obtenerMiEstadoCuenta(@InquilinoActual() inquilinoId: string) {
    return this.inquilinoPanelService.obtenerMiEstadoCuenta(inquilinoId);
  }

  @Post('mi-contrato/solicitar-terminacion-anticipada')
  @ApiOperation({
    summary: 'Solicitar la terminación anticipada (mutuo acuerdo)',
    description: OBSOLETO,
    deprecated: true,
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
  solicitarTerminacionMiContrato(
    @Body() dto: SolicitarTerminacionAnticipadaDto,
    @InquilinoActual() inquilinoId: string,
  ) {
    return this.inquilinoPanelService.solicitarTerminacionMiContrato(
      inquilinoId,
      dto.motivo,
      dto.fecha_efectiva,
    );
  }

  @Post('mi-contrato/aviso-no-renovacion')
  @ApiOperation({
    summary: 'Dar aviso de no renovación',
    description: OBSOLETO,
    deprecated: true,
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
  darAvisoMiContrato(
    @Body() dto: AvisoNoRenovacionDto,
    @InquilinoActual() inquilinoId: string,
  ) {
    return this.inquilinoPanelService.darAvisoMiContrato(
      inquilinoId,
      dto.motivo,
    );
  }

  @Post('mi-contrato/cancelar-aviso-no-renovacion')
  @ApiOperation({
    summary: 'Cancelar el aviso de no renovación propio',
    description: OBSOLETO,
    deprecated: true,
  })
  @ApiCreatedResponse({
    description: 'Contrato con el resumen `aviso_no_renovacion`.',
  })
  @ApiNotFoundResponse({
    description: 'El inquilino autenticado no tiene ningún contrato.',
  })
  @ApiConflictResponse({
    description: 'CONTRATO_NO_ACTIVO, AVISO_FUERA_DE_PLAZO o AVISO_NO_DADO.',
  })
  cancelarAvisoMiContrato(@InquilinoActual() inquilinoId: string) {
    return this.inquilinoPanelService.cancelarAvisoMiContrato(inquilinoId);
  }

  @Post('mi-contrato/confirmar-terminacion-anticipada')
  @ApiOperation({
    summary: 'Confirmar la terminación anticipada solicitada por el arrendador',
    description: OBSOLETO,
    deprecated: true,
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
  confirmarTerminacionMiContrato(@InquilinoActual() inquilinoId: string) {
    return this.inquilinoPanelService.confirmarTerminacionMiContrato(
      inquilinoId,
    );
  }

  @Post('mi-contrato/cancelar-terminacion-anticipada')
  @ApiOperation({
    summary: 'Cancelar la solicitud de terminación anticipada propia',
    description: OBSOLETO,
    deprecated: true,
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
  cancelarTerminacionMiContrato(@InquilinoActual() inquilinoId: string) {
    return this.inquilinoPanelService.cancelarTerminacionMiContrato(
      inquilinoId,
    );
  }
}
