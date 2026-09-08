const { IntegracionApiKey } = require('../models');
const { _hashear } = require('../modules/integraciones/integracionesAdmin.service');

async function authApiKeyExterna(req, res, next) {
  const apiKey = req.header('X-Api-Key');
  if (!apiKey) {
    return res.status(401).json({ ok: false, mensaje: 'Falta el header X-Api-Key' });
  }

  const key = await IntegracionApiKey.findOne({
    where: { api_key_hash: _hashear(apiKey), activo: true },
  });
  if (!key) {
    return res.status(401).json({ ok: false, mensaje: 'API key inválida o inactiva' });
  }

  req.sucursal_id = key.sucursal_id;
  req.integracionApiKeyId = key.id;
  req.integracionNombreApp = key.nombre_app;
  next();
}

module.exports = { authApiKeyExterna };
