function calcularPrecioPesable(pesoKg, precioKg) {
  return Math.round(pesoKg * precioKg);
}

// Redondea hacia ARRIBA al siguiente múltiplo de 0.50 Bs — para que el
// precio con descuento de una promoción no quede en una fracción incómoda
// de cobrar en efectivo (ej. 14.70 -> 15.00, 14.40 -> 14.50). Siempre hacia
// arriba (no al más cercano) para no perder margen en el redondeo.
function redondearAMedio(monto) {
  return Math.ceil(monto / 0.5) * 0.5;
}

module.exports = { calcularPrecioPesable, redondearAMedio };
