const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../src/app');
const { Op } = require('sequelize');
const { Sucursal, Area, Mesa, MesaSesion, Rol, Usuario, Pedido, DetallePedido, PagoQr, Categoria, Producto, ProductoStockSucursal, Caja, SesionCaja, Cupon, Cliente } = require('../src/models');

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

  describe('cupón en el pedido de autoservicio', () => {
    // El código viaja tal cual a ventasService.crearCompleta, que ya sabe
    // validar/aplicar cupones (misma lógica que usa el cajero) — acá solo se
    // prueba que autoservicio lo deja pasar y que un código inválido corta
    // ANTES de llegar a CodePay (mismo límite de las pruebas de arriba: no
    // hay mock de CodePay en esta suite, así que el camino feliz de
    // "cupón válido + pago QR real" queda fuera de esta prueba).
    let sucursal, area, mesa, usuario, caja;

    beforeAll(async () => {
      const timestamp = Date.now();
      sucursal = await Sucursal.create({ nombre: `Sucursal Autoservicio Cupon Test ${timestamp}` });
      area = await Area.create({ nombre: `Area Autoservicio Cupon Test ${timestamp}`, sucursal_id: sucursal.id });
      mesa = await Mesa.create({ area_id: area.id, nombre: 'Mesa Cupon Test', codigo_qr: `test-qr-cupon-${timestamp}` });
      await MesaSesion.create({ mesa_id: mesa.id, sucursal_id: sucursal.id, abierta_por: 'staff' });

      const categoria = await Categoria.create({ nombre: `Categoria Autoservicio Cupon Test ${timestamp}` });
      const producto = await Producto.create({ categoria_id: categoria.id, nombre: `Producto Autoservicio Cupon Test ${timestamp}`, precio: 25, stock: 0 });
      await ProductoStockSucursal.create({ producto_id: producto.id, sucursal_id: sucursal.id, stock: 10 });

      const rol = await Rol.findOne({ where: { nombre: 'Cajero' } });
      const hash = await bcrypt.hash('clave123', 10);
      usuario = await Usuario.create({ rol_id: rol.id, nombre: `Autoservicio Cupon Test ${timestamp}`, email: `autoservicio-cupon-test-${timestamp}@restaurante.com`, contrasena: hash });

      caja = await Caja.create({ sucursal_id: sucursal.id, nombre: 'Caja Autoservicio Cupon Test' });
      await SesionCaja.create({ usuario_id: usuario.id, sucursal_id: sucursal.id, caja_id: caja.id, monto_apertura: 0 });

      mesa.productoId = producto.id;
      mesa.cupon = await Cupon.create({ codigo: `CUPONTEST${timestamp}`, tipo: 'fijo', valor: 5, usos_maximos: 10 });
    });

    afterAll(async () => {
      await Cupon.destroy({ where: { id: mesa.cupon.id } });
      // El pedido "sin cupon_codigo" sigue de largo hasta crearCompleta y
      // deja Pedido/DetallePedido/PagoQr reales — hay que limpiarlos antes
      // de borrar Usuario/Caja/Sucursal o la FK lo impide.
      const pedidosDeLaMesa = await Pedido.findAll({ where: { mesa_id: mesa.id }, attributes: ['id'] });
      const pedidoIds = pedidosDeLaMesa.map((p) => p.id);
      await PagoQr.destroy({ where: { pedido_id: { [Op.in]: pedidoIds } } });
      await DetallePedido.destroy({ where: { pedido_id: { [Op.in]: pedidoIds } } });
      await Pedido.destroy({ where: { mesa_id: mesa.id } });
      await SesionCaja.destroy({ where: { caja_id: caja.id } });
      await Caja.destroy({ where: { id: caja.id } });
      await Usuario.destroy({ where: { id: usuario.id } });
      await MesaSesion.destroy({ where: { mesa_id: mesa.id } });
      await Mesa.destroy({ where: { id: mesa.id } });
      await Area.destroy({ where: { id: area.id } });
      await Sucursal.destroy({ where: { id: sucursal.id } });
    });

    it('cupón inexistente → 400 con el mensaje de cupones.service, sin llegar a CodePay', async () => {
      const res = await request(app)
        .post(`/api/v1/autoservicio/mesa/${mesa.codigo_qr}/pedido`)
        .send({ items: [{ producto_id: mesa.productoId, cantidad: 1 }], cupon_codigo: 'NOEXISTE123' });

      expect(res.status).toBe(400);
      expect(res.body.mensaje).toMatch(/cupón/i);
    });

    it('sin cupon_codigo, el pedido sigue su curso normal (no lo exige)', async () => {
      const res = await request(app)
        .post(`/api/v1/autoservicio/mesa/${mesa.codigo_qr}/pedido`)
        .send({ items: [{ producto_id: mesa.productoId, cantidad: 1 }] });

      // Sin caja abierta específica de ESTA sucursal ya se cubre en otra
      // prueba — acá lo que importa es que la ausencia de cupon_codigo no
      // sea, por sí sola, motivo de rechazo (no debe dar 400 de validación).
      expect(res.status).not.toBe(400);
    });
  });

  describe('POST .../cupon/validar — previsualización de cupón antes de pagar', () => {
    let sucursal, area, mesa, cupon;

    beforeAll(async () => {
      const timestamp = Date.now();
      sucursal = await Sucursal.create({ nombre: `Sucursal Autoservicio ValidarCupon Test ${timestamp}` });
      area = await Area.create({ nombre: `Area Autoservicio ValidarCupon Test ${timestamp}`, sucursal_id: sucursal.id });
      mesa = await Mesa.create({ area_id: area.id, nombre: 'Mesa ValidarCupon Test', codigo_qr: `vc-${timestamp}` });
      await MesaSesion.create({ mesa_id: mesa.id, sucursal_id: sucursal.id, abierta_por: 'staff' });

      const categoria = await Categoria.create({ nombre: `Categoria Autoservicio ValidarCupon Test ${timestamp}` });
      const producto = await Producto.create({ categoria_id: categoria.id, nombre: `Producto Autoservicio ValidarCupon Test ${timestamp}`, precio: 40, stock: 0 });
      mesa.productoId = producto.id;

      cupon = await Cupon.create({ codigo: `VALCUPON${timestamp}`, tipo: 'fijo', valor: 5, usos_maximos: 10 });
    });

    afterAll(async () => {
      await Cupon.destroy({ where: { id: cupon.id } });
      await MesaSesion.destroy({ where: { mesa_id: mesa.id } });
      await Mesa.destroy({ where: { id: mesa.id } });
      await Area.destroy({ where: { id: area.id } });
      await Sucursal.destroy({ where: { id: sucursal.id } });
    });

    it('cupón válido → 200 con el descuento calculado con precios del servidor (ignora el precio que mande el cliente)', async () => {
      const res = await request(app)
        .post(`/api/v1/autoservicio/mesa/${mesa.codigo_qr}/cupon/validar`)
        .send({ codigo: cupon.codigo, items: [{ producto_id: mesa.productoId, cantidad: 1, precio: 999 }] });

      expect(res.status).toBe(200);
      expect(res.body.datos.codigo).toBe(cupon.codigo);
      expect(res.body.datos.descuento).toBe(5);
    });

    it('cupón inválido → 400 con el mensaje de cupones.service', async () => {
      const res = await request(app)
        .post(`/api/v1/autoservicio/mesa/${mesa.codigo_qr}/cupon/validar`)
        .send({ codigo: 'NOEXISTE123', items: [{ producto_id: mesa.productoId, cantidad: 1 }] });

      expect(res.status).toBe(400);
      expect(res.body.mensaje).toMatch(/cupón/i);
    });

    it('sin codigo en el body → 400 de validación, sin tocar el service', async () => {
      const res = await request(app)
        .post(`/api/v1/autoservicio/mesa/${mesa.codigo_qr}/cupon/validar`)
        .send({ items: [{ producto_id: mesa.productoId, cantidad: 1 }] });

      expect(res.status).toBe(400);
      expect(res.body.mensaje).toMatch(/codigo/i);
    });

    it('mesa sin sesión activa → 409, sin llegar a validar el cupón', async () => {
      const timestamp = Date.now();
      const mesaSinSesion = await Mesa.create({ area_id: area.id, nombre: 'Mesa Sin Sesion', codigo_qr: `ss-${timestamp}` });

      const res = await request(app)
        .post(`/api/v1/autoservicio/mesa/${mesaSinSesion.codigo_qr}/cupon/validar`)
        .send({ codigo: cupon.codigo, items: [] });

      expect(res.status).toBe(409);
      await Mesa.destroy({ where: { id: mesaSinSesion.id } });
    });
  });

  describe('numero_documento en el pedido — identificación opcional para sumar puntos', () => {
    // No se mockea personas.client: en este entorno de test PERSONAS_API_URL
    // no apunta a nada real, así que buscarPorDocumento falla (fetch la
    // rechaza) para cualquier CI que no exista ya como Cliente — eso es
    // justo lo que se quiere probar: la falla se traga en silencio y el
    // pedido sigue su curso sin cliente_id, nunca bloquea al cliente.
    let sucursal, area, mesa, usuario, caja, clienteExistente;

    beforeAll(async () => {
      const timestamp = Date.now();
      sucursal = await Sucursal.create({ nombre: `Sucursal Autoservicio Doc Test ${timestamp}` });
      area = await Area.create({ nombre: `Area Autoservicio Doc Test ${timestamp}`, sucursal_id: sucursal.id });
      mesa = await Mesa.create({ area_id: area.id, nombre: 'Mesa Doc Test', codigo_qr: `doc-${timestamp}` });
      await MesaSesion.create({ mesa_id: mesa.id, sucursal_id: sucursal.id, abierta_por: 'staff' });

      const categoria = await Categoria.create({ nombre: `Categoria Autoservicio Doc Test ${timestamp}` });
      const producto = await Producto.create({ categoria_id: categoria.id, nombre: `Producto Autoservicio Doc Test ${timestamp}`, precio: 15, stock: 0 });
      await ProductoStockSucursal.create({ producto_id: producto.id, sucursal_id: sucursal.id, stock: 10 });
      mesa.productoId = producto.id;

      const rol = await Rol.findOne({ where: { nombre: 'Cajero' } });
      const hash = await bcrypt.hash('clave123', 10);
      usuario = await Usuario.create({ rol_id: rol.id, nombre: `Autoservicio Doc Test ${timestamp}`, email: `autoservicio-doc-test-${timestamp}@restaurante.com`, contrasena: hash });

      caja = await Caja.create({ sucursal_id: sucursal.id, nombre: 'Caja Autoservicio Doc Test' });
      await SesionCaja.create({ usuario_id: usuario.id, sucursal_id: sucursal.id, caja_id: caja.id, monto_apertura: 0 });

      clienteExistente = await Cliente.create({ nombre: 'Cliente Autoservicio Doc Test', numero_documento: `DOC${timestamp}` });
    });

    afterAll(async () => {
      const pedidosDeLaMesa = await Pedido.findAll({ where: { mesa_id: mesa.id }, attributes: ['id'] });
      const pedidoIds = pedidosDeLaMesa.map((p) => p.id);
      await PagoQr.destroy({ where: { pedido_id: { [Op.in]: pedidoIds } } });
      await DetallePedido.destroy({ where: { pedido_id: { [Op.in]: pedidoIds } } });
      await Pedido.destroy({ where: { mesa_id: mesa.id } });
      await SesionCaja.destroy({ where: { caja_id: caja.id } });
      await Caja.destroy({ where: { id: caja.id } });
      await Usuario.destroy({ where: { id: usuario.id } });
      await Cliente.destroy({ where: { id: clienteExistente.id } });
      await MesaSesion.destroy({ where: { mesa_id: mesa.id } });
      await Mesa.destroy({ where: { id: mesa.id } });
      await Area.destroy({ where: { id: area.id } });
      await Sucursal.destroy({ where: { id: sucursal.id } });
    });

    it('CI de un cliente ya registrado → el pedido queda ligado a ese cliente_id', async () => {
      const res = await request(app)
        .post(`/api/v1/autoservicio/mesa/${mesa.codigo_qr}/pedido`)
        .send({ items: [{ producto_id: mesa.productoId, cantidad: 1 }], numero_documento: clienteExistente.numero_documento });

      expect(res.status).not.toBe(400);
      const pedido = await Pedido.findByPk(res.body.datos.pedido.id);
      expect(pedido.cliente_id).toBe(clienteExistente.id);
    });

    it('CI que no matchea ningún cliente ni la API de personas → el pedido sigue sin bloquear, sin cliente_id', async () => {
      const res = await request(app)
        .post(`/api/v1/autoservicio/mesa/${mesa.codigo_qr}/pedido`)
        .send({ items: [{ producto_id: mesa.productoId, cantidad: 1 }], numero_documento: '00000000-NOEXISTE' });

      expect(res.status).not.toBe(400);
      const pedido = await Pedido.findByPk(res.body.datos.pedido.id);
      expect(pedido.cliente_id).toBeNull();
    });

    it('sin numero_documento, el pedido sigue su curso normal (no lo exige)', async () => {
      const res = await request(app)
        .post(`/api/v1/autoservicio/mesa/${mesa.codigo_qr}/pedido`)
        .send({ items: [{ producto_id: mesa.productoId, cantidad: 1 }] });

      expect(res.status).not.toBe(400);
      const pedido = await Pedido.findByPk(res.body.datos.pedido.id);
      expect(pedido.cliente_id).toBeNull();
    });
  });
});
