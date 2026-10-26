const { Categoria, Producto, Sucursal, GrupoOpciones, Opcion, ProductoGrupoOpciones, DetallePedido } = require('../../models');
const { Op } = require('sequelize');
const sequelize = require('../../config/database');
const { ajustarStockSucursal, mezclarStockPorSucursal } = require('../inventario/stock.service');
const { emitir } = require('../../socket');
const { filtroSucursalCatalogo, sucursalParaCrear, verificarSucursal } = require('../../utils/alcanceCatalogo');

// Avisa a la app de pedidos (y a cualquier otro cliente conectado, p. ej. el
// admin en otra pestaña) que el catálogo cambió, para que refresque contra
// GET /productos — no manda el producto completo por socket, solo la señal.
// Se emite sin sucursal_id (a todos): cada sucursal tiene su propio catálogo,
// pero la señal es solo "refresca" y cada cliente vuelve a pedir su listado.
function _avisarCambioProducto(tipo, producto_id) {
  emitir('productos:actualizado', { tipo, producto_id });
}

// --- Categorías ---

async function listarCategorias(alcance, sucursal_id) {
  return Categoria.findAll({ where: filtroSucursalCatalogo(alcance, sucursal_id), order: [['nombre', 'ASC']] });
}

async function crearCategoria({ nombre, imagen, sucursal_id }, alcance) {
  const sucursalDestino = await sucursalParaCrear(alcance, sucursal_id);
  return Categoria.create({ nombre, imagen, sucursal_id: sucursalDestino });
}

// sucursal_id no se destructura: una categoría no cambia de sucursal.
async function actualizarCategoria(id, { nombre, imagen, activo }, alcance) {
  const cat = await Categoria.findByPk(id);
  if (!cat) throw Object.assign(new Error('Categoría no encontrada'), { status: 404 });
  verificarSucursal(cat, alcance, 'Categoría no encontrada');
  await cat.update({ nombre, imagen, activo });
  return cat;
}

