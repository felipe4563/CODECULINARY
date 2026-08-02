const svc = require('./combos.service');

async function listar(req, res, next) {
  try { res.json({ ok: true, datos: await svc.listar() }); }
  catch (err) { next(err); }
}

async function listarActivos(req, res, next) {
  try { res.json({ ok: true, datos: await svc.listarActivos() }); }
  catch (err) { next(err); }
}

async function obtener(req, res, next) {
  try { res.json({ ok: true, datos: await svc.obtener(req.params.id) }); }
  catch (err) { next(err); }
}

async function crear(req, res, next) {
  try { res.status(201).json({ ok: true, datos: await svc.crear(req.body) }); }
  catch (err) { next(err); }
}

async function actualizar(req, res, next) {
  try { res.json({ ok: true, datos: await svc.actualizar(req.params.id, req.body) }); }
  catch (err) { next(err); }
}

async function eliminar(req, res, next) {
  try { res.json({ ok: true, datos: await svc.eliminar(req.params.id) }); }
  catch (err) { next(err); }
}

module.exports = { listar, listarActivos, obtener, crear, actualizar, eliminar };
