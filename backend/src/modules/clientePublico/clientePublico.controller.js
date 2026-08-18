const svc = require('./clientePublico.service');

async function estado(req, res, next) {
  try {
    if (!req.body.numero_documento) return res.status(400).json({ ok: false, mensaje: 'numero_documento es requerido' });
    res.json({ ok: true, datos: await svc.estado(req.body.numero_documento) });
  } catch (err) { next(err); }
}

async function solicitarPin(req, res, next) {
  try { res.json({ ok: true, datos: await svc.solicitarPin(req.body) }); }
  catch (err) { next(err); }
}

async function confirmarPin(req, res, next) {
  try { res.json({ ok: true, datos: await svc.confirmarPin(req.body) }); }
  catch (err) { next(err); }
}

async function verificarPin(req, res, next) {
  try { res.json({ ok: true, datos: await svc.verificarPin(req.body) }); }
  catch (err) { next(err); }
}

module.exports = { estado, solicitarPin, confirmarPin, verificarPin };
