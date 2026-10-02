import { ApiProperty } from '@nestjs/swagger';
import {
  EstadoSolicitudMantenimiento,
  TipoUnidad,
  UrgenciaMantenimiento,
  UsoPermitido,
} from '@prisma/client';

// Respuestas de los endpoints de mantenimiento (B-67). Las clases solo DESCRIBEN lo que ya devuelve
// el servicio (src/solicitud-mantenimiento/solicitud-mantenimiento.service.ts: `crear`, `listarMias`,
// `encontrarUnaDelInquilino`, `listar`, `encontrarUno` y `actualizarEstado`, todos por
// `exponerUrlFirmada`): no cambian nada. Los decoradores van explícitos para que el esquema salga
// igual con o sin el plugin de Swagger.

/** Tipo del adjunto, derivado de la extensión del archivo guardado (ver `tipoDeAdjunto`). */
export type AdjuntoTipoApi = 'IMAGEN' | 'VIDEO';

/**
 * Los campos escalares de la solicitud, más el adjunto firmado y su tipo. Nunca la ruta interna del
 * archivo (`adjunto_ruta`).
 */
export class SolicitudBaseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  arrendador_id!: string;

  @ApiProperty()
  unidad_id!: string;

  @ApiProperty()
  inquilino_id!: string;

  @ApiProperty()
  descripcion!: string;

  @ApiProperty({
    enum: UrgenciaMantenimiento,
    enumName: 'UrgenciaMantenimiento',
  })
  urgencia!: UrgenciaMantenimiento;

  @ApiProperty({
    enum: EstadoSolicitudMantenimiento,
    enumName: 'EstadoSolicitudMantenimiento',
  })
  estado!: EstadoSolicitudMantenimiento;

  @ApiProperty({ type: String, format: 'date-time' })
  creado_en!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  actualizado_en!: Date;

  /** URL firmada del adjunto (caduca), o null si no hay archivo o falló la firma. Nunca la ruta interna. */
  @ApiProperty({ type: String, nullable: true })
  adjunto_url!: string | null;

  /**
   * Tipo del adjunto, derivado de la extensión del archivo guardado. null si no hay adjunto o si no
   * se puede saber (una solicitud antigua con otra extensión o sin ella).
   */
  @ApiProperty({
    enum: ['IMAGEN', 'VIDEO'],
    enumName: 'TipoAdjunto',
    nullable: true,
  })
  adjunto_tipo!: AdjuntoTipoApi | null;
}

/** Respuesta 201 de `POST /solicitudes-mantenimiento` (y de la repetición idempotente). */
export class SolicitudCreadaDto extends SolicitudBaseDto {}

/**
 * La solicitud tal como la ve el inquilino (lista y detalle): sin unidad ni inmueble. Para saber de
 * qué unidad es, usa `unidad_id` o el filtro `?contratoId=` de la lista.
 */
export class SolicitudInquilinoDto extends SolicitudBaseDto {}

export class InmuebleDeSolicitudDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  direccion!: string;

  @ApiProperty()
  ciudad!: string;

  @ApiProperty({ type: Number, nullable: true })
  estrato!: number | null;

  @ApiProperty()
  matricula_inmobiliaria!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  creado_en!: Date;
}

export class UnidadDeSolicitudDto {
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

  @ApiProperty({ type: () => InmuebleDeSolicitudDto })
  inmueble!: InmuebleDeSolicitudDto;
}

/**
 * Nombre, cédula y teléfono de la COPIA del contrato (lo que escribió el arrendador). Si la unidad
 * ya no tiene un contrato no cancelado de esa persona, los tres van en null; nunca los del perfil.
 */
export class InquilinoDeSolicitudDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: String, nullable: true })
  nombre!: string | null;

  @ApiProperty({ type: String, nullable: true })
  cedula!: string | null;

  @ApiProperty({ type: String, nullable: true })
  telefono!: string | null;
}

/** La solicitud con su unidad (e inmueble) y su inquilino: lista, detalle y cambio de estado del arrendador. */
export class SolicitudArrendadorDto extends SolicitudBaseDto {
  @ApiProperty({ type: () => UnidadDeSolicitudDto })
  unidad!: UnidadDeSolicitudDto;

  @ApiProperty({ type: () => InquilinoDeSolicitudDto })
  inquilino!: InquilinoDeSolicitudDto;
}