async function eliminarCategoria(id, alcance) {
  const cat = await Categoria.findByPk(id);
  if (!cat) throw Object.assign(new Error('Categoría no encontrada'), { status: 404 });
  verificarSucursal(cat, alcance, 'Categoría no encontrada');
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

async function listarGruposOpciones(alcance, sucursal_id) {
  return GrupoOpciones.findAll({
    where: filtroSucursalCatalogo(alcance, sucursal_id),
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

async function crearGrupoOpciones({ nombre, tipo_seleccion, opciones = [], sucursal_id }, alcance) {
  const sucursalDestino = await sucursalParaCrear(alcance, sucursal_id);
  return sequelize.transaction(async (t) => {
    const grupo = await GrupoOpciones.create({ nombre, tipo_seleccion, sucursal_id: sucursalDestino }, { transaction: t });
    if (opciones.length) {
      await Opcion.bulkCreate(
        opciones.map((o, i) => ({ grupo_opciones_id: grupo.id, nombre: o.nombre, precio_adicional: o.precio_adicional || 0, orden: o.orden ?? i })),
        { transaction: t }
      );
    }
    return _conOpciones(grupo.id, t);
  });
}

async function actualizarGrupoOpciones(id, { nombre, tipo_seleccion, opciones = [] }, alcance) {
  return sequelize.transaction(async (t) => {
    const grupo = await GrupoOpciones.findByPk(id, { transaction: t });
    if (!grupo) throw Object.assign(new Error('Grupo de opciones no encontrado'), { status: 404 });
    verificarSucursal(grupo, alcance, 'Grupo de opciones no encontrado');
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

async function eliminarGrupoOpciones(id, alcance) {
  const grupo = await GrupoOpciones.findByPk(id);
  if (!grupo) throw Object.assign(new Error('Grupo de opciones no encontrado'), { status: 404 });
  verificarSucursal(grupo, alcance, 'Grupo de opciones no encontrado');
  // producto_grupos_opciones tiene ON DELETE CASCADE en grupo_opciones_id: las
  // asignaciones de productos a este grupo se borran solas, no hace falta tocarlas a mano.
  await grupo.destroy();
}

async function _sincronizarGruposOpciones(producto_id, grupos_opciones = [], transaction, sucursal_id) {
  const ids = grupos_opciones.map((g) => g.id);
  if (new Set(ids).size !== ids.length) {
    throw Object.assign(new Error('No se puede asignar el mismo grupo de opciones más de una vez'), { status: 400 });
  }
  if (ids.length) {
    const deOtraSucursal = await GrupoOpciones.count({ where: { id: ids, sucursal_id: { [Op.ne]: sucursal_id } }, transaction });
    if (deOtraSucursal > 0) {
      throw Object.assign(new Error('El grupo de opciones no pertenece a la sucursal del producto'), { status: 400 });
    }
  }
  await ProductoGrupoOpciones.destroy({ where: { producto_id }, transaction });
  if (grupos_opciones.length) {
    await ProductoGrupoOpciones.bulkCreate(
      grupos_opciones.map((g, i) => ({ producto_id, grupo_opciones_id: g.id, orden: g.orden ?? i, obligatorio: !!g.obligatorio })),
      { transaction }
    );
  }
}

// Arma la URL completa de la imagen a partir de la ruta relativa guardada
// en BD (ej. "/uploads/xxx.jpg") — así cualquier cliente (frontend propio,
// app de pedidos externa, etc.) la puede usar directo en un <img src> sin
// tener que conocer/armar la URL base del backend.
function _urlAbsoluta(ruta) {
  if (!ruta) return ruta;
  const base = (process.env.PUBLIC_API_URL || '').replace(/\/+$/, '');
  return `${base}${ruta}`;
}

// Contraparte de _urlAbsoluta, para antes de guardar. El formulario de
// edición carga `imagen` con lo que devolvió el GET (ya absolutizado) y lo
// reenvía tal cual en el PUT aunque el usuario no haya tocado la imagen —
// si se guardara así, la siguiente lectura le antepondría la base OTRA VEZ
// y quedaría duplicada/rota (http://host:puertohttp://host:puerto/uploads/...).
// Da igual qué mande el cliente (relativa o absoluta): acá siempre se le
// saca el prefijo de base antes de persistir.
function _urlRelativa(ruta) {
  if (!ruta) return ruta;
  const base = (process.env.PUBLIC_API_URL || '').replace(/\/+$/, '');
  if (base && ruta.startsWith(base)) return ruta.slice(base.length);
  return ruta;
}

function _normalizarGruposOpciones(producto) {
  producto.imagen = _urlAbsoluta(producto.imagen);
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

async function listarProductos({ categoria_id, solo_vendibles, solo_disponibles, solo_disponibles_hoy, order_by, solo_inactivos, sucursal_id } = {}, alcance) {
  const where = { ...filtroSucursalCatalogo(alcance, sucursal_id) };
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
      { model: Sucursal, as: 'sucursal', attributes: ['id', 'nombre'] },
      { model: GrupoOpciones, as: 'grupos_opciones', attributes: ['id', 'nombre', 'tipo_seleccion'],
        through: { attributes: ['orden', 'obligatorio'] },
        include: [{ model: Opcion, as: 'opciones', attributes: ['id', 'nombre', 'precio_adicional', 'orden'] }] },
    ],
    order,
  });

  const conStock = await mezclarStockPorSucursal(productos, alcance);
  conStock.forEach(_normalizarGruposOpciones);

  let resultado = conStock;
  if (solo_disponibles === 'true' || solo_disponibles === true) {
    resultado = resultado.filter((p) => p.stock === null || p.stock > 0);
  }
  if (solo_disponibles_hoy === 'true' || solo_disponibles_hoy === true) {
    resultado = resultado.filter((p) => p.disponible_hoy);
  }
  return resultado;
}

async function obtenerProducto(id, alcance) {
  const p = await Producto.findByPk(id, {
    include: [
      { model: Categoria, as: 'categoria', attributes: ['id', 'nombre'] },
      { model: Sucursal, as: 'sucursal', attributes: ['id', 'nombre'] },
      { model: GrupoOpciones, as: 'grupos_opciones', attributes: ['id', 'nombre', 'tipo_seleccion'],
        through: { attributes: ['orden', 'obligatorio'] },
        include: [{ model: Opcion, as: 'opciones', attributes: ['id', 'nombre', 'precio_adicional', 'orden'] }] },
    ],
  });
  if (!p) throw Object.assign(new Error('Producto no encontrado'), { status: 404 });
  verificarSucursal(p, alcance, 'Producto no encontrado');
  const [conStock] = await mezclarStockPorSucursal([p], alcance);
  return _normalizarGruposOpciones(conStock);
}

async function crearProducto({ categoria_id, nombre, precio, stock, sucursal_id, es_vendible, imagen, grupos_opciones, es_pesable }, alcance) {
  const sucursalDestino = await sucursalParaCrear(alcance, sucursal_id);
  const conStock = stock !== undefined && stock !== null;

  const categoria = await Categoria.findByPk(categoria_id);
  if (!categoria || categoria.sucursal_id !== sucursalDestino) {
    throw Object.assign(new Error('La categoría no pertenece a la sucursal del producto'), { status: 400 });
  }

  const producto = await sequelize.transaction(async (t) => {
    const p = await Producto.create({ categoria_id, nombre, precio, stock: conStock ? 0 : null, es_vendible, imagen: _urlRelativa(imagen), es_pesable, sucursal_id: sucursalDestino }, { transaction: t });
    await _sincronizarGruposOpciones(p.id, grupos_opciones, t, sucursalDestino);
    return p;
  });

  if (conStock) {
    await ajustarStockSucursal({ producto_id: producto.id, sucursal_id: sucursalDestino, tipo: 'ajuste', cantidad: stock, usuario_id: alcance.usuario_id, nota: 'Stock inicial' });
  }

  _avisarCambioProducto('creado', producto.id);
  return obtenerProducto(producto.id, alcance);
}

async function actualizarProducto(id, datos, alcance) {
  // stock nunca se edita aquí (solo vía ajustarStockSucursal) y un producto no cambia de sucursal.
  const { stock, grupos_opciones, sucursal_id: _ignorada, ...resto } = datos;
  if (resto.imagen !== undefined) resto.imagen = _urlRelativa(resto.imagen);
  const p = await Producto.findByPk(id);
  if (!p) throw Object.assign(new Error('Producto no encontrado'), { status: 404 });
  verificarSucursal(p, alcance, 'Producto no encontrado');
  if (resto.categoria_id !== undefined) {
    const categoria = await Categoria.findByPk(resto.categoria_id);
    if (!categoria || categoria.sucursal_id !== p.sucursal_id) {
      throw Object.assign(new Error('La categoría no pertenece a la sucursal del producto'), { status: 400 });
    }
  }
  await sequelize.transaction(async (t) => {
    await p.update(resto, { transaction: t });
    if (grupos_opciones !== undefined) {
      await _sincronizarGruposOpciones(id, grupos_opciones, t, p.sucursal_id);
    }
  });
  _avisarCambioProducto('actualizado', id);
  return obtenerProducto(id, alcance);
}

async function eliminarProducto(id, alcance) {
  const p = await Producto.findByPk(id);
  if (!p) throw Object.assign(new Error('Producto no encontrado'), { status: 404 });
  verificarSucursal(p, alcance, 'Producto no encontrado');

  const tieneVentas = await DetallePedido.count({ where: { producto_id: id } });
  if (tieneVentas > 0) {
    await p.update({ activo: 0 });
    _avisarCambioProducto('actualizado', id);
    return { eliminado: false };
  }
  await p.destroy();
  _avisarCambioProducto('eliminado', id);
  return { eliminado: true };
}

async function actualizarDisponibilidad(id, disponible_hoy, alcance) {
  const p = await Producto.findByPk(id);
  if (!p) throw Object.assign(new Error('Producto no encontrado'), { status: 404 });
  verificarSucursal(p, alcance, 'Producto no encontrado');
  await p.update({ disponible_hoy: !!disponible_hoy });
  _avisarCambioProducto('actualizado', id);
  return { id: p.id, disponible_hoy: !!p.disponible_hoy };
}

module.exports = { listarCategorias, crearCategoria, actualizarCategoria, eliminarCategoria, listarGruposOpciones, crearGrupoOpciones, actualizarGrupoOpciones, eliminarGrupoOpciones, listarProductos, obtenerProducto, crearProducto, actualizarProducto, eliminarProducto, actualizarDisponibilidad, _normalizarGruposOpciones };
