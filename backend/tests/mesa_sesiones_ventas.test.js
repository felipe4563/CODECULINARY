const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const { Sucursal, Area, Mesa, MesaSesion, Rol, Usuario, Caja, SesionCaja, Pedido, PagoQr } = require('../src/models');
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

  it('crear() ya no abre una sesión de mesa por sí sola (apertura es 100% explícita)', async () => {
    await ventasService.crear({ mesa_id: mesaId, tipo: 'mesa', usuario_id: usuarioId, sesion_caja_id: sesionCajaId });
    const activa = await mesasService.obtenerSesionActiva(mesaId);
    expect(activa).toBeNull();
  });

  it('crear() rechaza abrir un segundo pedido en una mesa con sesión de autoservicio activa (abierta a mano)', async () => {
    await mesasService.abrirSesion(mesaId, sucursalId, 'staff');
    await expect(
      ventasService.crear({ mesa_id: mesaId, tipo: 'mesa', usuario_id: usuarioId, sesion_caja_id: sesionCajaId })
    ).rejects.toMatchObject({ status: 409 });
    await mesasService.cerrarSesion(mesaId);
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

  it('un pago QR vencido de STAFF vuelve a su estado_previo (comportamiento sin cambios)', async () => {
    const pedido = await Pedido.create({
      sucursal_id: sucursalId, mesa_id: mesaId, usuario_id: usuarioId, sesion_caja_id: sesionCajaId,
      tipo: 'mesa', origen: 'staff', estado: 'pendiente_pago', total: 22,
    });
    await PagoQr.create({
      pedido_id: pedido.id, sucursal_id: sucursalId, order_id: `pedido_${pedido.id}_1`,
      estado: 'pendiente', estado_previo: 'pendiente', monto_neto: 22,
      expires_at: new Date(Date.now() - 60000),
    });

    await ventasService.revertirPagosQrVencidos();

    const actualizado = await Pedido.findByPk(pedido.id);
    expect(actualizado.estado).toBe('pendiente');
  });
});

describe('mesasService.abrirSesion — dos toques concurrentes al botón de habilitar', () => {
  // Regresión: abrirSesion() era check-then-act sin transacción ni lock, así
  // que dos toques casi simultáneos al botón "Habilitar autoservicio" podían
  // pasar ambos el chequeo y dejar la mesa con dos sesiones activas.
  let sucursalId, areaId, mesaId, usuarioId, cajaId, sesionCajaId;

  beforeAll(async () => {
    const sucursal = await Sucursal.create({ nombre: 'Sucursal Concurrencia Test' });
    sucursalId = sucursal.id;
    const area = await Area.create({ nombre: 'Area Concurrencia Test', sucursal_id: sucursalId });
    areaId = area.id;
    const mesa = await Mesa.create({ area_id: areaId, nombre: 'Mesa Concurrencia Test' });
    mesaId = mesa.id;
    const rol = await Rol.findOne({ where: { nombre: 'Cajero' } });
    const hash = await bcrypt.hash('clave123', 10);
    const usuario = await Usuario.create({ rol_id: rol.id, nombre: 'Concurrencia Test', email: 'concurrencia-test@restaurante.com', contrasena: hash });
    usuarioId = usuario.id;
    const caja = await Caja.create({ sucursal_id: sucursalId, nombre: 'Caja Concurrencia Test' });
    cajaId = caja.id;
    const sesionCaja = await SesionCaja.create({ usuario_id: usuarioId, sucursal_id: sucursalId, caja_id: cajaId, monto_apertura: 0 });
    sesionCajaId = sesionCaja.id;
  });

  afterAll(async () => {
    await Pedido.destroy({ where: { mesa_id: mesaId } });
    await SesionCaja.destroy({ where: { id: sesionCajaId } });
    await Caja.destroy({ where: { id: cajaId } });
    await Usuario.destroy({ where: { id: usuarioId } });
    await MesaSesion.destroy({ where: { mesa_id: mesaId } });
    await Mesa.destroy({ where: { id: mesaId } });
    await Area.destroy({ where: { id: areaId } });
    await Sucursal.destroy({ where: { id: sucursalId } });
  });

  it('ambos toques devuelven la misma sesión y queda una única fila activa', async () => {
    const [primera, segunda] = await Promise.all([
      mesasService.abrirSesion(mesaId, sucursalId, 'staff'),
      mesasService.abrirSesion(mesaId, sucursalId, 'staff'),
    ]);

    expect(primera.id).toBe(segunda.id);

    const sesiones = await MesaSesion.findAll({ where: { mesa_id: mesaId, cerrada_en: null } });
    expect(sesiones).toHaveLength(1);
  });
});

