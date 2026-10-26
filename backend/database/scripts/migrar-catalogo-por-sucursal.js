// Migración de datos del catálogo por sucursal. Se corre UNA vez, justo
// después de aplicar la migración 053 (que dejó todo el catálogo en la
// sucursal principal):
//
//   node database/scripts/migrar-catalogo-por-sucursal.js
//
// Copia a cada otra sucursal activa el catálogo de la principal (categorías,
// productos y combos activos, promociones activas) y le pasa a cada copia el
// stock que esa sucursal tenía del producto original. Todo va en una sola
// transacción: si algo falla no queda nada escrito. Al terminar guarda la
// clave `catalogo_por_sucursal_migrado` para no volver a correr.
//
// No toca detalle_pedidos, registros_inventario, cupon_productos ni
// ruleta_premios: el historial sigue apuntando a los productos originales.
require('dotenv').config();
const { QueryTypes } = require('sequelize');
const {
  sequelize, Sucursal, Categoria, Producto, Combo, Promocion, Configuracion,
} = require('../../src/models');
const { copiarCatalogo } = require('../../src/modules/productos/copiarCatalogo.service');

const CLAVE = 'catalogo_por_sucursal_migrado';

// `destinos` limita las sucursales a migrar (los tests lo usan); por defecto
// son todas las activas menos la principal.
async function migrarCatalogoPorSucursal({ transaction, destinos } = {}) {
  if (transaction) return _migrar(destinos, transaction);
  return sequelize.transaction((t) => _migrar(destinos, t));
}

async function _migrar(destinos, t) {
  const flag = await Configuracion.findOne({ where: { clave: CLAVE }, transaction: t, lock: t.LOCK.UPDATE });
  if (flag && flag.valor === 'true') {
    return { ya_migrado: true, mensaje: 'El catálogo ya fue migrado por sucursal; no se hizo nada', sucursales: [] };
  }

  const principal = await Sucursal.findOne({ where: { activo: 1 }, order: [['id', 'ASC']], transaction: t });
  if (!principal) throw new Error('No hay ninguna sucursal activa');

  let destinoIds;
  if (destinos) {
    destinoIds = [...new Set(destinos.map(Number))];
  } else {
    const otras = await Sucursal.findAll({ where: { activo: 1 }, attributes: ['id'], order: [['id', 'ASC']], transaction: t });
    destinoIds = otras.map((s) => s.id).filter((id) => id !== principal.id);
  }

  // Lo que se copia de la principal (igual para todas las sucursales).
  const categorias = await Categoria.findAll({ where: { sucursal_id: principal.id }, attributes: ['id'], transaction: t });
  const productos = await Producto.findAll({ where: { sucursal_id: principal.id, activo: 1 }, attributes: ['id', 'stock'], transaction: t });
  const combos = await Combo.findAll({ where: { sucursal_id: principal.id, activo: 1 }, attributes: ['id'], transaction: t });
  const promociones = await Promocion.findAll({
    where: { sucursal_id: principal.id, activo: 1 },
    include: [{ model: Producto, as: 'productos', attributes: ['id'], through: { attributes: [] } }],
    order: [['id', 'ASC']],
    transaction: t,
  });
  const conStock = productos.filter((p) => p.stock !== null).map((p) => p.id);

  const sucursales = [];
  for (const destinoId of destinoIds) {
    const r = await copiarCatalogo({
      origen_id: principal.id,
      destino_id: destinoId,
      categoria_ids: categorias.map((c) => c.id),
      producto_ids: productos.map((p) => p.id),
      combo_ids: combos.map((c) => c.id),
    }, { transaction: t });
    const creados = { ...r.creados, promociones: 0 };
    const omitidos = [...r.omitidos];

    // --- Promociones: con sus productos mapeados a los de la sucursal ---
    for (const promo of promociones) {
      const ids = [...new Set(promo.productos.map((p) => r.mapaProductos[p.id]).filter(Boolean))];
      if (!ids.length) {
        omitidos.push({ tipo: 'promocion', nombre: promo.nombre, motivo: 'ninguno de sus productos existe en la sucursal destino' });
        continue;
      }
      const copia = await Promocion.create({
        sucursal_id: destinoId,
        nombre: promo.nombre,
        tipo: promo.tipo,
        valor: promo.valor,
        fecha_inicio: promo.fecha_inicio,
        fecha_fin: promo.fecha_fin,
        dias_semana: promo.dias_semana,
        activo: promo.activo,
      }, { transaction: t });
      await copia.setProductos(ids, { transaction: t });
      creados.promociones++;
    }

    // --- Stock: la fila de esta sucursal pasa del original a su copia ---
    for (const originalId of conStock) {
      const copiaId = r.mapaProductos[originalId];
      if (!copiaId) continue;
      await _moverStock(originalId, copiaId, destinoId, t);
    }

    sucursales.push({ sucursal_id: destinoId, creados, omitidos });
  }

  if (flag) await flag.update({ valor: 'true' }, { transaction: t });
  else await Configuracion.create({ clave: CLAVE, valor: 'true' }, { transaction: t });

  return { principal_id: principal.id, sucursales };
}

