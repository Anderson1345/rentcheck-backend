/**
 * Simulación opcional del reloj para TODA la suite e2e: con
 * `RELOJ_SIMULADO=2027-03-15T15:00:00Z` el `Date` arranca en esa fecha (solo
 * `Date`; los temporizadores siguen reales) y AVANZA con el tiempo real (un
 * reloj congelado haría chocar, por ejemplo, rutas de archivo basadas en
 * `Date.now()`). Sin la variable no hace nada. Sirve para comprobar que ninguna
 * prueba depende del año en curso.
 */
const simulado = process.env.RELOJ_SIMULADO;

function instalarReloj(now: Date): void {
  jest.useFakeTimers({
    now,
    advanceTimers: true,
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
  });
}

if (simulado) {
  const now = new Date(simulado);
  if (Number.isNaN(now.getTime())) {
    throw new Error('RELOJ_SIMULADO no es una fecha válida.');
  }
  // Al cargar el archivo de prueba (algunas calculan `hoy` a nivel de módulo)…
  instalarReloj(now);
  // …y antes de cada prueba: algunas llaman a `jest.useRealTimers()`.
  beforeEach(() => {
    instalarReloj(now);
  });
}
