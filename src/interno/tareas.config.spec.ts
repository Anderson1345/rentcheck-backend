import { inspect } from 'util';
import { leerConfiguracionTareas } from './tareas.config';

describe('leerConfiguracionTareas', () => {
  it('sin TAREAS_SECRET (o vacía o solo espacios) no hay secreto configurado', () => {
    expect(leerConfiguracionTareas({}).secreto).toBeUndefined();
    expect(
      leerConfiguracionTareas({ TAREAS_SECRET: '' }).secreto,
    ).toBeUndefined();
    expect(
      leerConfiguracionTareas({ TAREAS_SECRET: '   ' }).secreto,
    ).toBeUndefined();
  });

  it('con TAREAS_SECRET devuelve el valor sin espacios sobrantes', () => {
    expect(
      leerConfiguracionTareas({ TAREAS_SECRET: '  valor-de-prueba  ' }).secreto,
    ).toBe('valor-de-prueba');
  });

  it('nunca lanza (la aplicación siempre arranca igual) ni muestra el valor al convertir a texto', () => {
    const configuracion = leerConfiguracionTareas({
      TAREAS_SECRET: 'valor-secreto-123',
    });
    expect(JSON.stringify(configuracion)).not.toContain('valor-secreto-123');
    expect(inspect(configuracion)).not.toContain('valor-secreto-123');
  });
});
