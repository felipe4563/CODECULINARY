const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const { Sucursal, Area, Mesa, Rol, Usuario, Caja, SesionCaja, Pedido, PagoQr } = require('../src/models');
const mesasService = require('../src/modules/mesas/mesas.service');
const ventasService = require('../src/modules/ventas/ventas.service');

describe('ventas.service — sesión de mesa integrada', () => {
  let sucursalId, areaId, mesaId, usuarioId, cajaId, sesionCajaId;

  beforeAll(async () => {
    const sucursal = await Sucursal.create({ nombre: 'Sucursal VentasSesion Test' });
    sucursalId = sucursal.id;
    const area = await Area.create({ nombre: 'Area VentasSesion Test', sucursal_id: sucursalId });
    areaId = area.id;
    const mesa = await Mesa.create({ area_id: area.id, nombre: 'Mesa VentasSesion Test' });
    mesaId = mesa.id;
    const rol = await Rol.findOne({ where: { nombre: 'Cajero' } });
    const hash = await bcrypt.hash('clave123', 10);
    const usuario = await Usuario.create({ rol_id: rol.id, nombre: 'VentasSesion Test', email: 'ventassesion-test@restaurante.com', contrasena: hash });
    usuarioId = usuario.id;
    const caja = await Caja.create({ sucursal_id: sucursalId, nombre: 'Caja VentasSesion Test' });
    cajaId = caja.id;
    const sesionCaja = await SesionCaja.create({ usuario_id: usuarioId, sucursal_id: sucursalId, caja_id: caja.id, monto_apertura: 0 });
    sesionCajaId = sesionCaja.id;
  });

  afterAll(async () => {
    // El PagoQr del tercer test referencia el pedido por FK sin ON DELETE
    // CASCADE (ver database/migrations) — hay que borrarlo antes que el
    // Pedido o la limpieza falla con una violación de integridad referencial.
    // Lo mismo pasa con Area/Caja frente a Sucursal: el brief original no las
    // limpiaba y el afterAll fallaba por FK al borrar Sucursal al final.
    const pedidosDeLaMesa = await Pedido.findAll({ where: { mesa_id: mesaId }, attributes: ['id'] });
    await PagoQr.destroy({ where: { pedido_id: { [Op.in]: pedidosDeLaMesa.map((p) => p.id) } } });
    await Pedido.destroy({ where: { mesa_id: mesaId } });
    await SesionCaja.destroy({ where: { id: sesionCajaId } });
    await Caja.destroy({ where: { id: cajaId } });
    await Usuario.destroy({ where: { id: usuarioId } });
    await Mesa.destroy({ where: { id: mesaId } });
    await Area.destroy({ where: { id: areaId } });
    await Sucursal.destroy({ where: { id: sucursalId } });
  });

  it('crear() abre una sesión de mesa junto con el pedido', async () => {
    await ventasService.crear({ mesa_id: mesaId, tipo: 'mesa', usuario_id: usuarioId, sesion_caja_id: sesionCajaId });
    const activa = await mesasService.obtenerSesionActiva(mesaId);
    expect(activa).not.toBeNull();
  });

  it('crear() rechaza abrir un segundo pedido en una mesa con sesión activa', async () => {
    await expect(
      ventasService.crear({ mesa_id: mesaId, tipo: 'mesa', usuario_id: usuarioId, sesion_caja_id: sesionCajaId })
    ).rejects.toMatchObject({ status: 409 });
  });

  it('revertirPagosQrVencidos revierte un pago QR pendiente ya vencido', async () => {
    const pedido = await Pedido.create({
      sucursal_id: sucursalId, mesa_id: mesaId, usuario_id: usuarioId, sesion_caja_id: sesionCajaId,
      tipo: 'mesa', estado: 'pendiente_pago', total: 15,
    });
    await PagoQr.create({
      pedido_id: pedido.id, sucursal_id: sucursalId, order_id: `pedido_${pedido.id}_1`,
      estado: 'pendiente', estado_previo: 'pendiente', monto_neto: 15,
      expires_at: new Date(Date.now() - 60000),
    });

    const { revertidos } = await ventasService.revertirPagosQrVencidos();
    expect(revertidos).toBeGreaterThanOrEqual(1);

    const pagoQr = await PagoQr.findOne({ where: { pedido_id: pedido.id } });
    expect(pagoQr.estado).toBe('expirado');
    const actualizado = await Pedido.findByPk(pedido.id);
    expect(actualizado.estado).not.toBe('pendiente_pago');
  });
});
