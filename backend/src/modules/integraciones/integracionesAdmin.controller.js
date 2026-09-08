const svc = require('./integracionesAdmin.service');

async function listar(req, res, next) {
  try { res.json({ ok: true, datos: await svc.listar() }); }
  catch (err) { next(err); }
}

async function crear(req, res, next) {
  try {
    const { sucursal_id, nombre_app } = req.body;
    if (!sucursal_id || !nombre_app) {
      return res.status(400).json({ ok: false, mensaje: 'sucursal_id y nombre_app son requeridos' });
    }
    res.status(201).json({ ok: true, datos: await svc.crear({ sucursal_id, nombre_app }) });
  } catch (err) { next(err); }
}

async function desactivar(req, res, next) {
  try { res.json({ ok: true, datos: await svc.desactivar(req.params.id) }); }
  catch (err) { next(err); }
}

async function regenerar(req, res, next) {
  try { res.json({ ok: true, datos: await svc.regenerar(req.params.id) }); }
  catch (err) { next(err); }
}

module.exports = { listar, crear, desactivar, regenerar };
