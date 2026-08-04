export function calcularPrecioPesable(pesoKg, precioKg) {
  return Math.round(pesoKg * precioKg);
}

// Redondea hacia ARRIBA al siguiente múltiplo de 0.50 Bs — mismo criterio
// que usa el backend en _precioConPromocion, para que el precio con
// descuento de una promoción no quede en una fracción incómoda de cobrar en
// efectivo. Siempre hacia arriba (no al más cercano) para no perder margen.
export function redondearAMedio(monto) {
  return Math.ceil(monto / 0.5) * 0.5;
}
