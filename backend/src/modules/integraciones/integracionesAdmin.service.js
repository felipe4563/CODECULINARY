const crypto = require('crypto');
const { IntegracionApiKey, Sucursal } = require('../../models');

// Las API keys se guardan como SHA-256 en hex (no bcrypt): son secretos de
// alta entropía generados por el sistema, no contraseñas elegidas por un
// humano — no hace falta un hash lento ni salt por fila, y SHA-256 permite
// buscar la key directamente por igualdad en la consulta (WHERE
// api_key_hash = ?) en vez de traer todas las filas activas y comparar una
// por una como haría falta con bcrypt.
function _hashear(apiKeyPlano) {
  return crypto.createHash('sha256').update(apiKeyPlano).digest('hex');
}

function _generarApiKeyPlano() {
  return 'ik_' + crypto.randomBytes(24).toString('hex');
}

function _verificarAlcance(key, alcance) {
  if (alcance && !alcance.acceso_todas && key.sucursal_id !== alcance.sucursal_id) {
    throw Object.assign(new Error('Key no encontrada'), { status: 404 });
  }
}

async function listar(alcance) {
  const where = {};
  if (alcance && !alcance.acceso_todas) where.sucursal_id = alcance.sucursal_id;
  const keys = await IntegracionApiKey.findAll({
    where,
    include: [{ model: Sucursal, as: 'sucursal', attributes: ['id', 'nombre'] }],
    order: [['creado_en', 'DESC']],
  });
  return keys.map((k) => ({
    id: k.id, sucursal: k.sucursal, nombre_app: k.nombre_app, activo: k.activo, creado_en: k.creado_en,
  }));
}

async function crear({ sucursal_id, nombre_app }, alcance) {
  if (alcance && !alcance.acceso_todas && sucursal_id !== alcance.sucursal_id) {
    throw Object.assign(new Error('No tenés acceso a esa sucursal'), { status: 403 });
  }

  const sucursal = await Sucursal.findByPk(sucursal_id);
  if (!sucursal) throw Object.assign(new Error('Sucursal no encontrada'), { status: 404 });

  const apiKeyPlano = _generarApiKeyPlano();
  const key = await IntegracionApiKey.create({
    sucursal_id, nombre_app, api_key_hash: _hashear(apiKeyPlano),
  });
  // El valor en texto plano solo existe en esta respuesta — no se puede
  // volver a consultar después, ni siquiera desde acá (solo queda el hash).
  return { id: key.id, sucursal_id, nombre_app, api_key: apiKeyPlano };
}

async function desactivar(id, alcance) {
  const key = await IntegracionApiKey.findByPk(id);
  if (!key) throw Object.assign(new Error('Key no encontrada'), { status: 404 });
  _verificarAlcance(key, alcance);
  await key.update({ activo: false });
  return { id: key.id, activo: false };
}

async function regenerar(id, alcance) {
  const key = await IntegracionApiKey.findByPk(id);
  if (!key) throw Object.assign(new Error('Key no encontrada'), { status: 404 });
  _verificarAlcance(key, alcance);
  const apiKeyPlano = _generarApiKeyPlano();
  await key.update({ api_key_hash: _hashear(apiKeyPlano), activo: true });
  return { id: key.id, sucursal_id: key.sucursal_id, nombre_app: key.nombre_app, api_key: apiKeyPlano };
}

module.exports = { listar, crear, desactivar, regenerar, _hashear };
