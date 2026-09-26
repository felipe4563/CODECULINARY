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

async function filtros(req, res, next) {
  try { res.json({ ok: true, datos: await svc.filtros() }); }
  catch (err) { next(err); }
}

async function obtenerHorario(req, res, next) {
  try { res.json({ ok: true, datos: await svc.obtenerHorario(req.params.usuario_id) }); }
  catch (err) { next(err); }
}

async function guardarHorario(req, res, next) {
  try { res.json({ ok: true, datos: await svc.guardarHorario(req.params.usuario_id, req.body.dias) }); }
  catch (err) { next(err); }
}

async function listarMarcaciones(req, res, next) {
  try { res.json({ ok: true, datos: await svc.listarMarcaciones(req.query) }); }
  catch (err) { next(err); }
}

async function resolverCierreAutomatico(req, res, next) {
  try { res.json({ ok: true, datos: await svc.resolverCierreAutomatico(req.params.id, req.usuario.id, req.body) }); }
  catch (err) { next(err); }
}

module.exports = { marcar, miEstado, proponerSalida, filtros, obtenerHorario, guardarHorario, listarMarcaciones, resolverCierreAutomatico };
