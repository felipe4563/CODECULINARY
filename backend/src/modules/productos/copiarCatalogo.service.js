const {
  Sucursal, Categoria, Producto, GrupoOpciones, Opcion, ProductoGrupoOpciones, RecetaInsumo, Combo, ComboProducto,
} = require('../../models');
const sequelize = require('../../config/database');

function _error(mensaje, status) {
  return Object.assign(new Error(mensaje), { status });
}

// Copia parte del catálogo de una sucursal a otra. La copia no sincroniza:
// crea filas nuevas e independientes en el destino y reutiliza (por nombre)
// las categorías, grupos de opciones, productos y combos que ya existan ahí.
// Los ids seleccionados que no sean de la sucursal origen se ignoran.
// Si no recibe `transaction` abre una propia (el script de migración pasa la suya).
async function copiarCatalogo(params, { transaction } = {}) {
  if (transaction) return _copiar(params, transaction);
  return sequelize.transaction((t) => _copiar(params, t));
}

async function _copiar({ origen_id, destino_id, categoria_ids = [], producto_ids = [], combo_ids = [] }, t) {
  const origenId = Number(origen_id);
  const destinoId = Number(destino_id);
  if (origenId === destinoId) throw _error('La sucursal origen y destino deben ser distintas', 400);
  const sucursales = await Sucursal.count({ where: { id: [origenId, destinoId].filter(Boolean) }, transaction: t });
  if (sucursales !== 2) throw _error('Sucursal no encontrada', 404);

  const creados = { categorias: 0, grupos_opciones: 0, productos: 0, combos: 0 };
  const omitidos = [];
  const mapaProductos = {};
  const mapaCategorias = {}; // id origen -> categoría destino
  const mapaGrupos = {}; // id origen -> grupo destino (con sus opciones)

  // Categoría destino con el mismo nombre (o null), sin crearla.
  const buscarCategoria = (nombre) => Categoria.findOne({ where: { sucursal_id: destinoId, nombre }, order: [['id', 'ASC']], transaction: t });

  async function categoriaDestino(cat) {
    if (mapaCategorias[cat.id]) return mapaCategorias[cat.id];
    let destino = await buscarCategoria(cat.nombre);
    if (!destino) {
      destino = await Categoria.create({ sucursal_id: destinoId, nombre: cat.nombre, imagen: cat.imagen, activo: cat.activo }, { transaction: t });
      creados.categorias++;
    }
    mapaCategorias[cat.id] = destino;
    return destino;
  }

  // Un grupo reutilizado conserva sus propias opciones; uno nuevo se crea con
  // las del origen.
  async function grupoDestino(grupo) {
    if (mapaGrupos[grupo.id]) return mapaGrupos[grupo.id];
    let destino = await GrupoOpciones.findOne({
      where: { sucursal_id: destinoId, nombre: grupo.nombre },
      include: [{ model: Opcion, as: 'opciones' }],
      order: [['id', 'ASC']],
      transaction: t,
    });
    if (!destino) {
      const nuevo = await GrupoOpciones.create({ sucursal_id: destinoId, nombre: grupo.nombre, tipo_seleccion: grupo.tipo_seleccion }, { transaction: t });
      const opciones = await Opcion.bulkCreate(
        grupo.opciones.map((o) => ({ grupo_opciones_id: nuevo.id, nombre: o.nombre, precio_adicional: o.precio_adicional, orden: o.orden })),
        { transaction: t }
      );
      destino = { id: nuevo.id, opciones };
      creados.grupos_opciones++;
    }
    mapaGrupos[grupo.id] = destino;
    return destino;
  }

  // Producto equivalente en el destino: mismo nombre dentro de la categoría con el mismo nombre.
  async function productoEquivalente(nombre, nombreCategoria) {
    const cat = await buscarCategoria(nombreCategoria);
    if (!cat) return null;
    return Producto.findOne({ where: { sucursal_id: destinoId, categoria_id: cat.id, nombre }, order: [['id', 'ASC']], transaction: t });
  }

  // --- Categorías seleccionadas: se crean aunque no tengan productos activos ---
  const categorias = categoria_ids.length
    ? await Categoria.findAll({ where: { id: categoria_ids, sucursal_id: origenId }, order: [['id', 'ASC']], transaction: t })
    : [];
  for (const cat of categorias) await categoriaDestino(cat);

  // --- Productos: los seleccionados más los activos de las categorías seleccionadas ---
  const idsProductos = new Set(producto_ids.map(Number));
  if (categorias.length) {
    const deCategorias = await Producto.findAll({
      where: { sucursal_id: origenId, categoria_id: categorias.map((c) => c.id), activo: 1 },
      attributes: ['id'],
      transaction: t,
    });
    deCategorias.forEach((p) => idsProductos.add(p.id));
  }
  const productos = idsProductos.size
    ? await Producto.findAll({
        where: { id: [...idsProductos], sucursal_id: origenId },
        include: [
          { model: Categoria, as: 'categoria' },
          { model: GrupoOpciones, as: 'grupos_opciones', through: { attributes: ['orden', 'obligatorio'] },
            include: [{ model: Opcion, as: 'opciones' }] },
          { model: RecetaInsumo, as: 'receta', include: [{ model: Opcion, as: 'opcion' }] },
        ],
        order: [['id', 'ASC']],
        transaction: t,
      })
    : [];

  for (const p of productos) {
    const existente = await productoEquivalente(p.nombre, p.categoria.nombre);
    if (existente) {
      mapaProductos[p.id] = existente.id;
      omitidos.push({ tipo: 'producto', nombre: p.nombre, motivo: 'ya existe en la sucursal destino' });
      continue;
    }

    const cat = await categoriaDestino(p.categoria);
    // No se copia stock: si el origen controla inventario, la copia arranca en 0
    // (sin fila en producto_stock_sucursal); si no, sigue sin control (NULL).
    const copia = await Producto.create({
      sucursal_id: destinoId,
      categoria_id: cat.id,
      nombre: p.nombre,
      precio: p.precio,
      imagen: p.imagen,
      es_vendible: p.es_vendible,
      es_pesable: p.es_pesable,
      activo: p.activo,
      disponible_hoy: p.disponible_hoy,
      stock: p.stock === null ? null : 0,
    }, { transaction: t });
    mapaProductos[p.id] = copia.id;
    creados.productos++;

    const asignados = new Set();
    for (const g of p.grupos_opciones) {
      const destino = await grupoDestino(g);
      if (asignados.has(destino.id)) continue;
      asignados.add(destino.id);
      await ProductoGrupoOpciones.create({
        producto_id: copia.id, grupo_opciones_id: destino.id,
        orden: g.ProductoGrupoOpciones.orden, obligatorio: g.ProductoGrupoOpciones.obligatorio,
      }, { transaction: t });
    }

    const lineas = [];
    for (const linea of p.receta) {
      let opcion_id = null;
      if (linea.opcion_id) {
        const grupo = mapaGrupos[linea.opcion.grupo_opciones_id];
        const opcion = grupo && grupo.opciones.find((o) => o.nombre === linea.opcion.nombre);
        if (!opcion) {
          omitidos.push({ tipo: 'receta', nombre: p.nombre, motivo: `la opción ${linea.opcion.nombre} no existe en el grupo destino` });
          continue;
        }
        opcion_id = opcion.id;
      }
      lineas.push({ producto_id: copia.id, opcion_id, insumo_id: linea.insumo_id, cantidad: linea.cantidad });
    }
    if (lineas.length) await RecetaInsumo.bulkCreate(lineas, { transaction: t });
  }

  // --- Combos: solo si no existe uno igual y todos sus productos tienen equivalente ---
  const combos = combo_ids.length
    ? await Combo.findAll({
        where: { id: combo_ids, sucursal_id: origenId },
        include: [{ model: Producto, as: 'productos', through: { attributes: ['cantidad'] },
          include: [{ model: Categoria, as: 'categoria' }] }],
        order: [['id', 'ASC']],
        transaction: t,
      })
    : [];

  for (const combo of combos) {
    const yaExiste = await Combo.count({ where: { sucursal_id: destinoId, nombre: combo.nombre }, transaction: t });
    if (yaExiste) {
      omitidos.push({ tipo: 'combo', nombre: combo.nombre, motivo: 'ya existe en la sucursal destino' });
      continue;
    }

    const lineas = [];
    let faltante = null;
    for (const prod of combo.productos) {
      let destinoProductoId = mapaProductos[prod.id];
      if (!destinoProductoId) {
        const equivalente = await productoEquivalente(prod.nombre, prod.categoria.nombre);
        destinoProductoId = equivalente && equivalente.id;
      }
      if (!destinoProductoId) { faltante = prod.nombre; break; }
      // Dos productos del origen pueden caer en el mismo del destino: se suman.
      const repetida = lineas.find((l) => l.producto_id === destinoProductoId);
      if (repetida) repetida.cantidad += prod.ComboProducto.cantidad;
      else lineas.push({ producto_id: destinoProductoId, cantidad: prod.ComboProducto.cantidad });
    }
    if (faltante) {
      omitidos.push({ tipo: 'combo', nombre: combo.nombre, motivo: `falta el producto ${faltante} en la sucursal destino` });
      continue;
    }

    const copia = await Combo.create({
      sucursal_id: destinoId,
      nombre: combo.nombre,
      descripcion: combo.descripcion,
      precio: combo.precio,
      imagen: combo.imagen,
      activo: combo.activo,
      fecha_inicio: combo.fecha_inicio,
      fecha_fin: combo.fecha_fin,
      dias_semana: combo.dias_semana,
    }, { transaction: t });
    if (lineas.length) {
      await ComboProducto.bulkCreate(lineas.map((l) => ({ combo_id: copia.id, ...l })), { transaction: t });
    }
    creados.combos++;
  }

  return { creados, omitidos, mapaProductos };
}

module.exports = { copiarCatalogo };
