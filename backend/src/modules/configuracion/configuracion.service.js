const { Configuracion } = require('../../models');

async function obtenerTodo() {
  const configs = await Configuracion.findAll({ order: [['clave', 'ASC']] });
  return configs.reduce((obj, c) => {
    obj[c.clave] = c.valor;
    return obj;
  }, {});
}

async function obtenerPublica() {
  const claves = ['nombre_negocio', 'logo', 'color_primario', 'color_secundario', 'fidelidad_activa', 'fidelidad_canje_qr'];
  const configs = await Configuracion.findAll({ where: { clave: claves } });
  return configs.reduce((obj, c) => {
    obj[c.clave] = c.valor;
    return obj;
  }, {});
}

async function actualizar(pares) {
  const claves = Object.keys(pares);
  for (const clave of claves) {
    await Configuracion.upsert({ clave, valor: pares[clave] });
  }
  return obtenerTodo();
}

module.exports = { obtenerTodo, obtenerPublica, actualizar };
