import { ApiProperty } from '@nestjs/swagger';
import {
  EstadoContrato,
  EstadoPagoContrato,
  RolSolicitante,
  TipoPlantillaContrato,
  TipoUnidad,
} from '@prisma/client';

// Elemento de GET /contratos (B0.7-C, B-86). Solo DESCRIBE lo que ya responde `ContratoService.listar`:
// todas las columnas del contrato (sin la ruta del PDF ni la copia cruda del inquilino), la unidad
// resumida, el inquilino resumido, el código de acceso, la URL firmada del PDF heredado y `vinculado`.
// Una prueba e2e compara estas claves con las de la respuesta real. Las fechas llegan en ISO 8601;
// las de día (`@db.Date`) como medianoche UTC de ese día.

export class UnidadContratoListaDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'Apto 101' })
  nombre!: string;

  @ApiProperty({ enum: TipoUnidad, enumName: 'TipoUnidad' })
  tipo!: TipoUnidad;
}

export class InquilinoContratoListaDto {
  @ApiProperty()
  id!: string;

  /** El nombre que guarda el contrato (lo que escribió el arrendador), nunca el perfil global. */
  @ApiProperty({ example: 'Camilo Pardo' })
  nombre!: string;
}

export class CodigoAccesoContratoListaDto {
  @ApiProperty({ example: 'RC-AB3D-9KPX' })
  codigo!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  expira_en!: string;
}

export class ContratoListaDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  arrendador_id!: string;

  @ApiProperty()
  unidad_id!: string;

  @ApiProperty()
  inquilino_id!: string;

  @ApiProperty({ type: () => UnidadContratoListaDto })
  unidad!: UnidadContratoListaDto;

  @ApiProperty({ type: () => InquilinoContratoListaDto })
  inquilino!: InquilinoContratoListaDto;

  /** null si el contrato no tiene código de acceso. */
  @ApiProperty({ type: () => CodigoAccesoContratoListaDto, nullable: true })
  codigo_acceso!: CodigoAccesoContratoListaDto | null;

  @ApiProperty({
    enum: TipoPlantillaContrato,
    enumName: 'TipoPlantillaContrato',
  })
  tipo_plantilla!: TipoPlantillaContrato;

  /** Canon vigente hoy. */
  @ApiProperty({ example: 1500000 })
  canon_centavos!: number;

  @ApiProperty({ example: 5 })
  dia_pago!: number;

  @ApiProperty({ example: 'Transferencia' })
  forma_pago!: string;

  @ApiProperty({ type: Number, nullable: true })
  deposito_centavos!: number | null;

  @ApiProperty()
  datos_recaudo!: string;

  @ApiProperty({ type: String, nullable: true })
  datos_fiador_o_poliza!: string | null;

  @ApiProperty({ type: String, nullable: true })
  condicionesParticularesTexto!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  fecha_inicio!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  fecha_fin!: string;

  @ApiProperty({ enum: EstadoContrato, enumName: 'EstadoContrato' })
  estado!: EstadoContrato;

  /**
   * Estado de pago GUARDADO: lo recalcula la corrida diaria (contratos ACTIVO y, desde B-77, los
   * cerrados con deuda o cerrados hace poco) y cada aprobación o rechazo de pago. No se recalcula en
   * esta petición.
   */
  @ApiProperty({
    enum: EstadoPagoContrato,
    enumName: 'EstadoPagoContrato',
    example: EstadoPagoContrato.AL_DIA,
  })
  estado_pago!: EstadoPagoContrato;

  @ApiProperty({ type: String, format: 'date-time' })
  creado_en!: string;

  @ApiProperty()
  terminacionAnticipadaSolicitada!: boolean;

  @ApiProperty({
    enum: RolSolicitante,
    enumName: 'RolSolicitante',
    nullable: true,
  })
  terminacionAnticipadaSolicitadaPor!: RolSolicitante | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  terminacionAnticipadaSolicitadaEn!: string | null;

  @ApiProperty({ type: String, nullable: true })
  terminacionAnticipadaMotivo!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  terminacionAnticipadaConfirmadaEn!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  terminacion_fecha_efectiva!: string | null;

  @ApiProperty({
    enum: RolSolicitante,
    enumName: 'RolSolicitante',
    nullable: true,
  })
  terminacion_confirmada_por!: RolSolicitante | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  cancelado_en!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  vinculado_en!: string | null;

  /** true si el inquilino ya vinculó el contrato a su cuenta. */
  @ApiProperty()
  vinculado!: boolean;

  /** PDF heredado (DEPRECADO, ver documentos del contrato); URL firmada o null. */
  @ApiProperty({ type: String, nullable: true })
  pdf_contrato_url!: string | null;
}
