const jwt = require('jsonwebtoken');
const { Cliente } = require('../models');

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

// Confirma que la sesión sigue vigente más allá de la firma del JWT: si el
// PIN del cliente fue reseteado (por soporte, ante un reclamo de cuenta
// "robada" — ver spec) después de emitido el token, pin_hash queda en null
// y cualquier token viejo debe dejar de servir, aunque su firma y expiración
// (180 días) sigan siendo válidas.
async function _tieneSesionVigente(clienteId) {
  const cliente = await Cliente.findByPk(clienteId);
  return !!(cliente && cliente.pin_hash);
}

// Requerida: sin token válido de tipo 'cliente', corta con 401.
async function authCliente(req, res, next) {
  const payload = _payloadDesdeHeader(req);
  if (!payload) return res.status(401).json({ ok: false, mensaje: 'Token requerido' });
  if (!(await _tieneSesionVigente(payload.cliente_id))) {
    return res.status(401).json({ ok: false, mensaje: 'Sesión inválida, volvé a identificarte' });
  }
  req.clienteId = payload.cliente_id;
  next();
}

// Opcional: si hay un token válido de tipo 'cliente', adjunta req.clienteId;
// si no hay token, o es inválido, sigue de largo sin cortar (usada en el
// pedido de autoservicio, que es anónimo por defecto — ver Task 8).
async function authClienteOpcional(req, res, next) {
  const payload = _payloadDesdeHeader(req);
  if (payload && (await _tieneSesionVigente(payload.cliente_id))) {
    req.clienteId = payload.cliente_id;
  }
  next();
}

module.exports = { authCliente, authClienteOpcional };
