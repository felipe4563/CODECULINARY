const svc = require('./autoservicio.service');

async function obtenerMenu(req, res, next) {
  try { res.json({ ok: true, datos: await svc.obtenerMenu(req.params.codigo_qr) }); }
  catch (err) { next(err); }
}

async function crearPedido(req, res, next) {
  try {
    const { items } = req.body;
    if (!items || !items.length) return res.status(400).json({ ok: false, mensaje: 'items es requerido' });
    res.status(201).json({ ok: true, datos: await svc.crearPedido(req.params.codigo_qr, { items }) });
  } catch (err) { next(err); }
}

async function estadoPedido(req, res, next) {
  try { res.json({ ok: true, datos: await svc.consultarEstadoPedido(req.params.codigo_qr, req.params.pedido_id) }); }
  catch (err) { next(err); }
}

module.exports = { obtenerMenu, crearPedido, estadoPedido };
