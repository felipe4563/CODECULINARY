const { Promocion, Producto } = require('../../models');
const { estaActivoHoy } = require('../../utils/disponibilidad');

const INCLUDE_PRODUCTO = [{ model: Producto, as: 'producto', attributes: ['id', 'nombre', 'precio'] }];

async function listar() {
  return Promocion.findAll({ include: INCLUDE_PRODUCTO, order: [['creado_en', 'DESC']] });
}

// Promociones vigentes ahora mismo — usadas por el POS para descontar el precio.
async function listarActivas() {
  const promos = await Promocion.findAll({ where: { activo: 1 } });
  return promos.filter((p) => estaActivoHoy(p));
}

async function obtener(id) {
  const promo = await Promocion.findByPk(id, { include: INCLUDE_PRODUCTO });
  if (!promo) throw Object.assign(new Error('Promoción no encontrada'), { status: 404 });
  return promo;
}

function _validar({ producto_id, tipo, valor }) {
  if (!producto_id) throw Object.assign(new Error('producto_id es requerido'), { status: 400 });
  if (tipo && !['porcentaje', 'monto'].includes(tipo)) {
    throw Object.assign(new Error("tipo debe ser 'porcentaje' o 'monto'"), { status: 400 });
  }
  if (!(parseFloat(valor) > 0)) throw Object.assign(new Error('El valor debe ser mayor a 0'), { status: 400 });
  if (tipo === 'porcentaje' && parseFloat(valor) > 100) {
    throw Object.assign(new Error('El porcentaje no puede ser mayor a 100'), { status: 400 });
  }
}

async function crear({ producto_id, nombre, tipo = 'porcentaje', valor, fecha_inicio, fecha_fin, dias_semana, activo = 1 }) {
  _validar({ producto_id, tipo, valor });
  const producto = await Producto.findByPk(producto_id);
  if (!producto) throw Object.assign(new Error('Producto no encontrado'), { status: 404 });

  const promo = await Promocion.create({
    producto_id, nombre, tipo, valor, activo,
    fecha_inicio: fecha_inicio || null, fecha_fin: fecha_fin || null, dias_semana: dias_semana || null,
  });
  return obtener(promo.id);
}

async function actualizar(id, { producto_id, nombre, tipo, valor, fecha_inicio, fecha_fin, dias_semana, activo }) {
  const promo = await Promocion.findByPk(id);
  if (!promo) throw Object.assign(new Error('Promoción no encontrada'), { status: 404 });
  if (producto_id !== undefined || tipo !== undefined || valor !== undefined) {
    _validar({
      producto_id: producto_id ?? promo.producto_id,
      tipo: tipo ?? promo.tipo,
      valor: valor ?? promo.valor,
    });
  }

  const datos = {};
  if (producto_id !== undefined) datos.producto_id = producto_id;
  if (nombre !== undefined) datos.nombre = nombre;
  if (tipo !== undefined) datos.tipo = tipo;
  if (valor !== undefined) datos.valor = valor;
  if (activo !== undefined) datos.activo = activo;
  if (fecha_inicio !== undefined) datos.fecha_inicio = fecha_inicio || null;
  if (fecha_fin !== undefined) datos.fecha_fin = fecha_fin || null;
  if (dias_semana !== undefined) datos.dias_semana = dias_semana || null;

  await promo.update(datos);
  return obtener(id);
}

async function eliminar(id) {
  const promo = await Promocion.findByPk(id);
  if (!promo) throw Object.assign(new Error('Promoción no encontrada'), { status: 404 });
  await promo.destroy();
}

module.exports = { listar, listarActivas, obtener, crear, actualizar, eliminar };
