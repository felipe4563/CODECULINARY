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

async function listar() {
  const keys = await IntegracionApiKey.findAll({
    include: [{ model: Sucursal, as: 'sucursal', attributes: ['id', 'nombre'] }],
    order: [['creado_en', 'DESC']],
  });
  return keys.map((k) => ({
    id: k.id, sucursal: k.sucursal, nombre_app: k.nombre_app, activo: k.activo, creado_en: k.creado_en,
  }));
}

async function crear({ sucursal_id, nombre_app }) {
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

async function desactivar(id) {
  const key = await IntegracionApiKey.findByPk(id);
  if (!key) throw Object.assign(new Error('Key no encontrada'), { status: 404 });
  await key.update({ activo: false });
  return { id: key.id, activo: false };
}

async function regenerar(id) {
  const key = await IntegracionApiKey.findByPk(id);
  if (!key) throw Object.assign(new Error('Key no encontrada'), { status: 404 });
  const apiKeyPlano = _generarApiKeyPlano();
  await key.update({ api_key_hash: _hashear(apiKeyPlano), activo: true });
  return { id: key.id, sucursal_id: key.sucursal_id, nombre_app: key.nombre_app, api_key: apiKeyPlano };
}

module.exports = { listar, crear, desactivar, regenerar, _hashear };
