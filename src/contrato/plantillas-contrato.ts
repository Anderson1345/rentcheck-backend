import { TipoPlantillaContrato } from '@prisma/client';
import { mesesDeTermino } from '../common/fechas-contrato.util';

/**
 * Términos que cambian con incrementos y prórrogas. El texto del contrato
 * original se arma con los términos ORIGINALES; ver `terminosOriginales`.
 */
export interface TerminosContrato {
  canon_centavos: number;
  fecha_fin: Date;
}

export interface DatosContratoParaTexto {
  tipo_plantilla: TipoPlantillaContrato;
  deposito_centavos: number | null;
  dia_pago: number;
  forma_pago: string;
  datos_recaudo: string;
  datos_fiador_o_poliza: string | null;
  condicionesParticularesTexto: string | null;
  fecha_inicio: Date;
  arrendador: { nombre: string; cedula: string | null };
  inquilino: { nombre: string; cedula: string };
  unidad: {
    nombre: string;
    inmueble: { direccion: string; ciudad: string };
  };
}

interface Clausula {
  titulo: string;
  texto: string;
  tipo?: 'DEPOSITO' | 'GARANTIAS';
}

interface PlantillaBase {
  titulo: string;
  introduccion: string;
  clausulas: Clausula[];
}

const ORDINALES = [
  'PRIMERA',
  'SEGUNDA',
  'TERCERA',
  'CUARTA',
  'QUINTA',
  'SEXTA',
  'SÉPTIMA',
  'OCTAVA',
  'NOVENA',
  'DÉCIMA',
  'UNDÉCIMA',
  'DUODÉCIMA',
];

const PLANTILLA_VIVIENDA_URBANA_LEY_820: PlantillaBase = {
  titulo: `CONTRATO DE ARRENDAMIENTO DE VIVIENDA URBANA`,
  introduccion: `Entre los suscritos, {{arrendador_nombre}}, identificado(a) con cédula de ciudadanía No. {{arrendador_cedula}}, quien en adelante se denominará EL ARRENDADOR, y {{inquilino_nombre}}, identificado(a) con cédula de ciudadanía No. {{inquilino_cedula}}, quien en adelante se denominará EL ARRENDATARIO, hemos convenido celebrar el presente contrato de arrendamiento de vivienda urbana, el cual se regirá por la Ley 820 de 2003 y demás normas concordantes, y por las siguientes cláusulas:`,
  clausulas: [
    {
      titulo: 'OBJETO',
      texto: `EL ARRENDADOR entrega a título de arrendamiento a EL ARRENDATARIO el inmueble ubicado en {{unidad_direccion_completa}}, para ser destinado exclusivamente a vivienda.`,
    },
    {
      titulo: 'CANON DE ARRENDAMIENTO',
      texto: `El canon mensual de arrendamiento es de {{canon_en_pesos}}, pagadero por mes anticipado, a más tardar el día {{dia_pago}} de cada mes, mediante {{forma_pago}}, a través de: {{datos_recaudo}}.`,
    },
    {
      titulo: 'TÉRMINO',
      texto: `El presente contrato tendrá una duración de {{duracion_en_meses}}, contado a partir del {{fecha_inicio}} hasta el {{fecha_fin}}, prorrogable en los términos previstos por la Ley 820 de 2003.`,
    },
    {
      titulo: 'GARANTÍAS',
      tipo: 'GARANTIAS',
      texto: '',
    },
    {
      titulo: 'DESTINACIÓN Y USO',
      texto: `EL ARRENDATARIO se obliga a destinar el inmueble única y exclusivamente para vivienda, sin poder darle un uso distinto, ni subarrendarlo total o parcialmente sin autorización previa y escrita de EL ARRENDADOR.`,
    },
    {
      titulo: 'ESTADO DEL INMUEBLE',
      texto: `EL ARRENDATARIO declara recibir el inmueble en el estado que consta en el inventario fotográfico de entrega anexo a este contrato, y se obliga a restituirlo en las mismas condiciones, salvo el deterioro natural por el uso legítimo del mismo.`,
    },
    {
      titulo: 'SERVICIOS PÚBLICOS',
      texto: `Los servicios públicos domiciliarios del inmueble serán asumidos por EL ARRENDATARIO, salvo que las condiciones particulares de este contrato indiquen algo distinto.`,
    },
    {
      titulo: 'CAUSALES DE TERMINACIÓN',
      texto: `Además de las causales previstas en la Ley 820 de 2003, dan lugar a la terminación del contrato el incumplimiento reiterado en el pago del canon, el uso del inmueble para un fin distinto al pactado, y el subarriendo no autorizado.`,
    },
  ],
};

