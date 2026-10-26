// backend/tests/stock.service.test.js
require('dotenv').config();
const { Producto, Categoria, Sucursal, ProductoStockSucursal, Usuario } = require('../src/models');
const { ajustarStockSucursal } = require('../src/modules/inventario/stock.service');

let categoria, producto, sucursalA, sucursalB, admin;

beforeAll(async () => {
  sucursalA = await Sucursal.create({ nombre: 'Sucursal Stock Test A' });
  sucursalB = await Sucursal.create({ nombre: 'Sucursal Stock Test B' });
  // El producto pertenece a A: el stock solo se ajusta en su propia sucursal.
  categoria = await Categoria.create({ sucursal_id: sucursalA.id, nombre: 'Categoria Stock Test' });
  producto = await Producto.create({ sucursal_id: sucursalA.id, categoria_id: categoria.id, nombre: 'Producto Stock Test', precio: 10, stock: 0 });
  admin = await Usuario.findOne({ where: { email: 'admin@restaurante.com' } });
});

afterAll(async () => {
  await ProductoStockSucursal.destroy({ where: { producto_id: producto.id } });
  await Producto.destroy({ where: { id: producto.id } });
  await Categoria.destroy({ where: { id: categoria.id } });
  await Sucursal.destroy({ where: { id: [sucursalA.id, sucursalB.id] } });
});

describe('ajustarStockSucursal', () => {
  it('crea la fila de stock por sucursal en la primera entrada y suma', async () => {
    const r = await ajustarStockSucursal({ producto_id: producto.id, sucursal_id: sucursalA.id, tipo: 'entrada', cantidad: 10, usuario_id: admin.id, nota: 'test' });
    expect(r.stock_anterior).toBe(0);
    expect(r.stock_nuevo).toBe(10);

    const fila = await ProductoStockSucursal.findOne({ where: { producto_id: producto.id, sucursal_id: sucursalA.id } });
    expect(fila.stock).toBe(10);
  });

  it('rechaza ajustar el stock en una sucursal que no es la del producto', async () => {
    await expect(
      ajustarStockSucursal({ producto_id: producto.id, sucursal_id: sucursalB.id, tipo: 'entrada', cantidad: 15, usuario_id: admin.id })
    ).rejects.toMatchObject({ status: 409, message: 'El producto no pertenece a esta sucursal' });
    const filaB = await ProductoStockSucursal.findOne({ where: { producto_id: producto.id, sucursal_id: sucursalB.id } });
    expect(filaB).toBeNull();
  });

  it('una venta en A descuenta del stock de A', async () => {
    await ajustarStockSucursal({ producto_id: producto.id, sucursal_id: sucursalA.id, tipo: 'venta', cantidad: 3, usuario_id: admin.id });

    const filaA = await ProductoStockSucursal.findOne({ where: { producto_id: producto.id, sucursal_id: sucursalA.id } });
    expect(filaA.stock).toBe(7);
  });

  it('rechaza una venta/salida sin stock suficiente en esa sucursal', async () => {
    await expect(
      ajustarStockSucursal({ producto_id: producto.id, sucursal_id: sucursalA.id, tipo: 'salida', cantidad: 999, usuario_id: admin.id })
    ).rejects.toMatchObject({ status: 409 });
  });

  it('recalcula productos.stock a partir de las filas por sucursal', async () => {
    const p = await Producto.findByPk(producto.id);
    expect(p.stock).toBe(7);
  });

  it('un ajuste fija el valor absoluto de esa sucursal', async () => {
    await ajustarStockSucursal({ producto_id: producto.id, sucursal_id: sucursalA.id, tipo: 'ajuste', cantidad: 50, usuario_id: admin.id });
    const filaA = await ProductoStockSucursal.findOne({ where: { producto_id: producto.id, sucursal_id: sucursalA.id } });
    expect(filaA.stock).toBe(50);
  });
});
