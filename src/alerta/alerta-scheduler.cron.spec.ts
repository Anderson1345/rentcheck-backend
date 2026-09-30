import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

function archivosTs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entrada) => {
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) return archivosTs(ruta);
    return ruta.endsWith('.ts') && !ruta.endsWith('.spec.ts') ? [ruta] : [];
  });
}

describe('tareas programadas', () => {
  const raiz = join(__dirname, '..');

  it('existe exactamente un @Cron, a las 00:05 de Bogotá', () => {
    const usos = archivosTs(raiz).flatMap((archivo) =>
      [...readFileSync(archivo, 'utf8').matchAll(/@Cron\(([^)]*)\)/g)].map(
        (m) => ({ archivo, argumentos: m[1] }),
      ),
    );
    expect(usos).toHaveLength(1);
    expect(usos[0].archivo).toContain('alerta-scheduler.service.ts');
    expect(usos[0].argumentos).toContain("'5 0 * * *'");
    expect(usos[0].argumentos).toContain("timeZone: 'America/Bogota'");
  });

  it('ciclo-pago.util.ts (sin usos, con hora local) ya no existe', () => {
    expect(existsSync(join(raiz, 'common', 'ciclo-pago.util.ts'))).toBe(false);
  });
});