const PLANTILLA_LOCAL_COMERCIAL: PlantillaBase = {
  titulo: `CONTRATO DE ARRENDAMIENTO DE LOCAL COMERCIAL`,
  introduccion: `Entre los suscritos, {{arrendador_nombre}}, identificado(a) con cédula de ciudadanía No. {{arrendador_cedula}}, quien en adelante se denominará EL ARRENDADOR, y {{inquilino_nombre}}, identificado(a) con cédula de ciudadanía No. {{inquilino_cedula}}, quien en adelante se denominará EL ARRENDATARIO, hemos convenido celebrar el presente contrato de arrendamiento de local comercial, regido por las disposiciones del Código de Comercio colombiano en lo relativo al arrendamiento de establecimientos y locales de comercio, y por las siguientes cláusulas:`,
  clausulas: [
    {
      titulo: 'OBJETO',
      texto: `EL ARRENDADOR entrega a título de arrendamiento a EL ARRENDATARIO el inmueble de uso comercial ubicado en {{unidad_direccion_completa}}.`,
    },
    {
      titulo: 'CANON DE ARRENDAMIENTO',
      texto: `El canon mensual de arrendamiento es de {{canon_en_pesos}}, pagadero por mes anticipado, a más tardar el día {{dia_pago}} de cada mes, mediante {{forma_pago}}, a través de: {{datos_recaudo}}.`,
    },
    {
      titulo: 'TÉRMINO',
      texto: `El presente contrato tendrá una duración de {{duracion_en_meses}}, contado a partir del {{fecha_inicio}} hasta el {{fecha_fin}}.`,
    },
    {
      titulo: 'DEPÓSITO',
      tipo: 'DEPOSITO',
      texto: `EL ARRENDATARIO entrega en este acto a EL ARRENDADOR, a título de depósito en garantía, la suma de {{deposito_en_pesos}}, la cual será restituida al finalizar el contrato, previa verificación del estado del inmueble y de que no existan sumas pendientes por concepto de cánones, servicios públicos o daños imputables a EL ARRENDATARIO.`,
    },
    {
      titulo: 'DESTINACIÓN Y USO',
      texto: `EL ARRENDATARIO se obliga a destinar el inmueble exclusivamente a la actividad comercial descrita en las condiciones particulares de este contrato, sin poder cambiarla ni subarrendar el local total o parcialmente sin autorización previa y escrita de EL ARRENDADOR.`,
    },
    {
      titulo: 'ESTADO DEL INMUEBLE',
      texto: `EL ARRENDATARIO declara recibir el inmueble en el estado que consta en el inventario fotográfico de entrega anexo a este contrato, y se obliga a restituirlo en las mismas condiciones, salvo el deterioro natural por el uso legítimo del mismo.`,
    },
    {
      titulo: 'LICENCIAS Y PERMISOS',
      texto: `La obtención de las licencias, permisos y registros necesarios para el funcionamiento de la actividad comercial de EL ARRENDATARIO corren por cuenta exclusiva de este, sin que ello sea responsabilidad de EL ARRENDADOR.`,
    },
    {
      titulo: 'CAUSALES DE TERMINACIÓN',
      texto: `Dan lugar a la terminación del contrato el incumplimiento reiterado en el pago del canon, el uso del inmueble para una actividad distinta a la pactada, y el subarriendo no autorizado.`,
    },
  ],
};

