jest.mock('../src/socket', () => ({ emitir: jest.fn(), init: jest.fn(), estadoAgentes: jest.fn() }));
const { emitir } = require('../src/socket');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../src/app');
const {
  Sucursal, Area, Mesa, Categoria, Producto, ProductoStockSucursal,
  Usuario, Rol, Caja, SesionCaja, Pedido, RegistroInventario, LibroCaja, Configuracion,
} = require('../src/models');

describe('_emitirImpresion — cocina_pantalla_dedicada viaja en el payload', () => {
  let sucursal, usuario, token, sesionCaja, caja, producto, mesa;
  let configFlujoOriginal, configPantallaOriginal;

  beforeAll(async () => {
    const timestamp = Date.now();
    sucursal = await Sucursal.create({ nombre: `Sucursal Impresion Ticket Test ${timestamp}` });
    const area = await Area.create({ nombre: `Area Impresion Ticket Test ${timestamp}`, sucursal_id: sucursal.id });
    mesa = await Mesa.create({ area_id: area.id, nombre: 'Mesa Impresion Ticket Test' });

    const categoria = await Categoria.create({ nombre: `Categoria Impresion Ticket Test ${timestamp}` });
    producto = await Producto.create({ categoria_id: categoria.id, nombre: `Producto Impresion Ticket Test ${timestamp}`, precio: 10, stock: 0 });
    await ProductoStockSucursal.create({ producto_id: producto.id, sucursal_id: sucursal.id, stock: 5 });

    const rol = await Rol.findOne({ where: { nombre: 'Cajero' } });
    const hash = await bcrypt.hash('clave123', 10);
    usuario = await Usuario.create({ rol_id: rol.id, nombre: `Impresion Ticket Test ${timestamp}`, email: `impresion-ticket-test-${timestamp}@restaurante.com`, contrasena: hash });
    await usuario.addSucursal(sucursal);

    const login = await request(app).post('/api/v1/auth/login').send({ email: usuario.email, contrasena: 'clave123' });
    token = login.body.datos.token;

    caja = await Caja.create({ sucursal_id: sucursal.id, nombre: 'Caja Impresion Ticket Test', modo_impresion: 'bluetooth' });
    sesionCaja = await SesionCaja.create({ usuario_id: usuario.id, sucursal_id: sucursal.id, caja_id: caja.id, monto_apertura: 0 });

    configFlujoOriginal = await Configuracion.findOne({ where: { clave: 'flujo_cocina' } });
    configPantallaOriginal = await Configuracion.findOne({ where: { clave: 'cocina_pantalla_dedicada' } });
    await Configuracion.upsert({ clave: 'flujo_cocina', valor: 'fisico' });
    await Configuracion.upsert({ clave: 'cocina_pantalla_dedicada', valor: 'true' });
  });

  afterAll(async () => {
    if (configFlujoOriginal) await Configuracion.upsert({ clave: 'flujo_cocina', valor: configFlujoOriginal.valor });
    else await Configuracion.destroy({ where: { clave: 'flujo_cocina' } });
    if (configPantallaOriginal) await Configuracion.upsert({ clave: 'cocina_pantalla_dedicada', valor: configPantallaOriginal.valor });
    else await Configuracion.destroy({ where: { clave: 'cocina_pantalla_dedicada' } });

    await Pedido.destroy({ where: { usuario_id: usuario.id } });
    await RegistroInventario.destroy({ where: { usuario_id: usuario.id } });
    await LibroCaja.destroy({ where: { usuario_id: usuario.id } });
    await SesionCaja.destroy({ where: { id: sesionCaja.id } });
    await Caja.destroy({ where: { id: caja.id } });
    await Usuario.destroy({ where: { id: usuario.id } });
  });

  it('print:cocina lleva cocina_pantalla_dedicada en config, y la respuesta HTTP también', async () => {
    emitir.mockClear();
    const res = await request(app)
      .post('/api/v1/ventas/completa')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'llevar', metodo_pago: 'efectivo', monto_recibido: 10, sesion_caja_id: sesionCaja.id,
        items: [{ producto_id: producto.id, cantidad: 1 }],
      });

    expect(res.status).toBe(201);
    expect(res.body.datos.datos_impresion.cocina.config.cocina_pantalla_dedicada).toBe('true');

    const llamadaCocina = emitir.mock.calls.find((c) => c[0] === 'print:cocina');
    expect(llamadaCocina).toBeDefined();
    expect(llamadaCocina[1].config.cocina_pantalla_dedicada).toBe('true');
  });
});
