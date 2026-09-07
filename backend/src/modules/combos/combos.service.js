const { Combo, ComboProducto, Producto, DetallePedido, GrupoOpciones, Opcion, sequelize } = require('../../models');
const { estaActivoHoy } = require('../../utils/disponibilidad');
const { _normalizarGruposOpciones } = require('../productos/productos.service');

const INCLUDE_PRODUCTOS = [
  {
    model: Producto, as: 'productos', attributes: ['id', 'nombre', 'precio'], through: { attributes: ['cantidad'] },
    include: [
      { model: GrupoOpciones, as: 'grupos_opciones', attributes: ['id', 'nombre', 'tipo_seleccion'],
        through: { attributes: ['orden', 'obligatorio'] },
        include: [{ model: Opcion, as: 'opciones', attributes: ['id', 'nombre', 'precio_adicional', 'orden'] }] },
    ],
  },
];

// Reusa la misma normalización que productos.service.js aplica a un producto
// suelto (aplana ProductoGrupoOpciones.orden/obligatorio, ordena opciones) —
// sin esto, SelectorOpcionModal no puede leer `grupo.obligatorio` porque
// vendría anidado bajo `ProductoGrupoOpciones` en vez de plano.
function _normalizarCombo(combo) {
  (combo.productos || []).forEach(_normalizarGruposOpciones);
  return combo;
}

async function listar() {
  const combos = await Combo.findAll({ include: INCLUDE_PRODUCTOS, order: [['nombre', 'ASC']] });
  return combos.map((c) => _normalizarCombo(c.toJSON()));
}

// Combos vendibles ahora mismo (activos y dentro de su ventana de fechas/días) — para el POS.
async function listarActivos() {
  const combos = await Combo.findAll({ where: { activo: 1 }, include: INCLUDE_PRODUCTOS, order: [['nombre', 'ASC']] });
  return combos.filter((c) => estaActivoHoy(c)).map((c) => _normalizarCombo(c.toJSON()));
}

async function obtener(id, transaction) {
  const combo = await Combo.findByPk(id, { include: INCLUDE_PRODUCTOS, transaction });
  if (!combo) throw Object.assign(new Error('Combo no encontrado'), { status: 404 });
  return _normalizarCombo(combo.toJSON());
}

async function _sincronizarProductos(combo_id, productos, transaction) {
  if (!productos) return;
  if (productos.length === 0) {
    throw Object.assign(new Error('El combo debe incluir al menos un producto'), { status: 400 });
  }
  await ComboProducto.destroy({ where: { combo_id }, transaction });
  await ComboProducto.bulkCreate(
    productos.map((p) => ({ combo_id, producto_id: p.producto_id ?? p.id, cantidad: p.cantidad ?? 1 })),
    { transaction }
  );
}

async function crear({ nombre, descripcion, precio, imagen, activo = 1, fecha_inicio, fecha_fin, dias_semana, productos = [] }) {
  if (!nombre || !nombre.trim()) throw Object.assign(new Error('El nombre es requerido'), { status: 400 });
  if (!(parseFloat(precio) > 0)) throw Object.assign(new Error('El precio debe ser mayor a 0'), { status: 400 });
  if (!productos.length) throw Object.assign(new Error('El combo debe incluir al menos un producto'), { status: 400 });

  return sequelize.transaction(async (t) => {
    const combo = await Combo.create({
      nombre: nombre.trim(), descripcion, precio, imagen, activo, fecha_inicio: fecha_inicio || null, fecha_fin: fecha_fin || null, dias_semana: dias_semana || null,
    }, { transaction: t });
    await _sincronizarProductos(combo.id, productos, t);
    return obtener(combo.id, t);
  });
}

async function actualizar(id, { nombre, descripcion, precio, imagen, activo, fecha_inicio, fecha_fin, dias_semana, productos }) {
  const combo = await Combo.findByPk(id);
  if (!combo) throw Object.assign(new Error('Combo no encontrado'), { status: 404 });

  return sequelize.transaction(async (t) => {
    const datos = {};
    if (nombre !== undefined) datos.nombre = nombre.trim();
    if (descripcion !== undefined) datos.descripcion = descripcion;
    if (precio !== undefined) datos.precio = precio;
    if (imagen !== undefined) datos.imagen = imagen;
    if (activo !== undefined) datos.activo = activo;
    if (fecha_inicio !== undefined) datos.fecha_inicio = fecha_inicio || null;
    if (fecha_fin !== undefined) datos.fecha_fin = fecha_fin || null;
    if (dias_semana !== undefined) datos.dias_semana = dias_semana || null;
    await combo.update(datos, { transaction: t });
    await _sincronizarProductos(id, productos, t);
    return obtener(id, t);
  });
}

async function eliminar(id) {
  const combo = await Combo.findByPk(id);
  if (!combo) throw Object.assign(new Error('Combo no encontrado'), { status: 404 });
  const tieneVentas = await DetallePedido.count({ where: { combo_id: id } });
  if (tieneVentas > 0) {
    await combo.update({ activo: 0 });
    return { eliminado: false };
  }
  await combo.destroy();
  return { eliminado: true };
}

module.exports = { listar, listarActivos, obtener, crear, actualizar, eliminar };
