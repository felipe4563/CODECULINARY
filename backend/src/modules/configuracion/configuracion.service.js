const { Configuracion } = require('../../models');

async function obtenerTodo() {
  const configs = await Configuracion.findAll({ order: [['clave', 'ASC']] });
  return configs.reduce((obj, c) => {
    obj[c.clave] = c.valor;
    return obj;
  }, {});
}

async function obtenerPublica() {
  const claves = ['nombre_negocio', 'logo', 'portada', 'moneda', 'simbolo_moneda', 'color_primario', 'color_secundario', 'fidelidad_activa', 'fidelidad_canje_qr',
    // El POS las necesita aunque el cajero no tenga permiso de ver configuración.
    'qr_pos_modo', 'qr_pago_imagen', 'qr_pago_texto'];
  const configs = await Configuracion.findAll({ where: { clave: claves } });
  return configs.reduce((obj, c) => {
    obj[c.clave] = c.valor;
    return obj;
  }, {});
}

async function actualizar(pares) {
  if (pares.qr_pos_modo !== undefined && !['codepay', 'manual'].includes(pares.qr_pos_modo)) {
    throw Object.assign(new Error("qr_pos_modo debe ser 'codepay' o 'manual'"), { status: 400 });
  }
  // Sin imagen del QR, el modo manual dejaría al cajero sin nada que mostrar.
  const modoFinal = pares.qr_pos_modo ?? (await Configuracion.findOne({ where: { clave: 'qr_pos_modo' } }))?.valor;
  if (modoFinal === 'manual') {
    const imagenFinal = pares.qr_pago_imagen ?? (await Configuracion.findOne({ where: { clave: 'qr_pago_imagen' } }))?.valor;
    if (!imagenFinal) {
      throw Object.assign(new Error('Subí la imagen del QR del negocio antes de usar el modo QR propio'), { status: 400 });
    }
  }

  const claves = Object.keys(pares);
  for (const clave of claves) {
    await Configuracion.upsert({ clave, valor: pares[clave] });
  }
  return obtenerTodo();
}

module.exports = { obtenerTodo, obtenerPublica, actualizar };
