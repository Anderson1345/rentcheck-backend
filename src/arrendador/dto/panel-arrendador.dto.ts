import { ApiProperty } from '@nestjs/swagger';

// Respuesta de GET /arrendadores/panel (B-58). Las clases solo DESCRIBEN lo que construye la función
// pura src/common/panel-arrendador.util.ts: no cambian nada. Los decoradores van explícitos para que
// el esquema salga igual con o sin el plugin de Swagger. Dinero en centavos enteros; fechas de día
// como "AAAA-MM-DD" y meses como "AAAA-MM", siempre en la zona horaria de Bogotá.

export class RecaudoPanelDto {
  /** Suma del canon de los períodos cuya fecha límite cae en el mes (cada uno con el canon que regía entonces). */
  @ApiProperty({ example: 4000000 })
  esperado_centavos!: number;

  /** Lo aprobado de esos períodos, sin pasar del canon de cada uno. */
  @ApiProperty({ example: 3400000 })
  aprobado_centavos!: number;

  /** Lo que está pendiente de aprobación en períodos EN_REVISION, sin pasar del saldo del período. */
  @ApiProperty({ example: 600000 })
  en_revision_centavos!: number;

  /** Lo que falta: esperado − aprobado − en revisión (incluye lo que aún no vence). */
  @ApiProperty({ example: 0 })
  sin_reportar_centavos!: number;

  /** Contratos con al menos un período en el mes. */
  @ApiProperty({ example: 4 })
  contratos!: number;
}

export class OcupacionPanelDto {
  /** Todas las unidades de sus inmuebles, también la "Unidad principal" sin completar. */
  @ApiProperty({ example: 8 })
  unidades!: number;

  /** Unidades con un contrato ACTIVO. */
  @ApiProperty({ example: 4 })
  ocupadas!: number;

  @ApiProperty({ example: 4 })
  libres!: number;

  /** De las libres, las que ya tienen un contrato PROGRAMADO (no bloquea la unidad). */
  @ApiProperty({ example: 1 })
  con_contrato_programado!: number;
}

export class MoraPanelDto {
  /** Contratos con al menos un período VENCIDO o PARCIAL, en cualquier estado (también los ya cerrados). */
  @ApiProperty({ example: 2 })
  contratos!: number;

  /** Períodos VENCIDO o PARCIAL; un período EN_REVISION no es mora. */
  @ApiProperty({ example: 4 })
  periodos!: number;

  /** Suma de (canon del período − aprobado), nunca negativa. */
  @ApiProperty({ example: 3600000 })
  total_centavos!: number;
}

export class TendenciaMesDto {
  @ApiProperty({ example: '2027-03' })
  mes!: string;

  /** Pagos APROBADOS cuya fecha_reportada cae en ese mes. */
  @ApiProperty({ example: 3400000 })
  ingresos_centavos!: number;
}

export class ContratoPendienteDto {
  @ApiProperty()
  contrato_id!: string;

  /** Nombre de la unidad. */
  @ApiProperty({ example: 'Apto 101' })
  unidad!: string;

  /** Dirección del inmueble. */
  @ApiProperty({ example: 'Calle 45 # 12-30' })
  inmueble!: string;

  @ApiProperty({ example: '2027-03-31' })
  fecha_fin!: string;
}

export class IncrementoDisponibleDto {
  @ApiProperty()
  contrato_id!: string;

  @ApiProperty({ example: 'Apto 101' })
  unidad!: string;

  @ApiProperty({ example: 'Calle 45 # 12-30' })
  inmueble!: string;

  /** 12 meses después del último incremento o del inicio del contrato. */
  @ApiProperty({ example: '2027-03-01' })
  disponible_desde!: string;

  /** true si falta el IPC del año anterior: aplicar el incremento respondería 409 IPC_NO_CONFIGURADO. */
  @ApiProperty({ example: false })
  ipc_faltante!: boolean;
}

export class ContratosPorVencerPanelDto {
  /** Total real (la lista se limita a 5). */
  @ApiProperty({ example: 1 })
  cantidad!: number;

  /** Los 5 que vencen primero, por fecha de fin ascendente. */
  @ApiProperty({ type: () => [ContratoPendienteDto] })
  contratos!: ContratoPendienteDto[];
}

export class IncrementosDisponiblesPanelDto {
  @ApiProperty({ example: 1 })
  cantidad!: number;

  /** Los 5 que lo tienen disponible desde hace más tiempo. */
  @ApiProperty({ type: () => [IncrementoDisponibleDto] })
  contratos!: IncrementoDisponibleDto[];
}

export class TerminacionesPorConfirmarPanelDto {
  @ApiProperty({ example: 1 })
  cantidad!: number;

  @ApiProperty({ type: () => [ContratoPendienteDto] })
  contratos!: ContratoPendienteDto[];
}

export class PendientesPanelDto {
  /** Pagos en estado PENDIENTE de todos sus contratos. */
  @ApiProperty({ example: 2 })
  comprobantes_por_validar!: number;

  /** Solicitudes de mantenimiento en estado PENDIENTE (no cuenta las EN_PROCESO). */
  @ApiProperty({ example: 2 })
  mantenimientos_pendientes!: number;

  /** Contratos ACTIVO con fecha de fin entre hoy y dentro de 30 días. */
  @ApiProperty({ type: () => ContratosPorVencerPanelDto })
  contratos_por_vencer!: ContratosPorVencerPanelDto;

  /** Contratos ACTIVO con 12 meses cumplidos desde el último incremento (o el inicio): ya se puede aplicar uno. */
  @ApiProperty({ type: () => IncrementosDisponiblesPanelDto })
  incrementos_disponibles!: IncrementosDisponiblesPanelDto;

  /** Terminaciones anticipadas pedidas por el inquilino que el arrendador aún no confirma. */
  @ApiProperty({ type: () => TerminacionesPorConfirmarPanelDto })
  terminaciones_por_confirmar!: TerminacionesPorConfirmarPanelDto;
}

/** El Panel del arrendador, calculado para el día de hoy en Bogotá. */
export class PanelArrendadorDto {
  /** Mes actual de Bogotá. */
  @ApiProperty({ example: '2027-03' })
  mes!: string;

  @ApiProperty({ example: '2027-03-15' })
  calculado_para!: string;

  /**
   * Caja real del mes: suma de los pagos APROBADOS cuya fecha_reportada cae en el mes, sin tope por
   * canon. Puede diferir de `recaudo.aprobado_centavos`, que mira los períodos que vencen en el mes
   * y limita cada uno a su canon.
   */
  @ApiProperty({ example: 3400000 })
  ingresos_mes_centavos!: number;

  /** Recaudo esperado frente al real de los períodos del mes: esperado = aprobado + en revisión + sin reportar. */
  @ApiProperty({ type: () => RecaudoPanelDto })
  recaudo!: RecaudoPanelDto;

  @ApiProperty({ type: () => OcupacionPanelDto })
  ocupacion!: OcupacionPanelDto;

  /** Cartera en mora (de cualquier mes) calculada al día de hoy. */
  @ApiProperty({ type: () => MoraPanelDto })
  mora!: MoraPanelDto;

  /** Siempre 6 meses, del más antiguo al actual, con los ingresos (caja real) de cada uno. */
  @ApiProperty({ type: () => [TendenciaMesDto] })
  tendencia!: TendenciaMesDto[];

  @ApiProperty({ type: () => PendientesPanelDto })
  pendientes!: PendientesPanelDto;
}