const PLANTILLA_PARQUEADERO: PlantillaBase = {
  titulo: `CONTRATO DE ARRENDAMIENTO DE PARQUEADERO`,
  introduccion: `Entre los suscritos, {{arrendador_nombre}}, identificado(a) con cédula de ciudadanía No. {{arrendador_cedula}}, quien en adelante se denominará EL ARRENDADOR, y {{inquilino_nombre}}, identificado(a) con cédula de ciudadanía No. {{inquilino_cedula}}, quien en adelante se denominará EL ARRENDATARIO, hemos convenido celebrar el presente contrato de arrendamiento de espacio de parqueadero, regido por las disposiciones generales del Código Civil colombiano en materia de arrendamiento, y por las siguientes cláusulas:`,
  clausulas: [
    {
      titulo: 'OBJETO',
      texto: `EL ARRENDADOR entrega a título de arrendamiento a EL ARRENDATARIO el espacio de parqueadero identificado como {{unidad_direccion_completa}}, para uso exclusivo de estacionamiento de un (1) vehículo.`,
    },
    {
      titulo: 'CANON DE ARRENDAMIENTO',
      texto: `El canon mensual de arrendamiento es de {{canon_en_pesos}}, pagadero por mes anticipado, a más tardar el día {{dia_pago}} de cada mes, mediante {{forma_pago}}, a través de: {{datos_recaudo}}.`,
    },
    {
      titulo: 'TÉRMINO',
      texto: `El presente contrato tendrá una duración de {{duracion_en_meses}}, contado a partir del {{fecha_inicio}} hasta el {{fecha_fin}}.`,
    },
    {
      titulo: 'DEPÓSITO',
      tipo: 'DEPOSITO',
      texto: `EL ARRENDATARIO entrega en este acto a EL ARRENDADOR, a título de depósito en garantía, la suma de {{deposito_en_pesos}}, la cual será restituida al finalizar el contrato, previa verificación del estado del espacio y de que no existan sumas pendientes por concepto de cánones o daños imputables a EL ARRENDATARIO.`,
    },
    {
      titulo: 'DESTINACIÓN Y USO',
      texto: `EL ARRENDATARIO se obliga a destinar el espacio exclusivamente al estacionamiento de vehículos automotores, sin poder usarlo como bodega, depósito de mercancía, ni subarrendarlo sin autorización previa y escrita de EL ARRENDADOR.`,
    },
    {
      titulo: 'ESTADO DEL ESPACIO',
      texto: `EL ARRENDATARIO declara recibir el espacio en el estado que consta en el inventario fotográfico de entrega anexo a este contrato, y se obliga a restituirlo en las mismas condiciones, salvo el deterioro natural por el uso legítimo del mismo.`,
    },
    {
      titulo: 'RESPONSABILIDAD',
      texto: `EL ARRENDADOR no será responsable por daños, hurto o pérdida de bienes dejados dentro del vehículo estacionado, salvo negligencia grave que le sea directamente imputable.`,
    },
    {
      titulo: 'CAUSALES DE TERMINACIÓN',
      texto: `Dan lugar a la terminación del contrato el incumplimiento reiterado en el pago del canon, el uso del espacio para un fin distinto al pactado, y el subarriendo no autorizado.`,
    },
  ],
};

const CIERRE_PLANTILLA = `

CONDICIONES PARTICULARES DEL CONTRATO

{{condiciones_particulares_o_texto_por_defecto}}

Para constancia se firma el presente contrato en la ciudad de {{ciudad}}, el día {{fecha_generacion}}.

_______________________________
EL ARRENDADOR — {{arrendador_nombre}}

_______________________________
EL ARRENDATARIO — {{inquilino_nombre}}`;

function obtenerPlantillaBase(tipo: TipoPlantillaContrato): PlantillaBase {
  switch (tipo) {
    case TipoPlantillaContrato.VIVIENDA_URBANA_LEY_820:
      return PLANTILLA_VIVIENDA_URBANA_LEY_820;
    case TipoPlantillaContrato.LOCAL_COMERCIAL:
      return PLANTILLA_LOCAL_COMERCIAL;
    case TipoPlantillaContrato.PARQUEADERO:
      return PLANTILLA_PARQUEADERO;
  }
}

export function formatearCentavosAPesos(centavos: number): string {
  return `$${(centavos / 100).toLocaleString('es-CO')}`;
}

const UNIDADES = [
  '',
  'un',
  'dos',
  'tres',
  'cuatro',
  'cinco',
  'seis',
  'siete',
  'ocho',
  'nueve',
  'diez',
  'once',
  'doce',
  'trece',
  'catorce',
  'quince',
  'dieciséis',
  'diecisiete',
  'dieciocho',
  'diecinueve',
  'veinte',
  'veintiún',
  'veintidós',
  'veintitrés',
  'veinticuatro',
  'veinticinco',
  'veintiséis',
  'veintisiete',
  'veintiocho',
  'veintinueve',
];

const DECENAS = [
  '',
  '',
  '',
  'treinta',
  'cuarenta',
  'cincuenta',
  'sesenta',
  'setenta',
  'ochenta',
  'noventa',
];

function numeroEnLetras(numero: number): string | null {
  if (!Number.isInteger(numero) || numero < 1 || numero > 99) {
    return null;
  }
  if (numero < 30) {
    return UNIDADES[numero];
  }
  const decena = DECENAS[Math.floor(numero / 10)];
  const unidad = numero % 10;
  return unidad === 0 ? decena : `${decena} y ${UNIDADES[unidad]}`;
}

