const { revertirPagosQrVencidos } = require('../modules/ventas/ventas.service');

async function expirarPagosQrVencidos() {
  return revertirPagosQrVencidos();
}

module.exports = { expirarPagosQrVencidos };
