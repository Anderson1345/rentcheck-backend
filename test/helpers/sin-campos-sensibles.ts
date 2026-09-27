function recolectarClavesProhibidas(
  valor: unknown,
  ruta: string,
  encontradas: string[],
): void {
  if (Array.isArray(valor)) {
    valor.forEach((elemento, indice) =>
      recolectarClavesProhibidas(elemento, `${ruta}[${indice}]`, encontradas),
    );
    return;
  }

  if (valor !== null && typeof valor === 'object') {
    for (const [clave, valorHijo] of Object.entries(valor)) {
      const rutaActual = ruta ? `${ruta}.${clave}` : clave;
      if (clave === 'contrasena_hash' || clave.endsWith('_ruta')) {
        encontradas.push(rutaActual);
      }
      recolectarClavesProhibidas(valorHijo, rutaActual, encontradas);
    }
  }
}

/**
 * Recorre el JSON en profundidad y falla si encuentra una clave
 * `contrasena_hash` o una clave que termine en `_ruta`.
 */
export function esperarSinCamposSensibles(cuerpo: unknown): void {
  const encontradas: string[] = [];
  recolectarClavesProhibidas(cuerpo, '', encontradas);
  if (encontradas.length > 0) {
    throw new Error(
      `Se encontraron campos sensibles en la respuesta: ${encontradas.join(', ')}`,
    );
  }
}
