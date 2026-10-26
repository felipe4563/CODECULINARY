const {
  Categoria, Producto, ProductoStockSucursal, Promocion, Configuracion, sequelize,
} = require('../src/models');
const { migrarCatalogoPorSucursal } = require('../database/scripts/migrar-catalogo-por-sucursal');
const { crearDosSucursales } = require('./helpers/dosSucursales');

const CLAVE = 'catalogo_por_sucursal_migrado';

describe('Script de migración del catálogo por sucursal', () => {
  let ctx, principalId, flagOriginal, sufijo;
  let cat, prod, inactivo, sinStock, promo, promoSinMapa, promoInactiva;

  const borrarFlag = () => Configuracion.destroy({ where: { clave: CLAVE } });
  const copiaEn = (sucursal_id, nombre) => Producto.findOne({ where: { sucursal_id, nombre } });

  beforeAll(async () => {
    ctx = await crearDosSucursales();
    const [[fila]] = await sequelize.query('SELECT MIN(id) AS id FROM sucursales WHERE activo = 1');
    principalId = fila.id;
    flagOriginal = await Configuracion.findOne({ where: { clave: CLAVE } });

    // Fixtures en la principal: un producto con stock en la principal (5) y en A (3).
    sufijo = `${Date.now()}`;
    cat = await Categoria.create({ sucursal_id: principalId, nombre: `Cat Migrar ${sufijo}` });
    prod = await Producto.create({ sucursal_id: principalId, categoria_id: cat.id, nombre: `Prod Migrar ${sufijo}`, precio: 10, stock: 8, es_pesable: 0 });
    inactivo = await Producto.create({ sucursal_id: principalId, categoria_id: cat.id, nombre: `Prod Inactivo ${sufijo}`, precio: 10, stock: null, es_pesable: 0, activo: 0 });
    sinStock = await Producto.create({ sucursal_id: principalId, categoria_id: cat.id, nombre: `Prod Sin Stock ${sufijo}`, precio: 7, stock: null, es_pesable: 0 });
    await ProductoStockSucursal.bulkCreate([
      { producto_id: prod.id, sucursal_id: principalId, stock: 5 },
      { producto_id: prod.id, sucursal_id: ctx.sucursalA.id, stock: 3 },
    ]);

    promo = await Promocion.create({
      sucursal_id: principalId, nombre: `Promo Migrar ${sufijo}`, tipo: 'monto', valor: 2.5,
      fecha_inicio: '2026-01-01', fecha_fin: '2026-12-31', dias_semana: '1,3,5',
    });
    await promo.setProductos([prod.id, inactivo.id]);
    promoSinMapa = await Promocion.create({ sucursal_id: principalId, nombre: `Promo Sin Mapa ${sufijo}`, tipo: 'porcentaje', valor: 10 });
    await promoSinMapa.setProductos([inactivo.id]);
    promoInactiva = await Promocion.create({ sucursal_id: principalId, nombre: `Promo Inactiva ${sufijo}`, tipo: 'porcentaje', valor: 10, activo: 0 });
    await promoInactiva.setProductos([prod.id]);
  });

  afterAll(async () => {
    await borrarFlag();
    if (flagOriginal) await Configuracion.create({ clave: CLAVE, valor: flagOriginal.valor });
    await sequelize.query('DELETE FROM producto_stock_sucursal WHERE sucursal_id IN (:ids)', { replacements: { ids: [ctx.sucursalA.id, ctx.sucursalB.id] } });
    await ctx.limpiar();
    await Promocion.destroy({ where: { id: [promo.id, promoSinMapa.id, promoInactiva.id] } });
    await ProductoStockSucursal.destroy({ where: { producto_id: prod.id } });
    await Producto.destroy({ where: { id: [prod.id, inactivo.id, sinStock.id] } });
    await cat.destroy();
  });

  it('si falla a mitad de camino no escribe nada', async () => {
    await borrarFlag();
    await expect(migrarCatalogoPorSucursal({ destinos: [ctx.sucursalA.id, 999999999] })).rejects.toThrow();

    expect(await Producto.count({ where: { sucursal_id: ctx.sucursalA.id } })).toBe(0);
    expect(await Categoria.count({ where: { sucursal_id: ctx.sucursalA.id } })).toBe(0);
    expect(await Configuracion.count({ where: { clave: CLAVE } })).toBe(0);
    const filaA = await ProductoStockSucursal.findOne({ where: { producto_id: prod.id, sucursal_id: ctx.sucursalA.id } });
    expect(filaA.stock).toBe(3);
  });

  describe('después de migrar', () => {
    let resultado;

    beforeAll(async () => {
      await borrarFlag();
      resultado = await migrarCatalogoPorSucursal({ destinos: [ctx.sucursalA.id, ctx.sucursalB.id] });
    });

    it('devuelve un resumen por sucursal y guarda la clave', async () => {
      expect(resultado.principal_id).toBe(principalId);
      expect(resultado.sucursales.map((s) => s.sucursal_id)).toEqual([ctx.sucursalA.id, ctx.sucursalB.id]);
      expect(resultado.sucursales[0].creados.productos).toBeGreaterThan(0);
      const flag = await Configuracion.findOne({ where: { clave: CLAVE } });
      expect(flag.valor).toBe('true');
    });

    it('cada sucursal tiene una copia del producto y la copia tiene el stock que esa sucursal tenía', async () => {
      const copiaA = await copiaEn(ctx.sucursalA.id, prod.nombre);
      const copiaB = await copiaEn(ctx.sucursalB.id, prod.nombre);
      expect(copiaA).not.toBeNull();
      expect(copiaB).not.toBeNull();
      expect(copiaA.stock).toBe(3);
      expect(copiaB.stock).toBe(0);
      const filaA = await ProductoStockSucursal.findOne({ where: { producto_id: copiaA.id, sucursal_id: ctx.sucursalA.id } });
      expect(filaA.stock).toBe(3);
      expect(await ProductoStockSucursal.count({ where: { producto_id: copiaB.id } })).toBe(0);
    });

    it('el producto original conserva solo el stock de la principal', async () => {
      await prod.reload();
      expect(prod.stock).toBe(5);
      const filas = await ProductoStockSucursal.findAll({ where: { producto_id: prod.id } });
      expect(filas.map((f) => f.sucursal_id)).toEqual([principalId]);
    });

    it('no copia productos inactivos y no convierte en número un stock NULL', async () => {
      expect(await copiaEn(ctx.sucursalA.id, inactivo.nombre)).toBeNull();
      const copia = await copiaEn(ctx.sucursalA.id, sinStock.nombre);
      expect(copia.stock).toBeNull();
      await sinStock.reload();
      expect(sinStock.stock).toBeNull();
    });

    it('copia las promociones activas con sus productos mapeados', async () => {
      const copiaA = await copiaEn(ctx.sucursalA.id, prod.nombre);
      const promos = await Promocion.findAll({
        where: { sucursal_id: ctx.sucursalA.id },
        include: [{ model: Producto, as: 'productos' }],
      });
      const copia = promos.find((p) => p.nombre === promo.nombre);
      expect(copia).toBeDefined();
      expect(copia.tipo).toBe('monto');
      expect(parseFloat(copia.valor)).toBe(2.5);
      expect(copia.fecha_inicio).toBe('2026-01-01');
      expect(copia.fecha_fin).toBe('2026-12-31');
      expect(copia.dias_semana).toBe('1,3,5');
      expect(copia.productos.map((p) => p.id)).toEqual([copiaA.id]);
      // Sin productos mapeables o inactiva: no se copia.
      expect(promos.find((p) => p.nombre === promoSinMapa.nombre)).toBeUndefined();
      expect(promos.find((p) => p.nombre === promoInactiva.nombre)).toBeUndefined();
      expect(await Promocion.count({ where: { sucursal_id: ctx.sucursalB.id, nombre: promo.nombre } })).toBe(1);
    });

    it('correrlo dos veces no crea más copias', async () => {
      const contar = () => Producto.count({ where: { sucursal_id: [ctx.sucursalA.id, ctx.sucursalB.id] } });
      const antes = await contar();
      const segunda = await migrarCatalogoPorSucursal({ destinos: [ctx.sucursalA.id, ctx.sucursalB.id] });
      expect(segunda.ya_migrado).toBe(true);
      expect(segunda.sucursales).toEqual([]);
      expect(await contar()).toBe(antes);
      const copiaA = await copiaEn(ctx.sucursalA.id, prod.nombre);
      expect(copiaA.stock).toBe(3);
    });
  });
});
