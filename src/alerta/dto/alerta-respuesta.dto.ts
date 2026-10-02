import { ApiProperty } from '@nestjs/swagger';
import { TipoAlerta } from '@prisma/client';
import type { TipoRecursoAlerta } from '../alerta-recurso.util';

// Respuestas del feed de alertas (B0.6-B1, B-18) para arrendador e inquilino. Las clases solo DESCRIBEN
// lo que arma `AlertaService` (con `derivarRecurso`): no cambian nada. Los decoradores van explícitos
// para que el esquema salga igual con o sin el plugin de Swagger.

export const TIPOS_RECURSO_ALERTA: readonly TipoRecursoAlerta[] = [
  'PAGO',
  'SOLICITUD_MANTENIMIENTO',
  'PERIODO',
  'CONTRATO',
];

/**
 * A dónde navega la app al abrir la alerta (derivado al responder, no se guarda). Prioridad: pago >
 * solicitud de mantenimiento > período > contrato.
 */
export class AlertaRecursoDto {
  @ApiProperty({
    enum: TIPOS_RECURSO_ALERTA,
    enumName: 'TipoRecursoAlerta',
    example: 'PAGO',
  })
  tipo!: TipoRecursoAlerta;

  /**
   * Id del recurso: el pago, la solicitud de mantenimiento o el contrato. Es null en `PERIODO` (un
   * período no tiene id propio: se abre con `contrato_id` + `periodo`).
   */
  @ApiProperty({ type: String, nullable: true })
  id!: string | null;

  /**
   * Contrato al que pertenece. Es siempre null en `SOLICITUD_MANTENIMIENTO` (la solicitud no guarda
   * contrato, B-74) y puede ser null en un `PAGO` sin contrato registrado en la alerta.
   */
  @ApiProperty({ type: String, nullable: true })
  contrato_id!: string | null;

  /**
   * Primer día del mes que cubre, `AAAA-MM-DD`. Siempre presente en `PERIODO`; en `PAGO` puede ser
   * null; no se envía en `SOLICITUD_MANTENIMIENTO` ni en `CONTRATO`.
   */
  @ApiProperty({
    type: String,
    nullable: true,
    required: false,
    example: '2026-10-01',
  })
  periodo?: string | null;
}

export class AlertaDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: TipoAlerta, enumName: 'TipoAlerta' })
  tipo!: TipoAlerta;

  @ApiProperty({ example: 'Tu pago de octubre fue aprobado.' })
  mensaje!: string;

  @ApiProperty()
  leida!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  creado_en!: Date;

  /** A dónde navegar; null si la alerta no apunta a nada. */
  @ApiProperty({ type: () => AlertaRecursoDto, nullable: true })
  recurso!: AlertaRecursoDto | null;
}

export class FeedAlertasDto {
  /** Más recientes primero. */
  @ApiProperty({ type: () => [AlertaDto] })
  items!: AlertaDto[];

  /** Cursor opaco para pedir la página siguiente; null si no hay más. */
  @ApiProperty({ type: String, nullable: true })
  siguiente_cursor!: string | null;

  /** Total de alertas no leídas del usuario, sin importar el filtro `leida` ni la página. */
  @ApiProperty({ example: 3 })
  no_leidas!: number;
}

export class ConteoAlertasDto {
  @ApiProperty({ example: 3 })
  no_leidas!: number;
}

export class MarcadasDto {
  /** Cuántas alertas pasaron de no leída a leída en esta llamada. */
  @ApiProperty({ example: 3 })
  marcadas!: number;
}
