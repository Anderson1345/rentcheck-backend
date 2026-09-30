export interface ConfiguracionTareas {
  /** Secreto del endpoint interno; `undefined` si no está configurado. */
  secreto?: string;
}

/**
 * Lee `TAREAS_SECRET`. Nunca lanza (la aplicación siempre arranca igual; sin
 * la variable el endpoint responde 503) y nunca expone el valor: al
 * convertirla a texto o a JSON el secreto no aparece.
 */
export function leerConfiguracionTareas(
  env: Record<string, string | undefined>,
): ConfiguracionTareas {
  const valor = env.TAREAS_SECRET?.trim();
  const configuracion: ConfiguracionTareas = {};
  if (valor) {
    Object.defineProperty(configuracion, 'secreto', {
      value: valor,
      enumerable: false,
    });
  }
  return configuracion;
}
