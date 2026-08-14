const bcrypt = require('bcryptjs');
const { Sucursal, Area, Mesa, Rol, Usuario, Caja, SesionCaja, Pedido, PagoQr, LibroCaja } = require('../src/models');
const ventasService = require('../src/modules/ventas/ventas.service');

// Regresión: un pago QR tiene hasta 30 minutos para confirmarse. Si el cajero
// cierra y arquea su turno dentro de esa ventana, el asiento del pago tardío
// caía igual en pedido.sesion_caja_id — la sesión ya cerrada y conciliada —,
// corrompiendo sus números después del arqueo. Aplica tanto a autoservicio
// como al flujo QR de staff.
describe('confirmación tardía de pago QR con la sesión de caja ya cerrada', () => {
  let sucursalId, areaId, mesaId, usuarioId, cajaId;
  let sesionCerradaId, sesionAbiertaId, pedidoId, orderId;

  beforeAll(async () => {
    const sucursal = await Sucursal.create({ nombre: 'Sucursal CajaCerrada Test' });
    sucursalId = sucursal.id;
    const area = await Area.create({ nombre: 'Area CajaCerrada Test', sucursal_id: sucursalId });
    areaId = area.id;
    const mesa = await Mesa.create({ area_id: areaId, nombre: 'Mesa CajaCerrada Test' });
    mesaId = mesa.id;
    const rol = await Rol.findOne({ where: { nombre: 'Cajero' } });
    const hash = await bcrypt.hash('clave123', 10);
    const usuario = await Usuario.create({ rol_id: rol.id, nombre: 'CajaCerrada Test', email: 'cajacerrada-test@restaurante.com', contrasena: hash });
    usuarioId = usuario.id;
    const caja = await Caja.create({ sucursal_id: sucursalId, nombre: 'Caja CajaCerrada Test' });
    cajaId = caja.id;

    const cerrada = await SesionCaja.create({
      usuario_id: usuarioId, sucursal_id: sucursalId, caja_id: cajaId,
      monto_apertura: 0, estado: 'cerrada', cerrado_en: new Date(),
    });
    sesionCerradaId = cerrada.id;
    const abierta = await SesionCaja.create({
      usuario_id: usuarioId, sucursal_id: sucursalId, caja_id: cajaId,
      monto_apertura: 0, estado: 'abierta',
    });
    sesionAbiertaId = abierta.id;

    const pedido = await Pedido.create({
      sucursal_id: sucursalId, mesa_id: mesaId, usuario_id: usuarioId,
      sesion_caja_id: sesionCerradaId, tipo: 'mesa', origen: 'staff',
      estado: 'pendiente_pago', total: 50, metodo_pago: 'qr',
    });
    pedidoId = pedido.id;
    orderId = `pedido_${pedidoId}_1`;
    await PagoQr.create({
      pedido_id: pedidoId, sucursal_id: sucursalId, order_id: orderId,
      estado: 'pendiente', estado_previo: 'pendiente', monto_neto: 50,
      expires_at: new Date(Date.now() + 60000),
    });
  });

  afterAll(async () => {
    await LibroCaja.destroy({ where: { sesion_caja_id: [sesionCerradaId, sesionAbiertaId] } });
    await PagoQr.destroy({ where: { pedido_id: pedidoId } });
    await Pedido.destroy({ where: { mesa_id: mesaId } });
    await SesionCaja.destroy({ where: { id: [sesionCerradaId, sesionAbiertaId] } });
    await Caja.destroy({ where: { id: cajaId } });
    await Usuario.destroy({ where: { id: usuarioId } });
    await Mesa.destroy({ where: { id: mesaId } });
    await Area.destroy({ where: { id: areaId } });
    await Sucursal.destroy({ where: { id: sucursalId } });
  });

  it('el asiento va a la sesión de caja abierta, no a la ya arqueada', async () => {
    await ventasService.procesarWebhookPagoQr({ event: 'payment.completed', order_id: orderId });

    const pedido = await Pedido.findByPk(pedidoId);
    expect(pedido.estado).toBe('completado');
    // pedido.sesion_caja_id NO se toca: reportes/historial siguen viendo el
    // turno original en el que se originó la orden.
    expect(pedido.sesion_caja_id).toBe(sesionCerradaId);

    const asiento = await LibroCaja.findOne({ where: { referencia_id: pedidoId, tipo: 'ingreso' } });
    expect(asiento).not.toBeNull();
    expect(asiento.sesion_caja_id).toBe(sesionAbiertaId);

    const cerrada = await SesionCaja.findByPk(sesionCerradaId);
    expect(parseFloat(cerrada.total_ventas)).toBe(0);
    const abierta = await SesionCaja.findByPk(sesionAbiertaId);
    expect(parseFloat(abierta.total_ventas)).toBe(50);
  });
});
