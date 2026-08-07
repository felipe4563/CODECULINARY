export const PALETA_DEFAULT = ['#ef4444', '#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

// Duración total de la animación de giro — usada tanto por la rueda como
// por quien la dispara (para saber cuándo mostrar el resultado). Debe
// coincidir exactamente con la transición CSS en Rueda.jsx.
export const DURACION_GIRO_MS = 5000;

export function etiquetaValor(p) {
  if (p.tipo === 'nada') return 'Sin premio';
  if (p.tipo === 'porcentaje') return `${parseFloat(p.valor)}%`;
  if (p.tipo === 'fijo') return `Bs ${parseFloat(p.valor).toFixed(2)}`;
  if (p.tipo === 'producto_gratis') return p.producto ? `Gratis: ${p.producto.nombre}` : 'Producto gratis';
  if (p.tipo === 'combo_gratis') return p.combo ? `Gratis: ${p.combo.nombre}` : 'Combo gratis';
  return '—';
}

// Reparte 360° en partes IGUALES entre los premios — a propósito no usa
// `probabilidad` acá: la probabilidad real de cada premio se decide en el
// backend (ver _sortear en ruleta.service.js), pero el tamaño del segmento
// se mantiene parejo para que la ruleta se vea estéticamente equilibrada
// aunque las probabilidades reales no lo estén.
export function calcularSegmentos(premios) {
  const tam = 360 / (premios.length || 1);
  return premios.map((p, i) => ({
    ...p, anguloInicio: tam * i, anguloTam: tam, color: p.color || PALETA_DEFAULT[i % PALETA_DEFAULT.length],
  }));
}
