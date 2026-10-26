const { Sucursal } = require('../../src/models');

// Id de la sucursal del seed, para tests que crean categorías o grupos de
// opciones directo por el modelo (sucursal_id es NOT NULL).
async function idSucursalPrincipal() {
  const sucursal = await Sucursal.findOne({ where: { nombre: 'Sucursal Principal' } });
  return sucursal.id;
}

module.exports = { idSucursalPrincipal };
