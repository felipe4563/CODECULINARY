const bcrypt = require('bcryptjs');
const { Sucursal, Area, Mesa, Rol, Usuario, Caja, SesionCaja, Pedido, PagoQr } = require('../src/models');
const { expirarPagosQrVencidos } = require('../src/jobs/expirarPagosQr.job');

describe('Job: expirar pagos QR vencidos', () => {
  let sucursalId, pedidoId;

  beforeAll(async () => {
    const ts = Date.now();
    const sucursal = await Sucursal.create({ nombre: `Sucursal ExpiraQr Test ${ts}` });
    sucursalId = sucursal.id;
    const area = await Area.create({ nombre: `Area ExpiraQr Test ${ts}`, sucursal_id: sucursalId });
    const mesa = await Mesa.create({ area_id: area.id, nombre: `Mesa ExpiraQr Test ${ts}` });
    const rol = await Rol.findOne({ where: { nombre: 'Cajero' } });
    const hash = await bcrypt.hash('clave123', 10);
    const usuario = await Usuario.create({ rol_id: rol.id, nombre: `ExpiraQr Test ${ts}`, email: `expiraqr-test-${ts}@restaurante.com`, contrasena: hash });
    const caja = await Caja.create({ sucursal_id: sucursalId, nombre: `Caja ExpiraQr Test ${ts}` });
    const sesionCaja = await SesionCaja.create({ usuario_id: usuario.id, sucursal_id: sucursalId, caja_id: caja.id, monto_apertura: 0 });
    const pedido = await Pedido.create({
      sucursal_id: sucursalId, mesa_id: mesa.id, usuario_id: usuario.id, sesion_caja_id: sesionCaja.id,
      tipo: 'mesa', estado: 'pendiente_pago', total: 25,
    });
    pedidoId = pedido.id;
    await PagoQr.create({
      pedido_id: pedidoId, sucursal_id: sucursalId, order_id: `pedido_${pedidoId}_1`,
      estado: 'pendiente', estado_previo: 'pendiente', monto_neto: 25,
      expires_at: new Date(Date.now() - 60000),
    });
  });

  afterAll(async () => {
    await PagoQr.destroy({ where: { pedido_id: pedidoId } });
    await Pedido.destroy({ where: { id: pedidoId } });
  });

  it('revierte pagos QR pendientes ya vencidos', async () => {
    const { revertidos } = await expirarPagosQrVencidos();
    expect(revertidos).toBeGreaterThanOrEqual(1);

    const pagoQr = await PagoQr.findOne({ where: { pedido_id: pedidoId } });
    expect(pagoQr.estado).toBe('expirado');
  });
});