/** "doce (12) meses", "un (1) mes"; sin letras si el número es muy grande. */
function duracionEnTexto(meses: number): string {
  const unidad = meses === 1 ? 'mes' : 'meses';
  const letras = numeroEnLetras(meses);
  return letras ? `${letras} (${meses}) ${unidad}` : `${meses} ${unidad}`;
}

/**
 * Arma el texto del contrato con los términos (canon y fecha de fin) que se
 * le indiquen. La duración se calcula en meses a partir de las fechas. El depósito solo aparece en Local y
 * Parqueadero cuando hay depósito (Ley 820, art. 16, lo prohíbe en
 * vivienda); la vivienda lleva una cláusula de garantías en su lugar. Las
 * cláusulas se numeran según las que efectivamente se incluyen.
 */
export function construirTextoContrato(
  contrato: DatosContratoParaTexto,
  terminos: TerminosContrato,
  ahora: Date = new Date(),
): string {
  const plantilla = obtenerPlantillaBase(contrato.tipo_plantilla);
  const datosFiadorOPoliza = contrato.datos_fiador_o_poliza?.trim() ?? '';
  const hayDeposito = (contrato.deposito_centavos ?? 0) > 0;
  const esVivienda =
    contrato.tipo_plantilla === TipoPlantillaContrato.VIVIENDA_URBANA_LEY_820;

  const clausulas: Clausula[] = plantilla.clausulas
    .filter((clausula) => clausula.tipo !== 'DEPOSITO' || hayDeposito)
    .map((clausula) =>
      clausula.tipo === 'GARANTIAS'
        ? {
            ...clausula,
            texto: datosFiadorOPoliza
              ? 'Como garantía del cumplimiento de las obligaciones de este contrato las partes pactan la siguiente: {{datos_fiador_o_poliza}}.'
              : 'Sin garantías adicionales.',
          }
        : clausula,
    );

  if (!esVivienda && datosFiadorOPoliza) {
    clausulas.push({
      titulo: 'GARANTÍA ADICIONAL',
      texto:
        'El presente contrato cuenta con la siguiente garantía adicional: {{datos_fiador_o_poliza}}.',
    });
  }

  const cuerpo = clausulas
    .map(
      (clausula, indice) =>
        `${ORDINALES[indice]} — ${clausula.titulo}. ${clausula.texto}`,
    )
    .join('\n\n');

  const texto = `${plantilla.titulo}\n\n${plantilla.introduccion}\n\n${cuerpo}${CIERRE_PLANTILLA}`;

  return texto
    .split('{{arrendador_nombre}}')
    .join(contrato.arrendador.nombre)
    .split('{{arrendador_cedula}}')
    .join(
      contrato.arrendador.cedula?.trim() || '[cédula pendiente de registrar]',
    )
    .split('{{inquilino_nombre}}')
    .join(contrato.inquilino.nombre)
    .split('{{inquilino_cedula}}')
    .join(contrato.inquilino.cedula)
    .split('{{unidad_direccion_completa}}')
    .join(`${contrato.unidad.inmueble.direccion}, ${contrato.unidad.nombre}`)
    .split('{{canon_en_pesos}}')
    .join(formatearCentavosAPesos(terminos.canon_centavos))
    .split('{{dia_pago}}')
    .join(String(contrato.dia_pago))
    .split('{{forma_pago}}')
    .join(contrato.forma_pago)
    .split('{{datos_recaudo}}')
    .join(contrato.datos_recaudo)
    .split('{{deposito_en_pesos}}')
    .join(formatearCentavosAPesos(contrato.deposito_centavos ?? 0))
    .split('{{fecha_inicio}}')
    .join(contrato.fecha_inicio.toISOString().slice(0, 10))
    .split('{{fecha_fin}}')
    .join(terminos.fecha_fin.toISOString().slice(0, 10))
    .split('{{duracion_en_meses}}')
    .join(
      duracionEnTexto(
        mesesDeTermino(contrato.fecha_inicio, terminos.fecha_fin),
      ),
    )
    .split('{{datos_fiador_o_poliza}}')
    .join(datosFiadorOPoliza)
    .split('{{condiciones_particulares_o_texto_por_defecto}}')
    .join(
      contrato.condicionesParticularesTexto?.trim() ||
        'No aplican condiciones particulares adicionales a las aquí pactadas.',
    )
    .split('{{ciudad}}')
    .join(contrato.unidad.inmueble.ciudad)
    .split('{{fecha_generacion}}')
    .join(ahora.toLocaleString('es-CO'));
}
