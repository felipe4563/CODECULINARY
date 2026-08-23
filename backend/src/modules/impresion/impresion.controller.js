const svc = require('./impresion.service');

function _alcance(req) {
  return { sucursal_id: req.usuario.sucursal_id, acceso_todas: req.usuario.acceso_todas };
}

async function estadoAgentes(req, res, next) {
  try { res.json({ ok: true, datos: await svc.obtenerEstadoAgentes(_alcance(req)) }); }
  catch (err) { next(err); }
}

module.exports = { estadoAgentes };
