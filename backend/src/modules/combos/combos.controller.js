const svc = require('./combos.service');

function _alcance(req) {
  return { sucursal_id: req.usuario.sucursal_id, acceso_todas: req.usuario.acceso_todas, usuario_id: req.usuario.id };
}

async function listar(req, res, next) {
  try { res.json({ ok: true, datos: await svc.listar(_alcance(req), req.query.sucursal_id) }); }
  catch (err) { next(err); }
}

async function listarActivos(req, res, next) {
  try { res.json({ ok: true, datos: await svc.listarActivos(_alcance(req), req.query.sucursal_id) }); }
  catch (err) { next(err); }
}

async function obtener(req, res, next) {
  try { res.json({ ok: true, datos: await svc.obtener(req.params.id, undefined, _alcance(req)) }); }
  catch (err) { next(err); }
}

async function crear(req, res, next) {
  try { res.status(201).json({ ok: true, datos: await svc.crear(req.body, _alcance(req)) }); }
  catch (err) { next(err); }
}

async function actualizar(req, res, next) {
  try { res.json({ ok: true, datos: await svc.actualizar(req.params.id, req.body, _alcance(req)) }); }
  catch (err) { next(err); }
}

async function eliminar(req, res, next) {
  try { res.json({ ok: true, datos: await svc.eliminar(req.params.id, _alcance(req)) }); }
  catch (err) { next(err); }
}

module.exports = { listar, listarActivos, obtener, crear, actualizar, eliminar };
