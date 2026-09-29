import { construirTextoOtrosi } from './plantillas-otrosi';

const f = (anio: number, mes: number, dia: number) =>
  new Date(Date.UTC(anio, mes - 1, dia));

const base = {
  arrendador: { nombre: 'Ana Arrendadora', cedula: '900123456' },
  inquilino: { nombre: 'Ivan Inquilino', cedula: '1000111222' },
  unidad: {
    nombre: 'Apto 101',
    inmueble: { direccion: 'Calle 1 # 2-3', ciudad: 'Bogotá' },
  },
  fecha_inicio: f(2026, 1, 10),
};

const ahora = new Date('2027-01-20T15:00:00Z');

describe('construirTextoOtrosi', () => {
  describe('incremento', () => {
    const datos = {
      ...base,
      fecha_aplicacion: f(2027, 1, 20),
      canon_anterior_centavos: 100_000_000,
      canon_nuevo_centavos: 105_100_000,
      porcentaje_aplicado: 5.1,
      ipc_referencia_anio: 2026 as number | null,
      ipc_referencia_porcentaje: 5.1 as number | null,
    };

    it('identifica a las partes, el contrato original y el inmueble', () => {
      const texto = construirTextoOtrosi('OTROSI_INCREMENTO', datos, ahora);

      expect(texto).toContain('OTROSÍ');
      expect(texto).toContain('Ana Arrendadora');
      expect(texto).toContain('900123456');
      expect(texto).toContain('Ivan Inquilino');
      expect(texto).toContain('1000111222');
      expect(texto).toContain('2026-01-10');
      expect(texto).toContain('Calle 1 # 2-3, Apto 101');
    });

    it('trae la fecha de aplicación, los cánones en pesos, el porcentaje y el IPC de referencia', () => {
      const texto = construirTextoOtrosi('OTROSI_INCREMENTO', datos, ahora);

      expect(texto).toContain('2027-01-20');
      expect(texto).toContain('$1.000.000');
      expect(texto).toContain('$1.051.000');
      expect(texto).toContain('5,1');
      expect(texto).toContain('2026');
    });

    it('sin IPC de referencia no menciona el IPC', () => {
      const texto = construirTextoOtrosi(
        'OTROSI_INCREMENTO',
        {
          ...datos,
          ipc_referencia_anio: null,
          ipc_referencia_porcentaje: null,
        },
        ahora,
      );

      expect(texto).not.toMatch(/IPC/);
    });

    it('cierra con la cláusula de que las demás cláusulas siguen vigentes y con las firmas', () => {
      const texto = construirTextoOtrosi('OTROSI_INCREMENTO', datos, ahora);

      expect(texto).toMatch(/demás cláusulas/i);
      expect(texto).toMatch(
        /plena vigencia|siguen vigentes|continúan vigentes/i,
      );
      expect(texto).toContain('EL ARRENDADOR — Ana Arrendadora');
      expect(texto).toContain('EL ARRENDATARIO — Ivan Inquilino');
      expect(texto).not.toMatch(/\{\{/);
    });
  });

  describe('prórroga', () => {
    const datos = {
      ...base,
      fecha_aplicacion: f(2026, 11, 5),
      fecha_fin_anterior: f(2026, 12, 31),
      fecha_fin_nueva: f(2027, 12, 31),
      meses: 12,
      tipo_prorroga: 'MANUAL' as const,
    };

    it('trae la fecha de fin anterior y la nueva, los meses y el tipo manual', () => {
      const texto = construirTextoOtrosi('OTROSI_PRORROGA', datos, ahora);

      expect(texto).toContain('2026-12-31');
      expect(texto).toContain('2027-12-31');
      expect(texto).toContain('12');
      expect(texto).toMatch(/acuerdo|manual/i);
      expect(texto).toContain('Ana Arrendadora');
      expect(texto).toContain('Ivan Inquilino');
    });

    it('prórroga automática lo indica y mantiene el cierre', () => {
      const texto = construirTextoOtrosi(
        'OTROSI_PRORROGA',
        { ...datos, tipo_prorroga: 'AUTOMATICA' },
        ahora,
      );

      expect(texto).toMatch(/autom[áa]tica/i);
      expect(texto).toMatch(/demás cláusulas/i);
      expect(texto).not.toMatch(/\{\{/);
    });
  });
});
