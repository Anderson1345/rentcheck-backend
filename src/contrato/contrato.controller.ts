import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RolSolicitante } from '@prisma/client';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  ArrendadorActual,
  ArrendadorGuard,
  JwtAuthGuard,
} from '../auth/auth.module';
import { ParseIdPipe } from '../common/pipes/parse-id.pipe';
import { ContratoService } from './contrato.service';
import { AvisoNoRenovacionService } from './aviso-no-renovacion.service';
import { AvisoNoRenovacionDto } from './dto/aviso-no-renovacion.dto';
import { TerminacionAnticipadaService } from './terminacion-anticipada.service';
import { DocumentoContratoService } from './documento-contrato.service';
import { AplicarIncrementoDto } from './dto/aplicar-incremento.dto';
import { CrearContratoDto } from './dto/crear-contrato.dto';
import { ProrrogarContratoDto } from './dto/prorrogar-contrato.dto';
import { SolicitarTerminacionAnticipadaDto } from './dto/solicitar-terminacion-anticipada.dto';

@ApiTags('Contratos')
@Controller('contratos')
@UseGuards(JwtAuthGuard, ArrendadorGuard)
@ApiBearerAuth()
export class ContratoController {
  constructor(
    private readonly contratoService: ContratoService,
    private readonly documentoContratoService: DocumentoContratoService,
    private readonly terminacionService: TerminacionAnticipadaService,
    private readonly avisoService: AvisoNoRenovacionService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Listar contratos del arrendador autenticado' })
  @ApiOkResponse({
    description: 'Lista de contratos con su unidad e inquilino relacionados.',
  })
  listar(@ArrendadorActual() arrendadorId: string) {
    return this.contratoService.listar(arrendadorId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener el detalle de un contrato por ID' })
  @ApiOkResponse({
    description:
      'Detalle completo del contrato e historial de incrementos IPC.',
  })
  @ApiNotFoundResponse({
    description: 'Contrato no encontrado o no pertenece al arrendador.',
  })
  async encontrarUno(
    @Param('id', ParseIdPipe) id: string,
    @ArrendadorActual() arrendadorId: string,
  ) {
    const contrato = await this.contratoService.encontrarUno(id, arrendadorId);
    if (!contrato) {
      throw new NotFoundException('Contrato no encontrado.');
    }
    return contrato;
  }

  @Get(':id/estado-cuenta')
  @ApiOperation({ summary: 'Obtener el estado de cuenta de un contrato' })
  @ApiOkResponse({
    description: 'Estado de pago derivado y períodos calculados.',
  })
  @ApiNotFoundResponse({
    description: 'Contrato no encontrado o no pertenece al arrendador.',
  })
  async obtenerEstadoCuenta(
    @Param('id', ParseIdPipe) id: string,
    @ArrendadorActual() arrendadorId: string,
  ) {
    const estadoCuenta = await this.contratoService.obtenerEstadoCuenta(
      id,
      arrendadorId,
    );
    if (!estadoCuenta) {
      throw new NotFoundException('Contrato no encontrado.');
    }
    return estadoCuenta;
  }

  @Post(':id/aplicar-incremento')
  @ApiOperation({
    summary: 'Aplicar el incremento anual del canon',
    description:
      'Solo si pasaron 12 meses desde el último incremento (o desde el inicio). Usa el IPC del año calendario anterior; en vivienda el porcentaje no puede superarlo. No cambia la fecha de fin. Genera el otrosí de incremento (documento nuevo; el contrato original no se toca).',
  })
  @ApiCreatedResponse({
    description: 'Contrato con el canon nuevo e incremento registrado.',
  })
  @ApiBadRequestResponse({
    description:
      'PORCENTAJE_SUPERIOR_AL_IPC (vivienda) o cuerpo inválido (VALIDACION).',
  })
  @ApiNotFoundResponse({
    description: 'Contrato no encontrado o no pertenece al arrendador.',
  })
  @ApiConflictResponse({
    description:
      'CONTRATO_NO_ACTIVO, INCREMENTO_ANTES_DE_12_MESES, IPC_NO_CONFIGURADO o INCREMENTO_YA_APLICADO.',
  })
  aplicarIncremento(
    @Param('id', ParseIdPipe) id: string,
    @Body() dto: AplicarIncrementoDto,
    @ArrendadorActual() arrendadorId: string,
  ) {
    return this.contratoService.aplicarIncremento(id, arrendadorId, dto);
  }

  @Post(':id/prorrogar')
  @ApiOperation({
    summary: 'Prorrogar el contrato',
    description:
      'Solo dentro de los 90 días previos al vencimiento. Alarga la fecha de fin (por defecto, por el término inicial) sin cambiar el canon, registra la prórroga y genera el otrosí de prórroga (documento nuevo; el contrato original no se toca).',
  })
  @ApiCreatedResponse({
    description: 'Contrato con la nueva fecha de fin y prórroga registrada.',
  })
  @ApiBadRequestResponse({ description: 'Cuerpo inválido (VALIDACION).' })
  @ApiNotFoundResponse({
    description: 'Contrato no encontrado o no pertenece al arrendador.',
  })
  @ApiConflictResponse({
    description:
      'CONTRATO_NO_ACTIVO, PRORROGA_FUERA_DE_VENTANA o PRORROGA_YA_APLICADA.',
  })
  prorrogar(
    @Param('id', ParseIdPipe) id: string,
    @Body() dto: ProrrogarContratoDto,
    @ArrendadorActual() arrendadorId: string,
  ) {
    return this.contratoService.prorrogar(id, arrendadorId, dto);
  }

  @Get(':id/documentos')
  @ApiOperation({
    summary: 'Listar las versiones de documentos del contrato',
    description:
      'Contrato original y un otrosí por cada incremento y prórroga, ordenados por versión, con hash SHA-256 (nulo solo en documentos heredados) y URL firmada temporal.',
  })
  @ApiOkResponse({
    description:
      'Lista de { id, tipo, version, generado_en, hash_sha256, url_firmada }.',
  })
  @ApiNotFoundResponse({
    description: 'Contrato no encontrado o no pertenece al arrendador.',
  })
  listarDocumentos(
    @Param('id', ParseIdPipe) id: string,
    @ArrendadorActual() arrendadorId: string,
  ) {
    return this.documentoContratoService.listar(id, arrendadorId);
  }

  @Post(':id/documentos/regenerar')
  @ApiOperation({
    summary: 'Generar los documentos del contrato que falten',
    description:
      'Idempotente. Genera solo lo que falta (el contrato original y un otrosí por cada incremento o prórroga sin documento); nunca sobrescribe ni borra documentos existentes. El original se reconstruye con los términos originales (canon y fecha de fin antes de incrementos y prórrogas).',
  })
  @ApiCreatedResponse({
    description:
      '{ generados: [{ tipo, version }], ya_existian: n }. Si un documento no puede generarse, 500 DOCUMENTO_NO_GENERADO con los ya generados en detalles.',
  })
  @ApiNotFoundResponse({
    description: 'Contrato no encontrado o no pertenece al arrendador.',
  })
  regenerarDocumentos(
    @Param('id', ParseIdPipe) id: string,
    @ArrendadorActual() arrendadorId: string,
  ) {
    return this.documentoContratoService.regenerar(id, arrendadorId);
  }

  @Post(':id/aviso-no-renovacion')
  @ApiOperation({
    summary: 'Dar aviso de no renovación',
    description:
      'Con aviso vigente, al llegar la fecha de fin el contrato vence; sin aviso se prorroga automáticamente (D-1). Solo con el contrato ACTIVO y antes de su último día.',
  })
  @ApiCreatedResponse({
    description: 'Contrato con el resumen `aviso_no_renovacion`.',
  })
  @ApiNotFoundResponse({
    description: 'Contrato no encontrado o no pertenece al arrendador.',
  })
  @ApiConflictResponse({
    description: 'CONTRATO_NO_ACTIVO, AVISO_FUERA_DE_PLAZO o AVISO_YA_DADO.',
  })
  darAvisoNoRenovacion(
    @Param('id', ParseIdPipe) id: string,
    @Body() dto: AvisoNoRenovacionDto,
    @ArrendadorActual() arrendadorId: string,
  ) {
    return this.avisoService.dar(
      id,
      { unidad: { inmueble: { arrendador_id: arrendadorId } } },
      RolSolicitante.ARRENDADOR,
      dto.motivo,
    );
  }

  @Post(':id/cancelar-aviso-no-renovacion')
  @ApiOperation({
    summary: 'Cancelar el aviso de no renovación propio',
    description:
      'Solo quien dio el aviso, con el contrato ACTIVO y antes de su último día.',
  })
  @ApiCreatedResponse({
    description: 'Contrato con el resumen `aviso_no_renovacion`.',
  })
  @ApiNotFoundResponse({
    description: 'Contrato no encontrado o no pertenece al arrendador.',
  })
  @ApiConflictResponse({
    description: 'CONTRATO_NO_ACTIVO, AVISO_FUERA_DE_PLAZO o AVISO_NO_DADO.',
  })
  cancelarAvisoNoRenovacion(
    @Param('id', ParseIdPipe) id: string,
    @ArrendadorActual() arrendadorId: string,
  ) {
    return this.avisoService.cancelar(
      id,
      { unidad: { inmueble: { arrendador_id: arrendadorId } } },
      RolSolicitante.ARRENDADOR,
    );
  }

  @Post(':id/cancelar-programado')
  @ApiOperation({
    summary: 'Cancelar un contrato programado',
    description:
      'Solo un contrato PROGRAMADO (fecha de inicio futura). No borra nada: pasa a CANCELADO y su rango queda libre para nuevos contratos.',
  })
  @ApiCreatedResponse({ description: 'Contrato con estado CANCELADO.' })
  @ApiNotFoundResponse({
    description: 'Contrato no encontrado o no pertenece al arrendador.',
  })
  @ApiConflictResponse({ description: 'CONTRATO_NO_PROGRAMADO.' })
  cancelarProgramado(
    @Param('id', ParseIdPipe) id: string,
    @ArrendadorActual() arrendadorId: string,
  ) {
    return this.contratoService.cancelarProgramado(id, arrendadorId);
  }

  @Post(':id/regenerar-codigo')
  @ApiOperation({ summary: 'Regenerar el código de acceso de un contrato' })
  @ApiOkResponse({ description: 'Código de acceso regenerado exitosamente.' })
  @ApiNotFoundResponse({
    description:
      'Contrato no encontrado, no pertenece al arrendador o no tiene código de acceso.',
  })
  regenerarCodigo(
    @Param('id', ParseIdPipe) id: string,
    @ArrendadorActual() arrendadorId: string,
  ) {
    return this.contratoService.regenerarCodigo(id, arrendadorId);
  }

  @Post()
  @ApiOperation({ summary: 'Crear un contrato' })
  @ApiCreatedResponse({
    description:
      'Contrato creado exitosamente, incluyendo su código de acceso generado.',
  })
  @ApiNotFoundResponse({
    description: 'La unidad o el inquilino no pertenecen al arrendador.',
  })
  @ApiConflictResponse({
    description: 'La unidad ya tiene un contrato activo.',
  })
  crear(
    @Body() dto: CrearContratoDto,
    @ArrendadorActual() arrendadorId: string,
  ) {
    return this.contratoService.crear(dto, arrendadorId);
  }

  @Post(':id/solicitar-terminacion-anticipada')
  @ApiOperation({
    summary: 'Solicitar la terminación anticipada (mutuo acuerdo)',
    description:
      'Requiere motivo y fecha efectiva (entre hoy y la fecha de fin, sin ser anterior al inicio). La confirma el inquilino; quien solicita puede cancelar mientras no esté confirmada.',
  })
  @ApiCreatedResponse({
    description: 'Contrato con el resumen `terminacion_anticipada`.',
  })
  @ApiBadRequestResponse({
    description: 'FECHA_EFECTIVA_INVALIDA o cuerpo inválido.',
  })
  @ApiNotFoundResponse({
    description: 'Contrato no encontrado o no pertenece al arrendador.',
  })
  @ApiConflictResponse({
    description: 'CONTRATO_NO_ACTIVO o TERMINACION_YA_SOLICITADA.',
  })
  solicitarTerminacionAnticipada(
    @Param('id', ParseIdPipe) id: string,
    @Body() dto: SolicitarTerminacionAnticipadaDto,
    @ArrendadorActual() arrendadorId: string,
  ) {
    return this.terminacionService.solicitar(
      id,
      { unidad: { inmueble: { arrendador_id: arrendadorId } } },
      RolSolicitante.ARRENDADOR,
      dto.motivo,
      dto.fecha_efectiva,
    );
  }

  @Post(':id/confirmar-terminacion-anticipada')
  @ApiOperation({
    summary: 'Confirmar la terminación anticipada solicitada por el inquilino',
    description:
      'Solo puede confirmar la contraparte de quien solicitó. Con fecha efectiva de hoy el contrato termina de inmediato; con fecha futura sigue activo hasta esa fecha.',
  })
  @ApiCreatedResponse({
    description: 'Contrato con el resumen `terminacion_anticipada`.',
  })
  @ApiNotFoundResponse({
    description: 'Contrato no encontrado o no pertenece al arrendador.',
  })
  @ApiConflictResponse({
    description:
      'CONTRATO_NO_ACTIVO, TERMINACION_NO_SOLICITADA o TERMINACION_YA_CONFIRMADA.',
  })
  confirmarTerminacionAnticipada(
    @Param('id', ParseIdPipe) id: string,
    @ArrendadorActual() arrendadorId: string,
  ) {
    return this.terminacionService.confirmar(
      id,
      { unidad: { inmueble: { arrendador_id: arrendadorId } } },
      RolSolicitante.ARRENDADOR,
    );
  }

  @Post(':id/cancelar-terminacion-anticipada')
  @ApiOperation({
    summary: 'Cancelar la solicitud de terminación anticipada propia',
    description:
      'Solo quien solicitó, y solo mientras no esté confirmada (una vez confirmada es irreversible).',
  })
  @ApiCreatedResponse({
    description: 'Contrato con el resumen `terminacion_anticipada`.',
  })
  @ApiNotFoundResponse({
    description: 'Contrato no encontrado o no pertenece al arrendador.',
  })
  @ApiConflictResponse({
    description:
      'CONTRATO_NO_ACTIVO, TERMINACION_NO_SOLICITADA o TERMINACION_YA_CONFIRMADA.',
  })
  cancelarTerminacionAnticipada(
    @Param('id', ParseIdPipe) id: string,
    @ArrendadorActual() arrendadorId: string,
  ) {
    return this.terminacionService.cancelar(
      id,
      { unidad: { inmueble: { arrendador_id: arrendadorId } } },
      RolSolicitante.ARRENDADOR,
    );
  }
}
