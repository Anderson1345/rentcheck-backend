import { calcularCanonNuevo } from './canon-incremento.util';

describe('calcularCanonNuevo', () => {
  it('aplica el porcentaje sobre el canon en centavos', () => {
    expect(calcularCanonNuevo(1_000_000, 5.1)).toBe(1_051_000);
    expect(calcularCanonNuevo(150_000_000, 5.2)).toBe(157_800_000);
    expect(calcularCanonNuevo(1_000_000, 10)).toBe(1_100_000);
  });

  it('redondea .5 hacia arriba (half up)', () => {
    // 1.050 * 5 % = 52,5 → 53
    expect(calcularCanonNuevo(1_050, 5)).toBe(1_103);
    // 10 * 5 % = 0,5 → 1
    expect(calcularCanonNuevo(10, 5)).toBe(11);
    // 1.049 * 5 % = 52,45 → 52
    expect(calcularCanonNuevo(1_049, 5)).toBe(1_101);
  });

  it('no pierde precisión con canones grandes', () => {
    // 1e14 centavos * 5,20 % = 5.200.000.000.000 exactos
    expect(calcularCanonNuevo(100_000_000_000_000, 5.2)).toBe(
      105_200_000_000_000,
    );
    // canon * 10.000 supera 2^53 (≈ 9e15) con flotantes; con BigInt no
    expect(calcularCanonNuevo(900_719_925_474_000, 5)).toBe(
      900_719_925_474_000 + 45_035_996_273_700,
    );
  });

  it('el punto base se redondea sin errores de flotante (5,1 % = 510 pb)', () => {
    expect(calcularCanonNuevo(1_000_000_000, 5.1)).toBe(1_051_000_000);
  });

  it('acepta hasta 2 decimales y 0 % deja el canon igual', () => {
    expect(calcularCanonNuevo(1_000_000, 5.55)).toBe(1_055_500);
    expect(calcularCanonNuevo(1_000_000, 0)).toBe(1_000_000);
  });
});