// Pasa la fila de stock (original, sucursal) a (copia, sucursal) y recalcula
// productos.stock de ambos. Si la copia ya tenía fila en esa sucursal (un
// producto equivalente que ya existía), se suman.
async function _moverStock(originalId, copiaId, sucursalId, t) {
  const q = (sql, replacements, type) => sequelize.query(sql, { replacements, type, transaction: t });
  const [fila] = await q(
    'SELECT stock FROM producto_stock_sucursal WHERE producto_id = :originalId AND sucursal_id = :sucursalId FOR UPDATE',
    { originalId, sucursalId }, QueryTypes.SELECT
  );
  if (!fila) return;

  const [existente] = await q(
    'SELECT stock FROM producto_stock_sucursal WHERE producto_id = :copiaId AND sucursal_id = :sucursalId FOR UPDATE',
    { copiaId, sucursalId }, QueryTypes.SELECT
  );
  if (existente) {
    await q('UPDATE producto_stock_sucursal SET stock = stock + :stock WHERE producto_id = :copiaId AND sucursal_id = :sucursalId',
      { stock: fila.stock, copiaId, sucursalId });
    await q('DELETE FROM producto_stock_sucursal WHERE producto_id = :originalId AND sucursal_id = :sucursalId',
      { originalId, sucursalId });
  } else {
    await q('UPDATE producto_stock_sucursal SET producto_id = :copiaId WHERE producto_id = :originalId AND sucursal_id = :sucursalId',
      { copiaId, originalId, sucursalId });
  }

  // Solo productos que controlan inventario: un stock NULL sigue NULL.
  await q(
    `UPDATE productos p SET p.stock = (SELECT COALESCE(SUM(s.stock), 0) FROM producto_stock_sucursal s WHERE s.producto_id = p.id)
     WHERE p.id IN (:ids) AND p.stock IS NOT NULL`,
    { ids: [originalId, copiaId] }
  );
}

if (require.main === module) {
  migrarCatalogoPorSucursal()
    .then(async (r) => {
      if (r.ya_migrado) {
        console.log(r.mensaje);
      } else {
        console.log(`Sucursal principal: ${r.principal_id}`);
        if (!r.sucursales.length) console.log('No hay otras sucursales activas: solo se marcó la migración como hecha.');
        for (const s of r.sucursales) {
          const c = s.creados;
          console.log(`Sucursal ${s.sucursal_id}: ${c.categorias} categorías, ${c.grupos_opciones} grupos de opciones, `
            + `${c.productos} productos, ${c.combos} combos, ${c.promociones} promociones creados; ${s.omitidos.length} omitidos`);
        }
        console.log('Migración del catálogo por sucursal completada.');
      }
      await sequelize.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('Error en la migración (no se escribió nada):', err.message);
      await sequelize.close().catch(() => {});
      process.exit(1);
    });
}

module.exports = { migrarCatalogoPorSucursal };
