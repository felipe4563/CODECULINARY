const { idSucursalPrincipal } = require('./helpers/sucursalPrincipal');
jest.mock('../src/integrations/codepay/codepay.client', () => ({
  generarQr: jest.fn(),
  consultarEstado: jest.fn(),
  verificarFirmaWebhook: jest.fn(),
}));

const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../src/app');
const codepayClientMock = require('../src/integrations/codepay/codepay.client');
const { Sucursal, Categoria, Producto, ProductoStockSucursal, Usuario, Rol, SesionCaja, Pedido, LibroCaja, Caja, PagoQr, Configuracion } = require('../src/models');
const configuracionService = require('../src/modules/configuracion/configuracion.service');

// Cobro QR del POS con el QR propio del negocio (migración 052).
describe('Ventas — cobro con QR propio (verificación manual)', () => {
  let sucursalId, usuarioId, cajaId, sesionId, productoId, categoriaId, token;
  let configOriginal;

  async function setModo(modo, imagen = '/uploads/qr-test.png') {
    await Configuracion.upsert({ clave: 'qr_pos_modo', valor: modo });
    await Configuracion.upsert({ clave: 'qr_pago_imagen', valor: imagen });
  }

  function venta(extra = {}) {
    return request(app)
      .post('/api/v1/ventas/completa')
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'llevar', metodo_pago: 'qr', sesion_caja_id: sesionId, items: [{ producto_id: productoId, cantidad: 2 }], ...extra });
  }

  beforeAll(async () => {
    const filas = await Configuracion.findAll({ where: { clave: ['qr_pos_modo', 'qr_pago_imagen'] } });
    configOriginal = filas.map((f) => ({ clave: f.clave, valor: f.valor }));

    const sucursal = await Sucursal.create({ nombre: 'Sucursal QrPropio Test' });
    sucursalId = sucursal.id;
    const categoria = await Categoria.create({ sucursal_id: await idSucursalPrincipal(), nombre: 'Categoria QrPropio Test' });
    categoriaId = categoria.id;
    const producto = await Producto.create({ categoria_id: categoriaId, nombre: 'Producto QrPropio Test', precio: 5, stock: 0 });
    productoId = producto.id;
    await ProductoStockSucursal.create({ producto_id: productoId, sucursal_id: sucursalId, stock: 20 });

    const rol = await Rol.findOne({ where: { nombre: 'Cajero' } });
    const hash = await bcrypt.hash('clave123', 10);
    const usuario = await Usuario.create({ rol_id: rol.id, nombre: 'QrPropio Test', email: 'qrpropio-test@restaurante.com', contrasena: hash });
    usuarioId = usuario.id;
    await usuario.addSucursal(sucursal);

    const login = await request(app).post('/api/v1/auth/login').send({ email: 'qrpropio-test@restaurante.com', contrasena: 'clave123' });
    token = login.body.datos.token;

    const caja = await Caja.create({ sucursal_id: sucursalId, nombre: 'Caja QrPropio Test' });
    cajaId = caja.id;
    const sesion = await SesionCaja.create({ usuario_id: usuarioId, sucursal_id: sucursalId, caja_id: cajaId, monto_apertura: 0 });
    sesionId = sesion.id;
  });

  afterEach(() => { jest.clearAllMocks(); });

  afterAll(async () => {
    for (const { clave, valor } of configOriginal) await Configuracion.upsert({ clave, valor });
    await PagoQr.destroy({ where: { sucursal_id: sucursalId } });
    await LibroCaja.destroy({ where: { usuario_id: usuarioId } });
    await Pedido.destroy({ where: { usuario_id: usuarioId } });
    await SesionCaja.destroy({ where: { id: sesionId } });
    await Caja.destroy({ where: { id: cajaId } });
    await ProductoStockSucursal.destroy({ where: { producto_id: productoId } });
    await Producto.destroy({ where: { id: productoId } });
    await Categoria.destroy({ where: { id: categoriaId } });
    await Usuario.destroy({ where: { id: usuarioId } });
    await Sucursal.destroy({ where: { id: sucursalId } });
  });

  it('modo manual: la venta QR confirmada se completa directo, sin CodePay, y registra quién confirmó', async () => {
    await setModo('manual');
    const res = await venta({ qr_confirmado: true });

    expect(res.status).toBe(201);
    expect(res.body.datos.pago_qr).toBeUndefined();
    expect(res.body.datos.estado).toBe('completado');
    expect(codepayClientMock.generarQr).not.toHaveBeenCalled();

    const pedido = await Pedido.findByPk(res.body.datos.id);
    expect(pedido.metodo_pago).toBe('qr');
    expect(pedido.qr_tipo).toBe('manual');
    expect(pedido.qr_confirmado_por).toBe(usuarioId);
    expect(parseFloat(pedido.cambio)).toBe(0);

    const asiento = await LibroCaja.findOne({ where: { referencia_id: pedido.id } });
    expect(asiento.metodo_pago).toBe('qr');
    expect(parseFloat(asiento.monto)).toBe(10);
  });

  it('modo manual: sin qr_confirmado (POS con config vieja) → 409 y no crea el pedido', async () => {
    await setModo('manual');
    const antes = await Pedido.count({ where: { usuario_id: usuarioId } });
    const res = await venta();

    expect(res.status).toBe(409);
    expect(await Pedido.count({ where: { usuario_id: usuarioId } })).toBe(antes);
  });

  it('modo manual: cobrar un pedido abierto con QR confirmado lo completa directo', async () => {
    await setModo('manual');
    const creado = await request(app)
      .post('/api/v1/ventas')
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'llevar', sesion_caja_id: sesionId });
    expect(creado.status).toBe(201);
    const pedidoId = creado.body.datos.id;
    await request(app)
      .post(`/api/v1/ventas/${pedidoId}/items`)
      .set('Authorization', `Bearer ${token}`)
      .send({ producto_id: productoId, cantidad: 1 });

    const sinConfirmar = await request(app)
      .post(`/api/v1/ventas/${pedidoId}/cobrar`)
      .set('Authorization', `Bearer ${token}`)
      .send({ metodo_pago: 'qr', monto_recibido: 5 });
    expect(sinConfirmar.status).toBe(409);

    const res = await request(app)
      .post(`/api/v1/ventas/${pedidoId}/cobrar`)
      .set('Authorization', `Bearer ${token}`)
      .send({ metodo_pago: 'qr', monto_recibido: 5, qr_confirmado: true });

    expect(res.status).toBe(200);
    expect(res.body.datos.estado).toBe('completado');
    expect(codepayClientMock.generarQr).not.toHaveBeenCalled();
    const pedido = await Pedido.findByPk(pedidoId);
    expect(pedido.qr_tipo).toBe('manual');
    expect(pedido.qr_confirmado_por).toBe(usuarioId);
  });

  it('modo codepay: sigue generando el QR de CodePay y marca qr_tipo=codepay', async () => {
    await setModo('codepay');
    codepayClientMock.generarQr.mockResolvedValue({
      qr_code: 'data:image/png;base64,abc', tx_id: 'tx_qrpropio_1', amount: 10.35, net_amount: 10, commission_amount: 0.35,
    });
    const res = await venta({ qr_confirmado: true });

    expect(res.status).toBe(201);
    expect(res.body.datos.pago_qr.tx_id).toBe('tx_qrpropio_1');
    expect(res.body.datos.pedido.estado).toBe('pendiente_pago');
    const pedido = await Pedido.findByPk(res.body.datos.pedido.id);
    expect(pedido.qr_tipo).toBe('codepay');
    expect(pedido.qr_confirmado_por).toBeNull();
  });

  it('la configuración no deja activar el modo manual sin imagen del QR', async () => {
    await setModo('codepay', '');
    await expect(configuracionService.actualizar({ qr_pos_modo: 'manual' })).rejects.toMatchObject({ status: 400 });
    await expect(configuracionService.actualizar({ qr_pos_modo: 'otro' })).rejects.toMatchObject({ status: 400 });
  });

  it('la config pública expone el modo y la imagen del QR para el POS', async () => {
    await setModo('manual', '/uploads/qr-publico.png');
    const res = await request(app).get('/api/v1/configuracion/publica');
    expect(res.status).toBe(200);
    expect(res.body.datos.qr_pos_modo).toBe('manual');
    expect(res.body.datos.qr_pago_imagen).toBe('/uploads/qr-publico.png');
  });
});
