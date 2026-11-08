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

  const agentesPorCaja = new Map();
  for (const a of estadoAgentes()) {
    if (a.caja_id != null) agentesPorCaja.set(a.caja_id, a);
  }

  const { desconexiones, servidor_iniciado_en } = desconexionesAgentes();

  return cajas.map((c) => {
    const agente = agentesPorCaja.get(c.id);
    const conectado = !!agente;
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
      // null = caja sin agente, o agente viejo que no manda estos campos.
      version: agente?.version ?? null,
      version_pendiente: agente?.version_pendiente ?? null,
      autoactualizacion: agente?.autoactualizacion ?? null,
    };
  });
}

module.exports = { obtenerEstadoAgentes };
