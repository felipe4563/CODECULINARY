const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../src/app');
const { Sucursal, Rol, Usuario, Caja, SesionCaja, Categoria, Producto, ProductoStockSucursal, IntegracionApiKey, Pedido, DetallePedido } = require('../src/models');
const { crear: crearKey } = require('../src/modules/integraciones/integracionesAdmin.service');

describe('API pública de integraciones', () => {
  let sucursal, apiKey, categoria, producto, sesion;

  beforeAll(async () => {
    sucursal = await Sucursal.create({ nombre: 'Sucursal Integracion Publica Test' });
    const rol = await Rol.findOne({ where: { nombre: 'Cajero' } });
    const hash = await bcrypt.hash('clave123', 10);
    const usuario = await Usuario.create({ rol_id: rol.id, nombre: 'Usuario Integracion Test', email: `usuario-integracion-${Date.now()}@restaurante.com`, contrasena: hash });
    const caja = await Caja.create({ sucursal_id: sucursal.id, nombre: 'Caja Integracion Test' });
    sesion = await SesionCaja.create({ usuario_id: usuario.id, sucursal_id: sucursal.id, caja_id: caja.id, monto_apertura: 0 });
    categoria = await Categoria.create({ nombre: `Categoria Integracion Test ${Date.now()}` });
    producto = await Producto.create({ categoria_id: categoria.id, nombre: 'Producto Integracion Test', precio: 25, es_vendible: 1 });
    await ProductoStockSucursal.create({ producto_id: producto.id, sucursal_id: sucursal.id, stock: 100 });

    const creada = await crearKey({ sucursal_id: sucursal.id, nombre_app: 'PedidosYa Test' });
    apiKey = creada.api_key;
  });

  afterAll(async () => {
    // Los tests de POST /pedidos crean Pedido/DetallePedido reales que
    // referencian a `producto` — hay que borrarlos antes o el DELETE de
    // Producto choca con la FK (no estaba contemplado en el fixture original).
    const pedidos = await Pedido.findAll({ where: { sucursal_id: sucursal.id }, attributes: ['id'] });
    const idsPedido = pedidos.map((p) => p.id);
    if (idsPedido.length > 0) {
      await DetallePedido.destroy({ where: { pedido_id: idsPedido } });
      await Pedido.destroy({ where: { id: idsPedido } });
    }
    await SesionCaja.destroy({ where: { id: sesion.id } });
    await ProductoStockSucursal.destroy({ where: { producto_id: producto.id } });
    await Producto.destroy({ where: { id: producto.id } });
    await Categoria.destroy({ where: { id: categoria.id } });
    await IntegracionApiKey.destroy({ where: { sucursal_id: sucursal.id } });
  });

  it('GET /menu sin API key → 401', async () => {
    const res = await request(app).get('/api/v1/integraciones/menu');
    expect(res.status).toBe(401);
  });

  it('GET /menu con API key válida → devuelve el producto de esa sucursal', async () => {
    const res = await request(app).get('/api/v1/integraciones/menu').set('X-Api-Key', apiKey);
    expect(res.status).toBe(200);
    expect(res.body.datos.productos.some((p) => p.id === producto.id)).toBe(true);
  });

  it('POST /pedidos con tipo delivery y prepago → pedido completado con dirección', async () => {
    const res = await request(app)
      .post('/api/v1/integraciones/pedidos')
      .set('X-Api-Key', apiKey)
      .send({
        items: [{ producto_id: producto.id, cantidad: 2 }],
        tipo: 'delivery', direccion_entrega: 'Calle Falsa 123', telefono_cliente: '70099999',
        nombre_cliente: 'Cliente App', pago: 'prepago',
      });

    expect(res.status).toBe(201);
    expect(res.body.datos.estado).toBe('completado');
    // La respuesta pública es intencionalmente mínima (id/estado/total, igual
    // que GET /pedidos/:id/estado) — no debe traer el pedido completo ni
    // datos_impresion. Campos internos como origen/origen_app/direccion_entrega
    // se verifican directo contra la fila de la base.
    expect(res.body.datos.origen).toBeUndefined();
    expect(res.body.datos.datos_impresion).toBeUndefined();
    expect(Object.keys(res.body.datos).sort()).toEqual(['estado', 'id', 'total']);

    const fila = await Pedido.findByPk(res.body.datos.id);
    expect(fila.origen).toBe('app_externa');
    expect(fila.origen_app).toBe('PedidosYa Test');
    expect(fila.direccion_entrega).toBe('Calle Falsa 123');
  });

  it('POST /pedidos con pago contra_entrega → pedido pendiente', async () => {
    const res = await request(app)
      .post('/api/v1/integraciones/pedidos')
      .set('X-Api-Key', apiKey)
      .send({ items: [{ producto_id: producto.id, cantidad: 1 }], tipo: 'llevar', pago: 'contra_entrega' });

    expect(res.status).toBe(201);
    expect(res.body.datos.estado).toBe('pendiente');
  });

  it('GET /pedidos/:id/estado de un pedido de otra sucursal → 404', async () => {
    const otraSucursal = await Sucursal.create({ nombre: 'Otra Sucursal Test' });
    const otraKey = await crearKey({ sucursal_id: otraSucursal.id, nombre_app: 'Otra App' });

    const creado = await request(app)
      .post('/api/v1/integraciones/pedidos')
      .set('X-Api-Key', apiKey)
      .send({ items: [{ producto_id: producto.id, cantidad: 1 }], tipo: 'llevar', pago: 'prepago' });

    const res = await request(app)
      .get(`/api/v1/integraciones/pedidos/${creado.body.datos.id}/estado`)
      .set('X-Api-Key', otraKey.api_key);
    expect(res.status).toBe(404);

    await IntegracionApiKey.destroy({ where: { sucursal_id: otraSucursal.id } });
    await otraSucursal.destroy();
  });
});
