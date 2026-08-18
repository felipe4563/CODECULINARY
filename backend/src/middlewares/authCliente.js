const jwt = require('jsonwebtoken');

function _payloadDesdeHeader(req) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) return null;
  try {
    const payload = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
    return payload.tipo === 'cliente' ? payload : null;
  } catch {
    return null;
  }
}

// Requerida: sin token válido de tipo 'cliente', corta con 401.
function authCliente(req, res, next) {
  const payload = _payloadDesdeHeader(req);
  if (!payload) return res.status(401).json({ ok: false, mensaje: 'Token requerido' });
  req.clienteId = payload.cliente_id;
  next();
}

// Opcional: si hay un token válido de tipo 'cliente', adjunta req.clienteId;
// si no hay token, o es inválido, sigue de largo sin cortar (usada en el
// pedido de autoservicio, que es anónimo por defecto — ver Task 8).
function authClienteOpcional(req, res, next) {
  const payload = _payloadDesdeHeader(req);
  if (payload) req.clienteId = payload.cliente_id;
  next();
}

module.exports = { authCliente, authClienteOpcional };
