const { calcularPrecioPesable } = require('../src/utils/precio');

describe('calcularPrecioPesable', () => {
  it('redondea hacia arriba cuando el decimal es >= 0.5 (chorizo 1.7kg a Bs27/kg)', () => {
    expect(calcularPrecioPesable(1.7, 27)).toBe(46); // 1.7 * 27 = 45.90
  });

  it('redondea hacia abajo cuando el decimal es < 0.5', () => {
    expect(calcularPrecioPesable(1.674, 27)).toBe(45); // 1.674 * 27 = 45.198
  });

  it('redondea exactamente en .5 hacia arriba', () => {
    expect(calcularPrecioPesable(1, 3.5)).toBe(4); // 1 * 3.5 = 3.5
  });

  it('funciona con pesos menores a 1 kg', () => {
    expect(calcularPrecioPesable(0.35, 20)).toBe(7); // 0.35 * 20 = 7.00
  });
});
