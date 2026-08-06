const svc = require('./ruleta.service');

async function listarPremios(req, res, next) {
  try { res.json({ ok: true, datos: await svc.listarPremios() }); }
  catch (err) { next(err); }
}

async function listarPremiosActivos(req, res, next) {
  try { res.json({ ok: true, datos: await svc.listarPremiosActivos() }); }
  catch (err) { next(err); }
}

async function crearPremio(req, res, next) {
  try { res.status(201).json({ ok: true, datos: await svc.crearPremio(req.body) }); }
  catch (err) { next(err); }
}

async function actualizarPremio(req, res, next) {
  try { res.json({ ok: true, datos: await svc.actualizarPremio(req.params.id, req.body) }); }
  catch (err) { next(err); }
}

async function eliminarPremio(req, res, next) {
  try { res.json({ ok: true, datos: await svc.eliminarPremio(req.params.id) }); }
  catch (err) { next(err); }
}

async function estado(req, res, next) {
  try { res.json({ ok: true, datos: await svc.estadoParaCliente(req.query.cliente_id) }); }
  catch (err) { next(err); }
}

async function girar(req, res, next) {
  try { res.json({ ok: true, datos: await svc.girar(req.body.cliente_id, req.usuario.id) }); }
  catch (err) { next(err); }
}

module.exports = { listarPremios, listarPremiosActivos, crearPremio, actualizarPremio, eliminarPremio, estado, girar };
