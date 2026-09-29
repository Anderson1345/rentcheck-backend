import { TerminosContrato } from './plantillas-contrato';

interface IncrementoParaTerminos {
  fecha_aplicacion: Date;
  creado_en: Date;
  canon_anterior_centavos: number;
}

interface ProrrogaParaTerminos {
  fecha_aplicacion: Date;
  creado_en: Date;
  fecha_fin_anterior: Date;
}

function porOrdenCronologico<
  T extends { fecha_aplicacion: Date; creado_en: Date },
>(a: T, b: T): number {
  return (
    a.fecha_aplicacion.getTime() - b.fecha_aplicacion.getTime() ||
    a.creado_en.getTime() - b.creado_en.getTime()
  );
}

/**
 * Términos con los que se firmó el contrato. `Contrato.canon_centavos` y
 * `fecha_fin` guardan los valores VIGENTES (tras incrementos y prórrogas): el
 * canon original es el `canon_anterior` del primer incremento y la fecha de
 * fin original es la `fecha_fin_anterior` de la primera prórroga. Sin
 * incrementos ni prórrogas, los vigentes son los originales.
 */
export function terminosOriginales(
  contrato: TerminosContrato,
  incrementos: IncrementoParaTerminos[],
  prorrogas: ProrrogaParaTerminos[],
): TerminosContrato {
  const primerIncremento = [...incrementos].sort(porOrdenCronologico)[0];
  const primeraProrroga = [...prorrogas].sort(porOrdenCronologico)[0];

  return {
    canon_centavos:
      primerIncremento?.canon_anterior_centavos ?? contrato.canon_centavos,
    fecha_fin: primeraProrroga?.fecha_fin_anterior ?? contrato.fecha_fin,
  };
}
