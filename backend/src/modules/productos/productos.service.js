const { Categoria, Producto, Sucursal, GrupoOpciones, Opcion, ProductoGrupoOpciones, DetallePedido } = require('../../models');
const sequelize = require('../../config/database');
const { ajustarStockSucursal, mezclarStockPorSucursal } = require('../inventario/stock.service');

// --- Categorías ---

async function listarCategorias() {
  return Categoria.findAll({ order: [['nombre', 'ASC']] });
}

async function crearCategoria({ nombre, imagen }) {
  return Categoria.create({ nombre, imagen });
}

async function actualizarCategoria(id, { nombre, imagen, activo }) {
  const cat = await Categoria.findByPk(id);
  if (!cat) throw Object.assign(new Error('Categoría no encontrada'), { status: 404 });
  await cat.update({ nombre, imagen, activo });
  return cat;
}

async function eliminarCategoria(id) {
  const cat = await Categoria.findByPk(id);
  if (!cat) throw Object.assign(new Error('Categoría no encontrada'), { status: 404 });
  const productos = await Producto.findAll({ where: { categoria_id: id }, attributes: ['nombre', 'activo'] });
  if (productos.length > 0) {
    // Un producto "eliminado" solo se desactiva (para no perder su historial de
    // ventas), así que puede seguir bloqueando la categoría sin aparecer en el
    // listado normal (que solo muestra activos) — se listan por nombre para que
    // quede claro cuál reasignar, en vez de un mensaje genérico.
    const detalle = productos.map((p) => p.nombre + (p.activo ? '' : ' (inactivo)')).join(', ');
    throw Object.assign(new Error(`La categoría tiene productos asignados: ${detalle}. Reasígnalos a otra categoría antes de eliminarla.`), { status: 409 });
  }
  await cat.destroy();
}

// --- Grupos de opciones ---

async function listarGruposOpciones() {
  return GrupoOpciones.findAll({
    include: [{ model: Opcion, as: 'opciones', attributes: ['id', 'nombre', 'precio_adicional', 'orden'] }],
    order: [['nombre', 'ASC'], [{ model: Opcion, as: 'opciones' }, 'orden', 'ASC']],
  });
}

async function _conOpciones(id, transaction) {
  return GrupoOpciones.findByPk(id, {
    include: [{ model: Opcion, as: 'opciones', attributes: ['id', 'nombre', 'precio_adicional', 'orden'] }],
    order: [[{ model: Opcion, as: 'opciones' }, 'orden', 'ASC']],
    transaction,
  });
}

async function crearGrupoOpciones({ nombre, tipo_seleccion, opciones = [] }) {
  return sequelize.transaction(async (t) => {
    const grupo = await GrupoOpciones.create({ nombre, tipo_seleccion }, { transaction: t });
    if (opciones.length) {
      await Opcion.bulkCreate(
        opciones.map((o, i) => ({ grupo_opciones_id: grupo.id, nombre: o.nombre, precio_adicional: o.precio_adicional || 0, orden: o.orden ?? i })),
        { transaction: t }
      );
    }
    return _conOpciones(grupo.id, t);
  });
}

async function actualizarGrupoOpciones(id, { nombre, tipo_seleccion, opciones = [] }) {
  return sequelize.transaction(async (t) => {
    const grupo = await GrupoOpciones.findByPk(id, { transaction: t });
    if (!grupo) throw Object.assign(new Error('Grupo de opciones no encontrado'), { status: 404 });
    await grupo.update({ nombre, tipo_seleccion }, { transaction: t });
    await Opcion.destroy({ where: { grupo_opciones_id: id }, transaction: t });
    if (opciones.length) {
      await Opcion.bulkCreate(
        opciones.map((o, i) => ({ grupo_opciones_id: id, nombre: o.nombre, precio_adicional: o.precio_adicional || 0, orden: o.orden ?? i })),
        { transaction: t }
      );
    }
    return _conOpciones(id, t);
  });
}

async function eliminarGrupoOpciones(id) {
  const grupo = await GrupoOpciones.findByPk(id);
  if (!grupo) throw Object.assign(new Error('Grupo de opciones no encontrado'), { status: 404 });
  // producto_grupos_opciones tiene ON DELETE CASCADE en grupo_opciones_id: las
  // asignaciones de productos a este grupo se borran solas, no hace falta tocarlas a mano.
  await grupo.destroy();
}

async function _sincronizarGruposOpciones(producto_id, grupos_opciones = [], transaction) {
  const ids = grupos_opciones.map((g) => g.id);
  if (new Set(ids).size !== ids.length) {
    throw Object.assign(new Error('No se puede asignar el mismo grupo de opciones más de una vez'), { status: 400 });
  }
  await ProductoGrupoOpciones.destroy({ where: { producto_id }, transaction });
  if (grupos_opciones.length) {
    await ProductoGrupoOpciones.bulkCreate(
      grupos_opciones.map((g, i) => ({ producto_id, grupo_opciones_id: g.id, orden: g.orden ?? i, obligatorio: !!g.obligatorio })),
      { transaction }
    );
  }
}

function _normalizarGruposOpciones(producto) {
  if (Array.isArray(producto.grupos_opciones)) {
    producto.grupos_opciones = producto.grupos_opciones
      .map((g) => ({
        id: g.id,
        nombre: g.nombre,
        tipo_seleccion: g.tipo_seleccion,
        orden: g.ProductoGrupoOpciones?.orden ?? 0,
        obligatorio: !!g.ProductoGrupoOpciones?.obligatorio,
        opciones: [...(g.opciones ?? [])]
          .sort((a, b) => a.orden - b.orden)
          .map((o) => ({ id: o.id, nombre: o.nombre, precio_adicional: parseFloat(o.precio_adicional || 0), orden: o.orden })),
      }))
      .sort((a, b) => a.orden - b.orden);
  }
  return producto;
}

