const { Producto } = require('../models');

// Corre todas las noches (ver server.js) y deja todo listo para el día
// siguiente: el personal solo tiene que APAGAR las excepciones de hoy, nunca
// gestionar la lista completa desde cero.
async function resetDisponibilidadDiaria() {
  const [afectados] = await Producto.update(
    { disponible_hoy: true },
    { where: { disponible_hoy: false } }
  );
  return { afectados };
}

module.exports = { resetDisponibilidadDiaria };