describe('ventas.service — pago QR de autoservicio vencido', () => {
  // Regresión: _revertirPagoQr devolvía el pedido a estado_previo, que para
  // autoservicio es 'pendiente' — una cola de cocina REAL (listarCocina lee
  // estado IN ('pendiente','listo')). Un pago abandonado se convertía en un
  // ticket fantasma de comida que nadie pagó, y la sesión de mesa quedaba
  // abierta para siempre, bloqueando la mesa para todo pedido futuro.
  let sucursalId, areaId, mesaId, usuarioId, cajaId, sesionCajaId, sesionMesaId, pedidoId;

  beforeAll(async () => {
    const sucursal = await Sucursal.create({ nombre: 'Sucursal AutoRevert Test' });
    sucursalId = sucursal.id;
    const area = await Area.create({ nombre: 'Area AutoRevert Test', sucursal_id: sucursalId });
    areaId = area.id;
    const mesa = await Mesa.create({ area_id: areaId, nombre: 'Mesa AutoRevert Test', estado: 'ocupada' });
    mesaId = mesa.id;
    const rol = await Rol.findOne({ where: { nombre: 'Cajero' } });
    const hash = await bcrypt.hash('clave123', 10);
    const usuario = await Usuario.create({ rol_id: rol.id, nombre: 'AutoRevert Test', email: 'autorevert-test@restaurante.com', contrasena: hash });
    usuarioId = usuario.id;
    const caja = await Caja.create({ sucursal_id: sucursalId, nombre: 'Caja AutoRevert Test' });
    cajaId = caja.id;
    const sesionCaja = await SesionCaja.create({ usuario_id: usuarioId, sucursal_id: sucursalId, caja_id: cajaId, monto_apertura: 0 });
    sesionCajaId = sesionCaja.id;

    const sesionMesa = await mesasService.abrirSesion(mesaId, sucursalId, 'staff');
    sesionMesaId = sesionMesa.id;

    const pedido = await Pedido.create({
      sucursal_id: sucursalId, mesa_id: mesaId, mesa_sesion_id: sesionMesaId, usuario_id: usuarioId,
      sesion_caja_id: sesionCajaId, tipo: 'mesa', origen: 'autoservicio',
      estado: 'pendiente_pago', total: 40,
    });
    pedidoId = pedido.id;
    await PagoQr.create({
      pedido_id: pedidoId, sucursal_id: sucursalId, order_id: `pedido_${pedidoId}_1`,
      estado: 'pendiente', estado_previo: 'pendiente', monto_neto: 40,
      expires_at: new Date(Date.now() - 60000),
    });
  });

  afterAll(async () => {
    await PagoQr.destroy({ where: { pedido_id: pedidoId } });
    await Pedido.destroy({ where: { mesa_id: mesaId } });
    await SesionCaja.destroy({ where: { id: sesionCajaId } });
    await Caja.destroy({ where: { id: cajaId } });
    await Usuario.destroy({ where: { id: usuarioId } });
    await MesaSesion.destroy({ where: { mesa_id: mesaId } });
    await Mesa.destroy({ where: { id: mesaId } });
    await Area.destroy({ where: { id: areaId } });
    await Sucursal.destroy({ where: { id: sucursalId } });
  });

  it('al expirar, el pedido queda cancelado (no vuelve a la cola de cocina) y la mesa se libera, pero la sesión sigue activa', async () => {
    await ventasService.revertirPagosQrVencidos();

    const actualizado = await Pedido.findByPk(pedidoId);
    expect(actualizado.estado).toBe('cancelado');

    // La sesión NO se cierra sola: que un pago se abandone no significa que
    // la mesa se desocupó, el cliente puede seguir sentado e intentar de
    // nuevo. Solo el staff cierra la sesión a mano.
    const sesionActiva = await mesasService.obtenerSesionActiva(mesaId);
    expect(sesionActiva).not.toBeNull();
    expect(sesionActiva.id).toBe(sesionMesaId);

    const mesa = await Mesa.findByPk(mesaId);
    expect(mesa.estado).toBe('disponible');
  });
});