// --- Productos ---

async function listarProductos({ categoria_id, solo_vendibles, solo_disponibles, order_by, solo_inactivos } = {}, alcance) {
  const where = {};
  where.activo = (solo_inactivos === 'true' || solo_inactivos === true) ? 0 : 1;
  if (categoria_id) where.categoria_id = categoria_id;
  if (solo_vendibles === 'true' || solo_vendibles === true) where.es_vendible = 1;

  const order = order_by === 'mas_vendido'
    ? [
        [sequelize.literal('(SELECT COALESCE(SUM(cantidad), 0) FROM detalle_pedidos WHERE producto_id = `Producto`.`id`)'), 'DESC'],
        ['nombre', 'ASC'],
      ]
    : [['nombre', 'ASC']];

  const productos = await Producto.findAll({
    where,
    attributes: {
      include: [
        // Para decidir en la UI si "Eliminar" va a borrar de verdad o solo
        // desactivar: un producto con ventas registradas nunca se borra.
        [sequelize.literal('EXISTS(SELECT 1 FROM detalle_pedidos WHERE producto_id = `Producto`.`id`)'), 'tiene_ventas'],
      ],
    },
    include: [
      { model: Categoria, as: 'categoria', attributes: ['id', 'nombre'] },
      { model: GrupoOpciones, as: 'grupos_opciones', attributes: ['id', 'nombre', 'tipo_seleccion'],
        through: { attributes: ['orden', 'obligatorio'] },
        include: [{ model: Opcion, as: 'opciones', attributes: ['id', 'nombre', 'precio_adicional', 'orden'] }] },
    ],
    order,
  });

  const conStock = await mezclarStockPorSucursal(productos, alcance);
  conStock.forEach(_normalizarGruposOpciones);

  if (solo_disponibles === 'true' || solo_disponibles === true) {
    return conStock.filter((p) => p.stock === null || p.stock > 0);
  }
  return conStock;
}

async function obtenerProducto(id, alcance) {
  const p = await Producto.findByPk(id, {
    include: [
      { model: Categoria, as: 'categoria', attributes: ['id', 'nombre'] },
      { model: GrupoOpciones, as: 'grupos_opciones', attributes: ['id', 'nombre', 'tipo_seleccion'],
        through: { attributes: ['orden', 'obligatorio'] },
        include: [{ model: Opcion, as: 'opciones', attributes: ['id', 'nombre', 'precio_adicional', 'orden'] }] },
    ],
  });
  if (!p) throw Object.assign(new Error('Producto no encontrado'), { status: 404 });
  const [conStock] = await mezclarStockPorSucursal([p], alcance);
  return _normalizarGruposOpciones(conStock);
}

async function crearProducto({ categoria_id, nombre, precio, stock, sucursal_id, es_vendible, imagen, grupos_opciones, es_pesable }, alcance) {
  let sucursalDestino;
  const conStock = stock !== undefined && stock !== null;

  if (conStock) {
    sucursalDestino = alcance.acceso_todas ? sucursal_id : alcance.sucursal_id;
    if (alcance.acceso_todas && !sucursalDestino) {
      throw Object.assign(new Error('sucursal_id es requerido para asignar stock inicial'), { status: 400 });
    }
    if (alcance.acceso_todas) {
      const existe = await Sucursal.findByPk(sucursalDestino);
      if (!existe) throw Object.assign(new Error('Sucursal no encontrada'), { status: 404 });
    }
  }

  const producto = await sequelize.transaction(async (t) => {
    const p = await Producto.create({ categoria_id, nombre, precio, stock: conStock ? 0 : null, es_vendible, imagen, es_pesable }, { transaction: t });
    await _sincronizarGruposOpciones(p.id, grupos_opciones, t);
    return p;
  });

  if (conStock) {
    await ajustarStockSucursal({ producto_id: producto.id, sucursal_id: sucursalDestino, tipo: 'ajuste', cantidad: stock, usuario_id: alcance.usuario_id, nota: 'Stock inicial' });
  }

  return obtenerProducto(producto.id, alcance);
}

async function actualizarProducto(id, datos, alcance) {
  const { stock, grupos_opciones, ...resto } = datos; // stock nunca se edita aquí — solo vía ajustarStockSucursal
  const p = await Producto.findByPk(id);
  if (!p) throw Object.assign(new Error('Producto no encontrado'), { status: 404 });
  await sequelize.transaction(async (t) => {
    await p.update(resto, { transaction: t });
    if (grupos_opciones !== undefined) {
      await _sincronizarGruposOpciones(id, grupos_opciones, t);
    }
  });
  return obtenerProducto(id, alcance);
}

async function eliminarProducto(id) {
  const p = await Producto.findByPk(id);
  if (!p) throw Object.assign(new Error('Producto no encontrado'), { status: 404 });

  const tieneVentas = await DetallePedido.count({ where: { producto_id: id } });
  if (tieneVentas > 0) {
    await p.update({ activo: 0 });
    return { eliminado: false };
  }
  await p.destroy();
  return { eliminado: true };
}

module.exports = { listarCategorias, crearCategoria, actualizarCategoria, eliminarCategoria, listarGruposOpciones, crearGrupoOpciones, actualizarGrupoOpciones, eliminarGrupoOpciones, listarProductos, obtenerProducto, crearProducto, actualizarProducto, eliminarProducto };
