function calcularPrecioPesable(pesoKg, precioKg) {
  return Math.round(pesoKg * precioKg);
}

module.exports = { calcularPrecioPesable };
