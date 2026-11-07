const { Caja, Sucursal } = require('../../models');
const { estadoAgentes, desconexionesAgentes } = require('../../socket');

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

  const { desconexiones, servidor_iniciado_en } = desconexionesAgentes();

  return cajas.map((c) => {
    const conectado = conectados.has(c.id);
    // Sin registro de caída desde que arrancó el servidor: se informa el
    // arranque como cota mínima (desde_inicio_servidor → "hace más de X").
    const registrada = desconexiones.get(c.id);
    const desde = conectado ? null : (registrada ?? servidor_iniciado_en);
    return {
      caja_id: c.id,
      caja_nombre: c.nombre,
      sucursal_id: c.sucursal_id,
      sucursal_nombre: c.sucursal ? c.sucursal.nombre : null,
      conectado,
      desconectado_desde: desde == null ? null : new Date(desde).toISOString(),
      desde_inicio_servidor: !conectado && registrada == null,
    };
  });
}

module.exports = { obtenerEstadoAgentes };
