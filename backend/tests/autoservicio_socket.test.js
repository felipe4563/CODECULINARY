jest.mock('../src/socket', () => ({ emitir: jest.fn(), init: jest.fn() }));
const { emitir } = require('../src/socket');
const bcrypt = require('bcryptjs');
const { Sucursal, Area, Mesa, MesaSesion, Categoria, Producto, ProductoStockSucursal, Rol, Usuario, Caja, SesionCaja, Pedido, DetallePedido, PagoQr, LibroCaja } = require('../src/models');
const { procesarWebhookPagoQr } = require('../src/modules/ventas/ventas.service');

describe('Socket: pedido autoservicio confirmado', () => {
  let pedidoId, orderId, sucursalId, usuarioId, cajaId, sesionId, productoId, mesaId, areaId;
  const timestamp = Date.now();

  beforeAll(async () => {
    try {
      const sucursal = await Sucursal.create({ nombre: `Sucursal Socket Autoservicio Test ${timestamp}` });
      sucursalId = sucursal.id;
      const area = await Area.create({ nombre: `Area Socket Autoservicio Test ${timestamp}`, sucursal_id: sucursalId });
      areaId = area.id;
      const mesa = await Mesa.create({ area_id: areaId, nombre: `Mesa Socket Autoservicio Test ${timestamp}` });
      mesaId = mesa.id;
      const sesionMesa = await MesaSesion.create({ mesa_id: mesaId, sucursal_id: sucursalId, abierta_por: 'autoservicio' });

      const categoria = await Categoria.create({ nombre: `Categoria Socket Autoservicio Test ${timestamp}` });
      const producto = await Producto.create({ categoria_id: categoria.id, nombre: `Producto Socket Autoservicio Test ${timestamp}`, precio: 30, stock: 0 });
      productoId = producto.id;
      await ProductoStockSucursal.create({ producto_id: productoId, sucursal_id: sucursalId, stock: 10 });

      const rol = await Rol.findOne({ where: { nombre: 'Cajero' } });
      if (!rol) throw new Error('Rol Cajero not found');
      const hash = await bcrypt.hash('clave123', 10);
      const usuario = await Usuario.create({ rol_id: rol.id, nombre: `Socket Autoservicio Test ${timestamp}`, email: `socket-autoservicio-test-${timestamp}@restaurante.com`, contrasena: hash });
      usuarioId = usuario.id;

      const caja = await Caja.create({ sucursal_id: sucursalId, nombre: 'Caja Socket Autoservicio Test' });
      cajaId = caja.id;
      const sesionCaja = await SesionCaja.create({ usuario_id: usuarioId, sucursal_id: sucursalId, caja_id: cajaId, monto_apertura: 0 });
      sesionId = sesionCaja.id;

      const pedido = await Pedido.create({
        sucursal_id: sucursalId, mesa_id: mesaId, mesa_sesion_id: sesionMesa.id, origen: 'autoservicio',
        usuario_id: usuarioId, sesion_caja_id: sesionId, tipo: 'mesa', estado: 'pendiente_pago', total: 30,
      });
      pedidoId = pedido.id;
      await DetallePedido.create({ pedido_id: pedidoId, producto_id: productoId, cantidad: 1, precio: 30 });

      orderId = `pedido_${pedidoId}_1`;
      await PagoQr.create({
        pedido_id: pedidoId, sucursal_id: sucursalId, order_id: orderId,
        estado: 'pendiente', estado_previo: 'pendiente', monto_neto: 30,
        expires_at: new Date(Date.now() + 30 * 60000),
      });
    } catch (err) {
      console.error('Setup error:', err.message);
      throw err;
    }
  });

  afterAll(async () => {
    if (!pedidoId) return; // Skip cleanup if setup failed
    await PagoQr.destroy({ where: { pedido_id: pedidoId } });
    await LibroCaja.destroy({ where: { referencia_id: pedidoId } });
    await DetallePedido.destroy({ where: { pedido_id: pedidoId } });
    await Pedido.destroy({ where: { id: pedidoId } });
    if (sesionId) await SesionCaja.destroy({ where: { id: sesionId } });
    if (cajaId) await Caja.destroy({ where: { id: cajaId } });
    if (productoId) await ProductoStockSucursal.destroy({ where: { producto_id: productoId } });
    if (productoId) await Producto.destroy({ where: { id: productoId } });
    if (usuarioId) await Usuario.destroy({ where: { id: usuarioId } });
    if (mesaId) await MesaSesion.destroy({ where: { mesa_id: mesaId } });
    if (mesaId) await Mesa.destroy({ where: { id: mesaId } });
    if (areaId) await Area.destroy({ where: { id: areaId } });
    if (sucursalId) await Sucursal.destroy({ where: { id: sucursalId } });
  });

  it('emite restaurante:autoservicio_confirmado al confirmarse el pago', async () => {
    await procesarWebhookPagoQr({ event: 'payment.completed', order_id: orderId });

    const eventos = emitir.mock.calls.map(c => c[0]);
    expect(eventos).toContain('restaurante:autoservicio_confirmado');

    const llamadaAutoservicio = emitir.mock.calls.find(c => c[0] === 'restaurante:autoservicio_confirmado');
    expect(llamadaAutoservicio[1]).toMatchObject({ pedido_id: pedidoId, monto: 30 });
    expect(llamadaAutoservicio[2]).toBe(sucursalId);
  });
});
