const { Combo, ComboProducto, Producto, DetallePedido, GrupoOpciones, Opcion, Sucursal, sequelize } = require('../../models');
const { filtroSucursalCatalogo, sucursalParaCrear, verificarSucursal } = require('../../utils/alcanceCatalogo');
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

const INCLUDE_SUCURSAL = { model: Sucursal, as: 'sucursal', attributes: ['id', 'nombre'] };

// Reusa la misma normalización que productos.service.js aplica a un producto
// suelto (aplana ProductoGrupoOpciones.orden/obligatorio, ordena opciones) —
// sin esto, SelectorOpcionModal no puede leer `grupo.obligatorio` porque
// vendría anidado bajo `ProductoGrupoOpciones` en vez de plano.
function _normalizarCombo(combo) {
  (combo.productos || []).forEach(_normalizarGruposOpciones);
  return combo;
}

async function listar(alcance, sucursal_id) {
  const combos = await Combo.findAll({ where: filtroSucursalCatalogo(alcance, sucursal_id), include: [...INCLUDE_PRODUCTOS, INCLUDE_SUCURSAL], order: [['nombre', 'ASC']] });
  // Llamar toJSON() antes de _normalizarCombo es necesario por cómo funciona
  // Model.prototype.set() en instancias de Sequelize: asignar una propiedad
  // cuya clave coincide con el alias de una asociación (como `grupos_opciones`)
  // pasa por _setInclude() -> bulkBuild(), que reconstruye el array asignado
  // usando solo los atributos reales de columna de ese modelo y descarta en
  // silencio cualquier campo aplanado extra (como el `orden`/`obligatorio` que
  // _normalizarGruposOpciones inyecta). Esto ocurre en el momento de la
  // ASIGNACIÓN, no en un paso posterior de serialización. Convertir a objeto
  // plano con toJSON() primero evita esto porque ya no hay un setter de
  // asociación que intercepte la escritura.
  return combos.map((c) => _normalizarCombo(c.toJSON()));
}

// Combos vendibles ahora mismo (activos y dentro de su ventana de fechas/días) — para el POS.
async function listarActivos(alcance) {
  const combos = await Combo.findAll({ where: { activo: 1, ...filtroSucursalCatalogo(alcance) }, include: [...INCLUDE_PRODUCTOS, INCLUDE_SUCURSAL], order: [['nombre', 'ASC']] });
  return combos.filter((c) => estaActivoHoy(c)).map((c) => _normalizarCombo(c.toJSON()));
}

// Sin alcance (llamadas internas que ya verificaron la sucursal) no se valida.
async function obtener(id, transaction, alcance) {
  const combo = await Combo.findByPk(id, { include: [...INCLUDE_PRODUCTOS, INCLUDE_SUCURSAL], transaction });
  if (!combo) throw Object.assign(new Error('Combo no encontrado'), { status: 404 });
  if (alcance) verificarSucursal(combo, alcance, 'Combo no encontrado');
  return _normalizarCombo(combo.toJSON());
}

async function _sincronizarProductos(combo_id, productos, transaction, sucursal_id) {
  if (!productos) return;
  if (productos.length === 0) {
    throw Object.assign(new Error('El combo debe incluir al menos un producto'), { status: 400 });
  }
  const ids = [...new Set(productos.map((p) => p.producto_id ?? p.id))];
  const deLaSucursal = await Producto.count({ where: { id: ids, sucursal_id }, transaction });
  if (deLaSucursal !== ids.length) {
    throw Object.assign(new Error('Todos los productos deben pertenecer a la misma sucursal'), { status: 400 });
  }
  await ComboProducto.destroy({ where: { combo_id }, transaction });
  await ComboProducto.bulkCreate(
    productos.map((p) => ({ combo_id, producto_id: p.producto_id ?? p.id, cantidad: p.cantidad ?? 1 })),
    { transaction }
  );
}

async function crear({ nombre, descripcion, precio, imagen, activo = 1, fecha_inicio, fecha_fin, dias_semana, productos = [], sucursal_id }, alcance) {
  if (!nombre || !nombre.trim()) throw Object.assign(new Error('El nombre es requerido'), { status: 400 });
  if (!(parseFloat(precio) > 0)) throw Object.assign(new Error('El precio debe ser mayor a 0'), { status: 400 });
  if (!productos.length) throw Object.assign(new Error('El combo debe incluir al menos un producto'), { status: 400 });

  const sucursalDestino = await sucursalParaCrear(alcance, sucursal_id);

  return sequelize.transaction(async (t) => {
    const combo = await Combo.create({
      sucursal_id: sucursalDestino, nombre: nombre.trim(), descripcion, precio, imagen, activo, fecha_inicio: fecha_inicio || null, fecha_fin: fecha_fin || null, dias_semana: dias_semana || null,
    }, { transaction: t });
    await _sincronizarProductos(combo.id, productos, t, sucursalDestino);
    return obtener(combo.id, t);
  });
}

// sucursal_id no se destructura: un combo no cambia de sucursal.
async function actualizar(id, { nombre, descripcion, precio, imagen, activo, fecha_inicio, fecha_fin, dias_semana, productos }, alcance) {
  const combo = await Combo.findByPk(id);
  if (!combo) throw Object.assign(new Error('Combo no encontrado'), { status: 404 });
  verificarSucursal(combo, alcance, 'Combo no encontrado');

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
    await _sincronizarProductos(id, productos, t, combo.sucursal_id);
    return obtener(id, t);
  });
}

async function eliminar(id, alcance) {
  const combo = await Combo.findByPk(id);
  if (!combo) throw Object.assign(new Error('Combo no encontrado'), { status: 404 });
  verificarSucursal(combo, alcance, 'Combo no encontrado');
  const tieneVentas = await DetallePedido.count({ where: { combo_id: id } });
  if (tieneVentas > 0) {
    await combo.update({ activo: 0 });
    return { eliminado: false };
  }
  await combo.destroy();
  return { eliminado: true };
}

module.exports = { listar, listarActivos, obtener, crear, actualizar, eliminar };
