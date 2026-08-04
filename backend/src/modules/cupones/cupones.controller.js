const svc = require('./cupones.service');

async function listar(req, res, next) {
  try { res.json({ ok: true, datos: await svc.listar() }); }
  catch (err) { next(err); }
}

async function obtener(req, res, next) {
  try { res.json({ ok: true, datos: await svc.obtener(req.params.id) }); }
  catch (err) { next(err); }
}

async function crear(req, res, next) {
  try { res.status(201).json({ ok: true, datos: await svc.crear(req.body, req.usuario.id) }); }
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

async function validar(req, res, next) {
  try {
    const subtotal = parseFloat(req.query.subtotal || 0);
    res.json({ ok: true, datos: await svc.validar(req.params.codigo, subtotal, req.query.cliente_id || null) });
  } catch (err) { next(err); }
}

module.exports = { listar, obtener, crear, actualizar, eliminar, validar };
