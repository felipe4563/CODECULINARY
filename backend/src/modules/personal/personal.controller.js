const svc = require('./personal.service');

async function marcar(req, res, next) {
  try {
    const { lat, lng } = req.body;
    const datos = await svc.marcar({ usuario_id: req.usuario.id, sucursal_id: req.usuario.sucursal_id, lat, lng });
    res.json({ ok: true, datos });
  } catch (err) { next(err); }
}

async function miEstado(req, res, next) {
  try { res.json({ ok: true, datos: await svc.miEstado(req.usuario.id) }); }
  catch (err) { next(err); }
}

async function proponerSalida(req, res, next) {
  try { res.json({ ok: true, datos: await svc.proponerSalida(req.usuario.id, req.params.id, req.body) }); }
  catch (err) { next(err); }
}

module.exports = { marcar, miEstado, proponerSalida };
