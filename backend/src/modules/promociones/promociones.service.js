const { Promocion, Producto, Sucursal } = require('../../models');
const { estaActivoHoy } = require('../../utils/disponibilidad');
const { filtroSucursalCatalogo, sucursalParaCrear, verificarSucursal } = require('../../utils/alcanceCatalogo');

const INCLUDE_PRODUCTOS = [
  { model: Producto, as: 'productos', attributes: ['id', 'nombre', 'precio'], through: { attributes: [] } },
  { model: Sucursal, as: 'sucursal', attributes: ['id', 'nombre'] },
];

async function listar(alcance, sucursal_id) {
  return Promocion.findAll({ where: filtroSucursalCatalogo(alcance, sucursal_id), include: INCLUDE_PRODUCTOS, order: [['creado_en', 'DESC']] });
}

// Promociones vigentes ahora mismo — usadas por el POS para descontar el
// precio. Devuelve una fila POR PRODUCTO (no por promoción): si una promo
// afecta a 3 productos, salen 3 filas, cada una con su propio producto_id —
// así el frontend arma su mapa producto_id → promo exactamente igual que
// antes (cuando cada promo era de un solo producto), sin tener que cambiar
// esa parte.
async function listarActivas(alcance) {
  // Orden ascendente por id: el frontend arma un mapa producto_id → promo
  // pisando con la última que procesa, así que acá se devuelve en el mismo
  // orden que espera (la más reciente queda última = la que gana).
  const promos = await Promocion.findAll({
    where: { activo: 1, ...filtroSucursalCatalogo(alcance) }, include: INCLUDE_PRODUCTOS, order: [['id', 'ASC']],
  });
  const vigentes = promos.filter((p) => estaActivoHoy(p));
  const filas = [];
  for (const promo of vigentes) {
    for (const producto of promo.productos) {
      filas.push({
        id: promo.id, producto_id: producto.id, nombre: promo.nombre, tipo: promo.tipo, valor: promo.valor,
        fecha_inicio: promo.fecha_inicio, fecha_fin: promo.fecha_fin, dias_semana: promo.dias_semana,
      });
    }
  }
  return filas;
}

// Sin alcance (llamadas internas que ya verificaron la sucursal) no se valida.
async function obtener(id, alcance) {
  const promo = await Promocion.findByPk(id, { include: INCLUDE_PRODUCTOS });
  if (!promo) throw Object.assign(new Error('Promoción no encontrada'), { status: 404 });
  if (alcance) verificarSucursal(promo, alcance, 'Promoción no encontrada');
  return promo;
}

function _validarTipoValor(tipo, valor) {
  if (tipo && !['porcentaje', 'monto'].includes(tipo)) {
    throw Object.assign(new Error("tipo debe ser 'porcentaje' o 'monto'"), { status: 400 });
  }
  if (!(parseFloat(valor) > 0)) throw Object.assign(new Error('El valor debe ser mayor a 0'), { status: 400 });
  if (tipo === 'porcentaje' && parseFloat(valor) > 100) {
    throw Object.assign(new Error('El porcentaje no puede ser mayor a 100'), { status: 400 });
  }
}

function _validarProductoIds(producto_ids) {
  if (!producto_ids || producto_ids.length === 0) {
    throw Object.assign(new Error('Debe seleccionar al menos un producto'), { status: 400 });
  }
}

// Todos los productos deben existir y ser de la sucursal de la promoción.
async function _validarProductos(producto_ids, sucursal_id) {
  const productos = await Producto.findAll({ where: { id: producto_ids } });
  if (productos.length !== producto_ids.length) {
    throw Object.assign(new Error('Uno o más productos seleccionados no existen'), { status: 404 });
  }
  if (productos.some((p) => p.sucursal_id !== sucursal_id)) {
    throw Object.assign(new Error('Todos los productos deben pertenecer a la misma sucursal'), { status: 400 });
  }
}

async function crear({ producto_ids, nombre, tipo = 'porcentaje', valor, fecha_inicio, fecha_fin, dias_semana, activo = 1, sucursal_id }, alcance) {
  _validarProductoIds(producto_ids);
  _validarTipoValor(tipo, valor);
  const sucursalDestino = await sucursalParaCrear(alcance, sucursal_id);
  await _validarProductos(producto_ids, sucursalDestino);

  const promo = await Promocion.create({
    sucursal_id: sucursalDestino, nombre, tipo, valor, activo,
    fecha_inicio: fecha_inicio || null, fecha_fin: fecha_fin || null, dias_semana: dias_semana || null,
  });
  await promo.setProductos(producto_ids);
  return obtener(promo.id);
}

// sucursal_id no se destructura: una promoción no cambia de sucursal.
async function actualizar(id, { producto_ids, nombre, tipo, valor, fecha_inicio, fecha_fin, dias_semana, activo }, alcance) {
  const promo = await Promocion.findByPk(id);
  if (!promo) throw Object.assign(new Error('Promoción no encontrada'), { status: 404 });
  verificarSucursal(promo, alcance, 'Promoción no encontrada');
  if (producto_ids !== undefined) _validarProductoIds(producto_ids);
  if (tipo !== undefined || valor !== undefined) _validarTipoValor(tipo ?? promo.tipo, valor ?? promo.valor);
  if (producto_ids !== undefined) await _validarProductos(producto_ids, promo.sucursal_id);

  const datos = {};
  if (nombre !== undefined) datos.nombre = nombre;
  if (tipo !== undefined) datos.tipo = tipo;
  if (valor !== undefined) datos.valor = valor;
  if (activo !== undefined) datos.activo = activo;
  if (fecha_inicio !== undefined) datos.fecha_inicio = fecha_inicio || null;
  if (fecha_fin !== undefined) datos.fecha_fin = fecha_fin || null;
  if (dias_semana !== undefined) datos.dias_semana = dias_semana || null;

  await promo.update(datos);
  if (producto_ids !== undefined) await promo.setProductos(producto_ids);
  return obtener(id);
}

async function eliminar(id, alcance) {
  const promo = await Promocion.findByPk(id);
  if (!promo) throw Object.assign(new Error('Promoción no encontrada'), { status: 404 });
  verificarSucursal(promo, alcance, 'Promoción no encontrada');
  await promo.destroy();
}

module.exports = { listar, listarActivas, obtener, crear, actualizar, eliminar };
