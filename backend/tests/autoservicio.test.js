const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../src/app');
const { Sucursal, Area, Mesa, MesaSesion, Rol, Usuario, Pedido } = require('../src/models');

describe('Autoservicio API', () => {
  it('GET .../mesa/:codigo_qr con código inexistente → 404', async () => {
    const res = await request(app).get('/api/v1/autoservicio/mesa/no-existe-123');
    expect(res.status).toBe(404);
  });

  describe('con una mesa real', () => {
    let sucursal, area, mesa;

    beforeAll(async () => {
      sucursal = await Sucursal.create({ nombre: 'Sucursal Autoservicio Test' });
      area = await Area.create({ nombre: 'Area Autoservicio Test', sucursal_id: sucursal.id });
      mesa = await Mesa.create({ area_id: area.id, nombre: 'Mesa Autoservicio Test', codigo_qr: 'test-qr-001' });
    });

    afterAll(async () => {
      await MesaSesion.destroy({ where: { mesa_id: mesa.id } });
      await Mesa.destroy({ where: { id: mesa.id } });
      await Area.destroy({ where: { id: area.id } });
      await Sucursal.destroy({ where: { id: sucursal.id } });
    });

    it('mesa sin sesión activa → 409 al pedir el menú', async () => {
      const res = await request(app).get(`/api/v1/autoservicio/mesa/${mesa.codigo_qr}`);
      expect(res.status).toBe(409);
    });

    it('mesa con sesión activa → devuelve el menú', async () => {
      await MesaSesion.create({ mesa_id: mesa.id, sucursal_id: sucursal.id, abierta_por: 'staff' });
      const res = await request(app).get(`/api/v1/autoservicio/mesa/${mesa.codigo_qr}`);
      expect(res.status).toBe(200);
      expect(res.body.datos.mesa.id).toBe(mesa.id);
      expect(Array.isArray(res.body.datos.productos)).toBe(true);
    });

    it('crear pedido sin caja abierta en la sucursal → 409', async () => {
      const res = await request(app)
        .post(`/api/v1/autoservicio/mesa/${mesa.codigo_qr}/pedido`)
        .send({ items: [{ producto_id: 1, cantidad: 1 }] });
      expect(res.status).toBe(409);
    });

    it('crear pedido sin items → 400', async () => {
      const res = await request(app)
        .post(`/api/v1/autoservicio/mesa/${mesa.codigo_qr}/pedido`)
        .send({ items: [] });
      expect(res.status).toBe(400);
    });

    it('crear pedido con cantidad negativa → 400 (no llega a ventasService)', async () => {
      const res = await request(app)
        .post(`/api/v1/autoservicio/mesa/${mesa.codigo_qr}/pedido`)
        .send({ items: [{ producto_id: 1, cantidad: -30 }] });
      expect(res.status).toBe(400);
      expect(res.body.mensaje).toMatch(/Cantidad inválida/);
    });

    it('crear pedido con cantidad no entera → 400', async () => {
      const res = await request(app)
        .post(`/api/v1/autoservicio/mesa/${mesa.codigo_qr}/pedido`)
        .send({ items: [{ producto_id: 1, cantidad: 1.5 }] });
      expect(res.status).toBe(400);
    });

    it('crear pedido sin producto_id ni combo_id → 400', async () => {
      const res = await request(app)
        .post(`/api/v1/autoservicio/mesa/${mesa.codigo_qr}/pedido`)
        .send({ items: [{ cantidad: 1 }] });
      expect(res.status).toBe(400);
    });

    it('crear pedido con producto_id y combo_id a la vez → 400', async () => {
      const res = await request(app)
        .post(`/api/v1/autoservicio/mesa/${mesa.codigo_qr}/pedido`)
        .send({ items: [{ producto_id: 1, combo_id: 2, cantidad: 1 }] });
      expect(res.status).toBe(400);
    });

    it('crear pedido con producto_id no positivo → 400', async () => {
      const res = await request(app)
        .post(`/api/v1/autoservicio/mesa/${mesa.codigo_qr}/pedido`)
        .send({ items: [{ producto_id: 0, cantidad: 1 }] });
      expect(res.status).toBe(400);
    });

    it('crear pedido con más de 50 ítems → 400', async () => {
      const items = Array.from({ length: 51 }, () => ({ producto_id: 1, cantidad: 1 }));
      const res = await request(app)
        .post(`/api/v1/autoservicio/mesa/${mesa.codigo_qr}/pedido`)
        .send({ items });
      expect(res.status).toBe(400);
    });
  });

  describe('tope de pagos QR pendientes por sesión de mesa', () => {
    let sucursal, area, mesa, sesion, usuario, pedidos = [];

    beforeAll(async () => {
      sucursal = await Sucursal.create({ nombre: 'Sucursal Autoservicio Tope Test' });
      area = await Area.create({ nombre: 'Area Autoservicio Tope Test', sucursal_id: sucursal.id });
      mesa = await Mesa.create({ area_id: area.id, nombre: 'Mesa Tope Test', codigo_qr: 'test-qr-tope' });
      sesion = await MesaSesion.create({ mesa_id: mesa.id, sucursal_id: sucursal.id, abierta_por: 'staff' });

      const rol = await Rol.findOne({ where: { nombre: 'Cajero' } });
      const hash = await bcrypt.hash('clave123', 10);
      usuario = await Usuario.create({ rol_id: rol.id, nombre: 'Autoservicio Tope Test', email: 'autoservicio-tope-test@restaurante.com', contrasena: hash });

      // 3 pedidos con pago QR en curso creados directamente en la BD — no hace
      // falta el flujo completo de CodePay, el tope sólo cuenta filas.
      for (let i = 0; i < 3; i++) {
        pedidos.push(await Pedido.create({
          sucursal_id: sucursal.id, mesa_id: mesa.id, mesa_sesion_id: sesion.id,
          usuario_id: usuario.id, tipo: 'mesa', origen: 'autoservicio',
          estado: 'pendiente_pago', total: 10,
        }));
      }
    });

    afterAll(async () => {
      await Pedido.destroy({ where: { mesa_id: mesa.id } });
      await Usuario.destroy({ where: { id: usuario.id } });
      await MesaSesion.destroy({ where: { mesa_id: mesa.id } });
      await Mesa.destroy({ where: { id: mesa.id } });
      await Area.destroy({ where: { id: area.id } });
      await Sucursal.destroy({ where: { id: sucursal.id } });
    });

    it('un 4º pedido con 3 pagos pendientes en la misma sesión → 429', async () => {
      const res = await request(app)
        .post(`/api/v1/autoservicio/mesa/${mesa.codigo_qr}/pedido`)
        .send({ items: [{ producto_id: 1, cantidad: 1 }] });
      expect(res.status).toBe(429);
    });
  });

  describe('aislamiento entre mesas al consultar estado de pedido', () => {
    // Regresión: consultarEstadoPedido debía verificar que el pedido_id
    // pertenece a la sesión de ESTA mesa antes de llamar a
    // ventasService.consultarEstadoPagoQr — esa función no solo lee, puede
    // finalizar o revertir el pago (efectos reales: stock, libro caja,
    // sockets, CodePay) para el pedido_id que se le pase, sin importar si
    // después el 404 se devuelve igual. Antes del fix, alguien con el QR de
    // su propia mesa podía probar pedido_id de mesas/sucursales ajenas y
    // disparar esos efectos secundarios antes de recibir el 404.
    let sucursal, area, mesaPropia, mesaAjena, sesionAjena, usuario, pedidoAjeno;

    beforeAll(async () => {
      sucursal = await Sucursal.create({ nombre: 'Sucursal Autoservicio Aislamiento Test' });
      area = await Area.create({ nombre: 'Area Autoservicio Aislamiento Test', sucursal_id: sucursal.id });
      mesaPropia = await Mesa.create({ area_id: area.id, nombre: 'Mesa Propia Test', codigo_qr: 'test-qr-propia' });
      mesaAjena = await Mesa.create({ area_id: area.id, nombre: 'Mesa Ajena Test', codigo_qr: 'test-qr-ajena' });

      await MesaSesion.create({ mesa_id: mesaPropia.id, sucursal_id: sucursal.id, abierta_por: 'staff' });
      sesionAjena = await MesaSesion.create({ mesa_id: mesaAjena.id, sucursal_id: sucursal.id, abierta_por: 'staff' });

      const rol = await Rol.findOne({ where: { nombre: 'Cajero' } });
      const hash = await bcrypt.hash('clave123', 10);
      usuario = await Usuario.create({ rol_id: rol.id, nombre: 'Autoservicio Aislamiento Test', email: 'autoservicio-aislamiento-test@restaurante.com', contrasena: hash });

      pedidoAjeno = await Pedido.create({
        sucursal_id: sucursal.id,
        mesa_id: mesaAjena.id,
        mesa_sesion_id: sesionAjena.id,
        usuario_id: usuario.id,
        tipo: 'mesa',
        origen: 'autoservicio',
        estado: 'pendiente_pago',
        total: 10,
      });
    });

    afterAll(async () => {
      await Pedido.destroy({ where: { id: pedidoAjeno.id } });
      await Usuario.destroy({ where: { id: usuario.id } });
      await MesaSesion.destroy({ where: { mesa_id: [mesaPropia.id, mesaAjena.id] } });
      await Mesa.destroy({ where: { id: [mesaPropia.id, mesaAjena.id] } });
      await Area.destroy({ where: { id: area.id } });
      await Sucursal.destroy({ where: { id: sucursal.id } });
    });

    it('consultar el estado de un pedido de OTRA mesa con el código QR propio → 404, sin tocar el pedido ajeno', async () => {
      const res = await request(app)
        .get(`/api/v1/autoservicio/mesa/${mesaPropia.codigo_qr}/pedido/${pedidoAjeno.id}/estado`);
      expect(res.status).toBe(404);

      // El pedido ajeno no debe haber sido tocado — si consultarEstadoPagoQr
      // se hubiera llamado antes del chequeo de pertenencia, podría haber
      // intentado finalizarlo/revertirlo contra CodePay.
      const sinTocar = await Pedido.findByPk(pedidoAjeno.id);
      expect(sinTocar.estado).toBe('pendiente_pago');
    });
  });
});
