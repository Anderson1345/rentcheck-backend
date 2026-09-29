import { formatearCentavosAPesos } from './plantillas-contrato';

interface DatosOtrosiBase {
  arrendador: { nombre: string; cedula: string | null };
  inquilino: { nombre: string; cedula: string };
  unidad: {
    nombre: string;
    inmueble: { direccion: string; ciudad: string };
  };
  /** Fecha de inicio del contrato original. */
  fecha_inicio: Date;
  /** Fecha en que se aplicó el incremento o la prórroga. */
  fecha_aplicacion: Date;
}

export interface DatosOtrosiIncremento extends DatosOtrosiBase {
  canon_anterior_centavos: number;
  canon_nuevo_centavos: number;
  porcentaje_aplicado: number;
  ipc_referencia_anio: number | null;
  ipc_referencia_porcentaje: number | null;
}

export interface DatosOtrosiProrroga extends DatosOtrosiBase {
  fecha_fin_anterior: Date;
  fecha_fin_nueva: Date;
  meses: number;
  tipo_prorroga: 'MANUAL' | 'AUTOMATICA';
}

const ORDINALES = ['PRIMERA', 'SEGUNDA', 'TERCERA', 'CUARTA'];

const fechaISO = (fecha: Date): string => fecha.toISOString().slice(0, 10);

const porcentajeEnTexto = (porcentaje: number): string =>
  `${String(porcentaje).replace('.', ',')} %`;

function encabezado(titulo: string, datos: DatosOtrosiBase): string {
  const cedulaArrendador =
    datos.arrendador.cedula?.trim() || '[cédula pendiente de registrar]';
  return `${titulo}

Entre los suscritos, ${datos.arrendador.nombre}, identificado(a) con cédula de ciudadanía No. ${cedulaArrendador}, quien en adelante se denominará EL ARRENDADOR, y ${datos.inquilino.nombre}, identificado(a) con cédula de ciudadanía No. ${datos.inquilino.cedula}, quien en adelante se denominará EL ARRENDATARIO, partes del contrato de arrendamiento del inmueble ubicado en ${datos.unidad.inmueble.direccion}, ${datos.unidad.nombre}, con fecha de inicio ${fechaISO(datos.fecha_inicio)} (en adelante, EL CONTRATO), acuerdan el presente otrosí:`;
}

function cierre(datos: DatosOtrosiBase, ahora: Date): string {
  return `Para constancia se firma el presente otrosí en la ciudad de ${datos.unidad.inmueble.ciudad}, el día ${ahora.toLocaleString('es-CO')}.

_______________________________
EL ARRENDADOR — ${datos.arrendador.nombre}

_______________________________
EL ARRENDATARIO — ${datos.inquilino.nombre}`;
}

function numerar(clausulas: Array<{ titulo: string; texto: string }>): string {
  return clausulas
    .map(
      (clausula, indice) =>
        `${ORDINALES[indice]} — ${clausula.titulo}. ${clausula.texto}`,
    )
    .join('\n\n');
}

const CLAUSULA_VIGENCIA = {
  titulo: 'VIGENCIA DE LAS DEMÁS CLÁUSULAS',
  texto:
    'Las demás cláusulas de EL CONTRATO y de sus modificaciones anteriores no se alteran y continúan vigentes en los términos pactados.',
};

function textoIncremento(datos: DatosOtrosiIncremento, ahora: Date): string {
  const clausulas = [
    {
      titulo: 'INCREMENTO DEL CANON',
      texto: `A partir del ${fechaISO(datos.fecha_aplicacion)}, el canon mensual de arrendamiento pasa de ${formatearCentavosAPesos(datos.canon_anterior_centavos)} a ${formatearCentavosAPesos(datos.canon_nuevo_centavos)}, lo que corresponde a un incremento del ${porcentajeEnTexto(datos.porcentaje_aplicado)} sobre el canon anterior.`,
    },
  ];
  if (
    datos.ipc_referencia_anio !== null &&
    datos.ipc_referencia_porcentaje !== null
  ) {
    clausulas.push({
      titulo: 'REFERENCIA',
      texto: `Como referencia, el IPC del año ${datos.ipc_referencia_anio} registrado en el sistema es de ${porcentajeEnTexto(datos.ipc_referencia_porcentaje)}.`,
    });
  }
  clausulas.push(CLAUSULA_VIGENCIA);

  return `${encabezado('OTROSÍ AL CONTRATO DE ARRENDAMIENTO — INCREMENTO DEL CANON', datos)}\n\n${numerar(clausulas)}\n\n${cierre(datos, ahora)}`;
}

function textoProrroga(datos: DatosOtrosiProrroga, ahora: Date): string {
  const origen =
    datos.tipo_prorroga === 'AUTOMATICA'
      ? 'La prórroga es automática, por no haberse dado aviso de no renovación.'
      : 'La prórroga se pacta de común acuerdo entre las partes.';
  const clausulas = [
    {
      titulo: 'PRÓRROGA DEL TÉRMINO',
      texto: `El término de EL CONTRATO, que vencía el ${fechaISO(datos.fecha_fin_anterior)}, se prorroga por ${datos.meses} ${datos.meses === 1 ? 'mes' : 'meses'}, de modo que vencerá el ${fechaISO(datos.fecha_fin_nueva)}. ${origen} La prórroga se aplicó el ${fechaISO(datos.fecha_aplicacion)}.`,
    },
    CLAUSULA_VIGENCIA,
  ];

  return `${encabezado('OTROSÍ AL CONTRATO DE ARRENDAMIENTO — PRÓRROGA DEL TÉRMINO', datos)}\n\n${numerar(clausulas)}\n\n${cierre(datos, ahora)}`;
}

/**
 * Texto del otrosí que deja constancia de un incremento de canon o de una
 * prórroga. No modifica el contrato original: se genera como un documento
 * nuevo.
 */
export function construirTextoOtrosi(
  tipo: 'OTROSI_INCREMENTO',
  datos: DatosOtrosiIncremento,
  ahora?: Date,
): string;
export function construirTextoOtrosi(
  tipo: 'OTROSI_PRORROGA',
  datos: DatosOtrosiProrroga,
  ahora?: Date,
): string;
export function construirTextoOtrosi(
  tipo: 'OTROSI_INCREMENTO' | 'OTROSI_PRORROGA',
  datos: DatosOtrosiIncremento | DatosOtrosiProrroga,
  ahora: Date = new Date(),
): string {
  return tipo === 'OTROSI_INCREMENTO'
    ? textoIncremento(datos as DatosOtrosiIncremento, ahora)
    : textoProrroga(datos as DatosOtrosiProrroga, ahora);
}
