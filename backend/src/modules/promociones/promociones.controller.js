const svc = require('./promociones.service');

async function listar(req, res, next) {
  try { res.json({ ok: true, datos: await svc.listar() }); }
  catch (err) { next(err); }
}

async function listarActivas(req, res, next) {
  try { res.json({ ok: true, datos: await svc.listarActivas() }); }
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
  try { await svc.eliminar(req.params.id); res.json({ ok: true, datos: null }); }
  catch (err) { next(err); }
}

module.exports = { listar, listarActivas, obtener, crear, actualizar, eliminar };
