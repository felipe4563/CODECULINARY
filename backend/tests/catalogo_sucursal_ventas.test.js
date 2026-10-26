const request = require('supertest');
const app = require('../src/app');
const {
  Categoria, Producto, GrupoOpciones, Opcion, Combo, ComboProducto, Promocion, Caja, SesionCaja, Pedido, DetallePedido,
  Area, Mesa, MesaSesion, ProductoStockSucursal, IntegracionApiKey, Usuario, sequelize,
} = require('../src/models');
const { crearDosSucursales } = require('./helpers/dosSucursales');
const ventasService = require('../src/modules/ventas/ventas.service');
const { crear: crearKey } = require('../src/modules/integraciones/integracionesAdmin.service');

describe('Ventas, autoservicio e integraciones por sucursal', () => {
  let ctx, usuarioId, sesionA, cajaA, areaA, mesaA, apiKeyA;
  let prodA, prodB, comboA, comboB, promoB, opcionB;
  const sufijo = Date.now();

  beforeAll(async () => {
    ctx = await crearDosSucursales();
    const usuario = await Usuario.findOne({ where: { acceso_todas_sucursales: 1 } });
    usuarioId = usuario.id;
    cajaA = await Caja.create({ sucursal_id: ctx.sucursalA.id, nombre: `Caja Cat ${sufijo}` });
    sesionA = await SesionCaja.create({ usuario_id: usuarioId, sucursal_id: ctx.sucursalA.id, caja_id: cajaA.id, monto_apertura: 0 });

    const catA = await Categoria.create({ sucursal_id: ctx.sucursalA.id, nombre: 'Cat Ventas A' });
    const catB = await Categoria.create({ sucursal_id: ctx.sucursalB.id, nombre: 'Cat Ventas B' });
    prodA = await Producto.create({ sucursal_id: ctx.sucursalA.id, categoria_id: catA.id, nombre: 'Prod Ventas A', precio: 10, es_vendible: 1 });
    prodB = await Producto.create({ sucursal_id: ctx.sucursalB.id, categoria_id: catB.id, nombre: 'Prod Ventas B', precio: 10, es_vendible: 1 });
    await ProductoStockSucursal.create({ producto_id: prodA.id, sucursal_id: ctx.sucursalA.id, stock: 100 });
    await ProductoStockSucursal.create({ producto_id: prodB.id, sucursal_id: ctx.sucursalB.id, stock: 100 });

    comboA = await Combo.create({ sucursal_id: ctx.sucursalA.id, nombre: 'Combo Ventas A', precio: 15, activo: 1 });
    await ComboProducto.create({ combo_id: comboA.id, producto_id: prodA.id, cantidad: 1 });
    comboB = await Combo.create({ sucursal_id: ctx.sucursalB.id, nombre: 'Combo Ventas B', precio: 15, activo: 1 });
    await ComboProducto.create({ combo_id: comboB.id, producto_id: prodB.id, cantidad: 1 });
    promoB = await Promocion.create({ sucursal_id: ctx.sucursalB.id, nombre: 'Promo Ventas B', tipo: 'porcentaje', valor: 10, activo: 1 });
    await promoB.setProductos([prodB.id]);

    const grupoB = await GrupoOpciones.create({ sucursal_id: ctx.sucursalB.id, nombre: 'Grupo Ventas B' });
    opcionB = await Opcion.create({ grupo_opciones_id: grupoB.id, nombre: 'Opcion B', precio_adicional: 2 });

    areaA = await Area.create({ nombre: `Area Cat ${sufijo}`, sucursal_id: ctx.sucursalA.id });
    mesaA = await Mesa.create({ area_id: areaA.id, nombre: 'Mesa Cat', codigo_qr: `cat-qr-${sufijo}` });
    await MesaSesion.create({ mesa_id: mesaA.id, sucursal_id: ctx.sucursalA.id, abierta_por: 'staff' });

    apiKeyA = (await crearKey({ sucursal_id: ctx.sucursalA.id, nombre_app: 'App Cat' })).api_key;
  });

  afterAll(async () => {
    const pedidos = await Pedido.findAll({ where: { sucursal_id: ctx.sucursalA.id }, attributes: ['id'] });
    const ids = pedidos.map((p) => p.id);
    if (ids.length) {
      await sequelize.query(
        'DELETE FROM detalle_pedido_combo_opciones WHERE detalle_pedido_id IN (SELECT id FROM detalle_pedidos WHERE pedido_id IN (:ids))',
        { replacements: { ids } },
      );
      await DetallePedido.destroy({ where: { pedido_id: ids } });
      await Pedido.destroy({ where: { id: ids } });
    }
    await MesaSesion.destroy({ where: { mesa_id: mesaA.id } });
    await Mesa.destroy({ where: { id: mesaA.id } });
    await Area.destroy({ where: { id: areaA.id } });
    await IntegracionApiKey.destroy({ where: { sucursal_id: ctx.sucursalA.id } });
    await SesionCaja.destroy({ where: { id: sesionA.id } });
    await Caja.destroy({ where: { id: cajaA.id } });
    await ProductoStockSucursal.destroy({ where: { producto_id: [prodA.id, prodB.id] } });
    await ctx.limpiar();
  });

  const crearEnA = (items) => ventasService.crearCompleta({
    tipo: 'llevar', items, metodo_pago: 'efectivo', monto_recibido: 1000, sesion_caja_id: sesionA.id, usuario_id: usuarioId,
  });

  describe('crearCompleta', () => {
    it('producto de B en venta de A → 404', async () => {
      await expect(crearEnA([{ producto_id: prodB.id, cantidad: 1 }]))
        .rejects.toMatchObject({ status: 404, message: 'Producto no encontrado' });
    });
    it('combo de B en venta de A → 404', async () => {
      await expect(crearEnA([{ combo_id: comboB.id, cantidad: 1 }]))
        .rejects.toMatchObject({ status: 404, message: 'Combo no encontrado' });
    });
    it('opcion_ids de un grupo de B → 404', async () => {
      await expect(crearEnA([{ producto_id: prodA.id, cantidad: 1, opcion_ids: [opcionB.id] }]))
        .rejects.toMatchObject({ status: 404, message: 'Opción no encontrada' });
    });
    it('opción inexistente → 404', async () => {
      await expect(crearEnA([{ producto_id: prodA.id, cantidad: 1, opcion_ids: [999999999] }]))
        .rejects.toMatchObject({ status: 404, message: 'Opción no encontrada' });
    });
    it('opciones_por_producto de un combo de A con opción de B → 404', async () => {
      await expect(crearEnA([{ combo_id: comboA.id, cantidad: 1, opciones_por_producto: [{ producto_id: prodA.id, opcion_ids: [opcionB.id] }] }]))
        .rejects.toMatchObject({ status: 404, message: 'Opción no encontrada' });
    });
    it('producto de A en venta de A → ok', async () => {
      const pedido = await crearEnA([{ producto_id: prodA.id, cantidad: 1 }]);
      expect(pedido).toBeTruthy();
    });
  });

  describe('agregarItem', () => {
    it('producto/combo/opción de B a un pedido de A → 404', async () => {
      const pedido = await Pedido.create({ tipo: 'llevar', usuario_id: usuarioId, sesion_caja_id: sesionA.id, sucursal_id: ctx.sucursalA.id, estado: 'pendiente' });
      await expect(ventasService.agregarItem(pedido.id, { producto_id: prodB.id, cantidad: 1 }))
        .rejects.toMatchObject({ status: 404, message: 'Producto no encontrado' });
      await expect(ventasService.agregarItem(pedido.id, { combo_id: comboB.id, cantidad: 1 }))
        .rejects.toMatchObject({ status: 404, message: 'Combo no encontrado' });
      await expect(ventasService.agregarItem(pedido.id, { producto_id: prodA.id, cantidad: 1, opcion_ids: [opcionB.id] }))
        .rejects.toMatchObject({ status: 404, message: 'Opción no encontrada' });
      const ok = await ventasService.agregarItem(pedido.id, { producto_id: prodA.id, cantidad: 1 });
      expect(ok.producto_id).toBe(prodA.id);
    });
  });

  describe('autoservicio e integraciones', () => {
    it('el menú de una mesa de A no trae productos, combos ni promociones de B', async () => {
      const res = await request(app).get(`/api/v1/autoservicio/mesa/${mesaA.codigo_qr}`);
      expect(res.status).toBe(200);
      expect(res.body.datos.productos.some((p) => p.id === prodA.id)).toBe(true);
      expect(res.body.datos.productos.some((p) => p.id === prodB.id)).toBe(false);
      expect(res.body.datos.combos.some((c) => c.id === comboB.id)).toBe(false);
      expect(res.body.datos.promociones.some((p) => p.producto_id === prodB.id)).toBe(false);
    });
    it('GET /integraciones/menu con API key de A no trae lo de B', async () => {
      const res = await request(app).get('/api/v1/integraciones/menu').set('X-Api-Key', apiKeyA);
      expect(res.status).toBe(200);
      expect(res.body.datos.combos.some((c) => c.id === comboA.id)).toBe(true);
      expect(res.body.datos.combos.some((c) => c.id === comboB.id)).toBe(false);
      expect(res.body.datos.productos.some((p) => p.id === prodB.id)).toBe(false);
      expect(res.body.datos.promociones.some((p) => p.producto_id === prodB.id)).toBe(false);
    });
  });
});
