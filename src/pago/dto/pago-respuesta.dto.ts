import { ApiProperty } from '@nestjs/swagger';
import {
  EstadoContrato,
  EstadoPago,
  MotivoRechazoPago,
  TipoPlantillaContrato,
  TipoUnidad,
  UsoPermitido,
} from '@prisma/client';

// Respuestas de los endpoints de pagos (B-57, parte de pagos). Las clases solo DESCRIBEN lo que ya
// devuelve el servicio (src/pago/pago.service.ts, INCLUDE_PAGO y exponerUrlFirmada): no cambian
// nada. Los decoradores van explícitos para que el esquema salga igual con o sin el plugin de Swagger.

const ESTADOS_PERIODO = [
  'PAGADO',
  'EN_REVISION',
  'PENDIENTE',
  'VENCIDO',
  'PARCIAL',
] as const;

/** El período que cubre el pago, tal como lo calcula el estado de cuenta del contrato. */
export class PeriodoCuentaDto {
  /** Canon que rige en ese período (el del historial de incrementos, no el de hoy). */
  @ApiProperty({ example: 1500000 })
  canon_vigente_centavos!: number;

  /** Fecha límite de pago del período (día calendario, medianoche UTC). */
  @ApiProperty({ type: String, format: 'date-time' })
  fecha_limite!: Date;

  /** Suma de los pagos APROBADOS del período. */
  @ApiProperty({ example: 0 })
  monto_aprobado_centavos!: number;

  @ApiProperty({ enum: ESTADOS_PERIODO, enumName: 'EstadoPeriodoPago' })
  estado!: (typeof ESTADOS_PERIODO)[number];
}

export class InmuebleDePagoDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  direccion!: string;

  @ApiProperty()
  ciudad!: string;
}

export class UnidadDePagoDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  inmueble_id!: string;

  @ApiProperty()
  nombre!: string;

  @ApiProperty({ enum: TipoUnidad, enumName: 'TipoUnidad' })
  tipo!: TipoUnidad;

  /** Decimal: llega como texto. */
  @ApiProperty({ type: String, nullable: true })
  metros_cuadrados!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  numero_habitaciones!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  numero_banos!: number | null;

  @ApiProperty()
  canon_base_centavos!: number;

  @ApiProperty({ type: Number, nullable: true })
  ocupantes_maximos!: number | null;

  @ApiProperty()
  acepta_mascotas!: boolean;

  @ApiProperty({ enum: UsoPermitido, enumName: 'UsoPermitido' })
  uso_permitido!: UsoPermitido;

  /** URL firmada de la foto principal, o null (nunca la ruta interna). */
  @ApiProperty({ type: String, nullable: true })
  foto_principal_url!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  creado_en!: Date;

  @ApiProperty({ type: () => InmuebleDePagoDto })
  inmueble!: InmuebleDePagoDto;
}

/** Nombre, cédula y teléfono de la COPIA del contrato (lo que escribió el arrendador). */
export class InquilinoDePagoDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  nombre!: string;

  @ApiProperty()
  cedula!: string;

  @ApiProperty()
  telefono!: string;
}

export class ContratoDePagoDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({
    enum: TipoPlantillaContrato,
    enumName: 'TipoPlantillaContrato',
  })
  tipo_plantilla!: TipoPlantillaContrato;

  /** Canon VIGENTE hoy (no el del período del pago: para eso, `periodo_cuenta`). */
  @ApiProperty()
  canon_centavos!: number;

  @ApiProperty()
  dia_pago!: number;

  @ApiProperty()
  forma_pago!: string;

  @ApiProperty({ type: Number, nullable: true })
  deposito_centavos!: number | null;

  @ApiProperty({ type: String, format: 'date-time' })
  fecha_inicio!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  fecha_fin!: Date;

  @ApiProperty({ enum: EstadoContrato, enumName: 'EstadoContrato' })
  estado!: EstadoContrato;

  @ApiProperty({ type: () => UnidadDePagoDto })
  unidad!: UnidadDePagoDto;

  @ApiProperty({ type: () => InquilinoDePagoDto })
  inquilino!: InquilinoDePagoDto;
}

/**
 * Un pago sin el bloque `contrato`: es la forma de la respuesta 201 de `POST /pagos` (y de la
 * repetición idempotente). Los demás endpoints devuelven `PagoRespuestaDto`.
 */
export class PagoCreadoDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  arrendador_id!: string;

  @ApiProperty()
  contrato_id!: string;

  @ApiProperty({ example: 1500000 })
  monto_centavos!: number;

  /** Día en que se pagó (medianoche UTC). */
  @ApiProperty({ type: String, format: 'date-time' })
  fecha_reportada!: Date;

  /** Primer día del mes que cubre (medianoche UTC). */
  @ApiProperty({ type: String, format: 'date-time' })
  periodo!: Date;

  @ApiProperty({ enum: EstadoPago, enumName: 'EstadoPago' })
  estado!: EstadoPago;

  /** Solo los pagos RECHAZADO traen valor; los rechazos anteriores a B-59 quedan en null. */
  @ApiProperty({
    enum: MotivoRechazoPago,
    enumName: 'MotivoRechazoPago',
    nullable: true,
  })
  motivo_rechazo!: MotivoRechazoPago | null;

  @ApiProperty({ type: String, nullable: true })
  mensaje_rechazo!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  creado_en!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  actualizado_en!: Date;

  /** URL firmada del comprobante (caduca), o null si no hay archivo o falló la firma. Nunca la ruta interna. */
  @ApiProperty({ type: String, nullable: true })
  comprobante_url!: string | null;

  /** Tipo del comprobante, derivado de la extensión del archivo guardado. null si no se puede saber. */
  @ApiProperty({
    enum: ['IMAGEN', 'PDF'],
    enumName: 'ComprobanteTipo',
    nullable: true,
  })
  comprobante_tipo!: 'IMAGEN' | 'PDF' | null;

  /** null solo si el cálculo del estado de cuenta no genera el período del pago. */
  @ApiProperty({ type: () => PeriodoCuentaDto, nullable: true })
  periodo_cuenta!: PeriodoCuentaDto | null;
}

/** Un pago con los datos de su contrato, su unidad, su inmueble y su inquilino. */
export class PagoRespuestaDto extends PagoCreadoDto {
  @ApiProperty({ type: () => ContratoDePagoDto })
  contrato!: ContratoDePagoDto;
}
