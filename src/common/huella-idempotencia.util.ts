import { createHash } from 'crypto';

function sha256Hex(contenido: Buffer | string): string {
  return createHash('sha256').update(contenido).digest('hex');
}

function fechaISO(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

export interface DatosHuellaPago {
  contratoId: string;
  monto_centavos: number;
  fecha_reportada: Date;
  periodo?: Date | null;
  comprobante: Buffer;
}

export interface DatosHuellaSolicitud {
  unidadId: string;
  descripcion: string;
  urgencia: string;
  adjunto?: Buffer | null;
}

/** SHA-256 hex de un JSON canónico (campos en orden fijo) de un pago. */
export function calcularHuellaPago(datos: DatosHuellaPago): string {
  const canonico = JSON.stringify({
    contratoId: datos.contratoId,
    monto_centavos: datos.monto_centavos,
    fecha_reportada: fechaISO(datos.fecha_reportada),
    periodo: datos.periodo ? fechaISO(datos.periodo) : null,
    comprobante: sha256Hex(datos.comprobante),
  });
  return sha256Hex(canonico);
}

/** SHA-256 hex de un JSON canónico (campos en orden fijo) de una solicitud. */
export function calcularHuellaSolicitud(datos: DatosHuellaSolicitud): string {
  const canonico = JSON.stringify({
    unidadId: datos.unidadId,
    descripcion: datos.descripcion,
    urgencia: datos.urgencia,
    adjunto: datos.adjunto ? sha256Hex(datos.adjunto) : null,
  });
  return sha256Hex(canonico);
}
