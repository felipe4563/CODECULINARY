// backend/tests/estado_cocina.test.js
jest.mock('../src/integrations/codepay/codepay.client', () => ({
  generarQr: jest.fn(),
  consultarEstado: jest.fn(),
  verificarFirmaWebhook: jest.fn(),
}));

const request = require('supertest');
const app = require('../src/app');
const bcrypt = require('bcryptjs');
const {
  Sucursal, Categoria, Producto, ProductoStockSucursal, Usuario, Rol,
  Caja, SesionCaja, Pedido, LibroCaja, Configuracion,
} = require('../src/models');

describe('estado_cocina — independiente del cobro', () => {
  let sucursalId, usuarioId, cajaId, sesionId, token, productoId, configFlujoOriginal;

  beforeAll(async () => {
    configFlujoOriginal = await Configuracion.findOne({ where: { clave: 'flujo_cocina' } });

    const sucursal = await Sucursal.create({ nombre: 'Sucursal Estado Cocina Test' });
    sucursalId = sucursal.id;
    const rol = await Rol.findOne({ where: { nombre: 'Cajero' } });
    const hash = await bcrypt.hash('clave123', 10);
    const usuario = await Usuario.create({ rol_id: rol.id, nombre: 'Estado Cocina Test', email: 'estado-cocina-test@restaurante.com', contrasena: hash });
    usuarioId = usuario.id;
    await usuario.addSucursal(sucursal);
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'estado-cocina-test@restaurante.com', contrasena: 'clave123' });
    token = login.body.datos.token;

    const caja = await Caja.create({ sucursal_id: sucursalId, nombre: 'Caja Estado Cocina Test' });
    cajaId = caja.id;
    const sesion = await SesionCaja.create({ usuario_id: usuarioId, sucursal_id: sucursalId, caja_id: cajaId, monto_apertura: 0 });
    sesionId = sesion.id;

    const categoria = await Categoria.create({ nombre: 'Categoria Estado Cocina Test' });
    const producto = await Producto.create({ categoria_id: categoria.id, nombre: 'Producto Estado Cocina Test', precio: 10, stock: 0 });
    productoId = producto.id;
    await ProductoStockSucursal.create({ producto_id: productoId, sucursal_id: sucursalId, stock: 20 });
  });

  afterAll(async () => {
    await Pedido.destroy({ where: { usuario_id: usuarioId } });
    await LibroCaja.destroy({ where: { usuario_id: usuarioId } });
    await SesionCaja.destroy({ where: { id: sesionId } });
    await Caja.destroy({ where: { id: cajaId } });
    await ProductoStockSucursal.destroy({ where: { producto_id: productoId } });
    await Producto.destroy({ where: { id: productoId } });
    await Usuario.destroy({ where: { id: usuarioId } });
    await Sucursal.destroy({ where: { id: sucursalId } });
    if (configFlujoOriginal) await Configuracion.upsert({ clave: 'flujo_cocina', valor: configFlujoOriginal.valor });
    else await Configuracion.destroy({ where: { clave: 'flujo_cocina' } });
  });

  it("crearCompleta con metodo_pago 'efectivo' y flujo_cocina 'digital' → estado_cocina 'pendiente' (el bug original)", async () => {
    await Configuracion.upsert({ clave: 'flujo_cocina', valor: 'digital' });
    const res = await request(app)
      .post('/api/v1/ventas/completa')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'llevar', items: [{ producto_id: productoId, cantidad: 1 }],
        metodo_pago: 'efectivo', monto_recibido: 10, sesion_caja_id: sesionId,
      });
    expect(res.status).toBe(201);
    expect(res.body.datos.estado).toBe('completado');
    expect(res.body.datos.estado_cocina).toBe('pendiente');
  });

  it("crearCompleta con flujo_cocina 'fisico' → estado_cocina queda NULL", async () => {
    await Configuracion.upsert({ clave: 'flujo_cocina', valor: 'fisico' });
    const res = await request(app)
      .post('/api/v1/ventas/completa')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'llevar', items: [{ producto_id: productoId, cantidad: 1 }],
        metodo_pago: 'efectivo', monto_recibido: 10, sesion_caja_id: sesionId,
      });
    expect(res.status).toBe(201);
    expect(res.body.datos.estado_cocina).toBeNull();
  });

  it("GET /ventas/cocina incluye un pedido completado (efectivo) con estado_cocina pendiente", async () => {
    await Configuracion.upsert({ clave: 'flujo_cocina', valor: 'digital' });
    const creado = await request(app)
      .post('/api/v1/ventas/completa')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'llevar', items: [{ producto_id: productoId, cantidad: 1 }],
        metodo_pago: 'efectivo', monto_recibido: 10, sesion_caja_id: sesionId,
      });
    expect(creado.body.datos.estado).toBe('completado');

    const res = await request(app)
      .get('/api/v1/ventas/cocina')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const ids = res.body.datos.map((p) => p.id);
    expect(ids).toContain(creado.body.datos.id);
  });

  it("GET /ventas/cocina NO incluye un pedido con flujo_cocina 'fisico' (estado_cocina NULL)", async () => {
    await Configuracion.upsert({ clave: 'flujo_cocina', valor: 'fisico' });
    const creado = await request(app)
      .post('/api/v1/ventas/completa')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'llevar', items: [{ producto_id: productoId, cantidad: 1 }],
        metodo_pago: 'efectivo', monto_recibido: 10, sesion_caja_id: sesionId,
      });

    const res = await request(app)
      .get('/api/v1/ventas/cocina')
      .set('Authorization', `Bearer ${token}`);
    const ids = res.body.datos.map((p) => p.id);
    expect(ids).not.toContain(creado.body.datos.id);
  });

  it("PATCH /ventas/:id/listo actualiza estado_cocina sin tocar estado", async () => {
    await Configuracion.upsert({ clave: 'flujo_cocina', valor: 'digital' });
    const creado = await request(app)
      .post('/api/v1/ventas/completa')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'llevar', items: [{ producto_id: productoId, cantidad: 1 }],
        metodo_pago: 'efectivo', monto_recibido: 10, sesion_caja_id: sesionId,
      });
    const pedidoId = creado.body.datos.id;

    const res = await request(app)
      .patch(`/api/v1/ventas/${pedidoId}/listo`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.datos.estado_cocina).toBe('listo');
    expect(res.body.datos.estado).toBe('completado'); // sin cambios — el cobro ya estaba hecho
  });

  it("PATCH /ventas/:id/listo sobre un pedido en modo fisico (estado_cocina NULL) → 409", async () => {
    await Configuracion.upsert({ clave: 'flujo_cocina', valor: 'fisico' });
    const creado = await request(app)
      .post('/api/v1/ventas/completa')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'llevar', items: [{ producto_id: productoId, cantidad: 1 }],
        metodo_pago: 'efectivo', monto_recibido: 10, sesion_caja_id: sesionId,
      });
    const pedidoId = creado.body.datos.id;

    const res = await request(app)
      .patch(`/api/v1/ventas/${pedidoId}/listo`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(409);
  });

  it("PATCH /ventas/:id/listo dos veces seguidas → la segunda da 409 (ya estaba listo)", async () => {
    await Configuracion.upsert({ clave: 'flujo_cocina', valor: 'digital' });
    const creado = await request(app)
      .post('/api/v1/ventas/completa')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'llevar', items: [{ producto_id: productoId, cantidad: 1 }],
        metodo_pago: 'efectivo', monto_recibido: 10, sesion_caja_id: sesionId,
      });
    const pedidoId = creado.body.datos.id;

    const primera = await request(app)
      .patch(`/api/v1/ventas/${pedidoId}/listo`)
      .set('Authorization', `Bearer ${token}`);
    expect(primera.status).toBe(200);

    const segunda = await request(app)
      .patch(`/api/v1/ventas/${pedidoId}/listo`)
      .set('Authorization', `Bearer ${token}`);
    expect(segunda.status).toBe(409);
  });
});
