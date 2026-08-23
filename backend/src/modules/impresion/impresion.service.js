const { Caja, Sucursal } = require('../../models');
const { estadoAgentes } = require('../../socket');

async function obtenerEstadoAgentes(alcance) {
  const where = { modo_impresion: 'fisica', activo: 1 };
  if (!alcance.acceso_todas) where.sucursal_id = alcance.sucursal_id;

  const cajas = await Caja.findAll({
    where,
    attributes: ['id', 'nombre', 'sucursal_id'],
    include: [{ model: Sucursal, as: 'sucursal', attributes: ['id', 'nombre'] }],
    order: [['sucursal_id', 'ASC'], ['nombre', 'ASC']],
  });

  const conectados = new Set(
    estadoAgentes().map((a) => a.caja_id).filter((id) => id != null)
  );

  return cajas.map((c) => ({
    caja_id: c.id,
    caja_nombre: c.nombre,
    sucursal_id: c.sucursal_id,
    sucursal_nombre: c.sucursal ? c.sucursal.nombre : null,
    conectado: conectados.has(c.id),
  }));
}

module.exports = { obtenerEstadoAgentes };
