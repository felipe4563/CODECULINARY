// backend/tests/disponibilidad_productos.test.js
const request = require('supertest');
const app = require('../src/app');
const { Categoria, Producto } = require('../src/models');
const { listarProductos } = require('../src/modules/productos/productos.service');

describe('Disponibilidad diaria de productos', () => {
  let categoriaId, productoDisponibleId, productoNoDisponibleId, adminToken;

  beforeAll(async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'admin@restaurante.com', contrasena: process.env.ADMIN_PASSWORD || 'admin123' });
    adminToken = login.body.datos.token;

    const categoria = await Categoria.create({ nombre: 'Categoria Disponibilidad Test' });
    categoriaId = categoria.id;
    const disponible = await Producto.create({ categoria_id: categoriaId, nombre: 'Producto Disponible Test', precio: 10, stock: null });
    productoDisponibleId = disponible.id;
    const noDisponible = await Producto.create({ categoria_id: categoriaId, nombre: 'Producto No Disponible Test', precio: 10, stock: null, disponible_hoy: false });
    productoNoDisponibleId = noDisponible.id;
  });

  afterAll(async () => {
    await Producto.destroy({ where: { categoria_id: categoriaId } });
    await Categoria.destroy({ where: { id: categoriaId } });
  });

  it('listarProductos({ solo_disponibles_hoy: true }) excluye los marcados no disponibles', async () => {
    const productos = await listarProductos({ solo_disponibles_hoy: true }, {});
    const ids = productos.map(p => p.id);
    expect(ids).toContain(productoDisponibleId);
    expect(ids).not.toContain(productoNoDisponibleId);
  });

  it('listarProductos sin solo_disponibles_hoy incluye el producto no disponible igual', async () => {
    const productos = await listarProductos({}, {});
    const ids = productos.map(p => p.id);
    expect(ids).toContain(productoNoDisponibleId);
  });

  it('GET /api/v1/productos trae el campo disponible_hoy en la respuesta', async () => {
    const res = await request(app).get('/api/v1/productos').set('Authorization', `Bearer ${adminToken}`);
    const prod = res.body.datos.find(p => p.id === productoNoDisponibleId);
    expect(prod.disponible_hoy).toBe(0);
  });

  it('PUT /productos/:id/disponibilidad actualiza solo ese campo', async () => {
    const res = await request(app)
      .put(`/api/v1/productos/${productoDisponibleId}/disponibilidad`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ disponible_hoy: false });

    expect(res.status).toBe(200);
    expect(res.body.datos.disponible_hoy).toBe(false);

    const actualizado = await Producto.findByPk(productoDisponibleId);
    expect(actualizado.nombre).toBe('Producto Disponible Test'); // no tocó el nombre
    expect(actualizado.disponible_hoy).toBe(0);

    await actualizado.update({ disponible_hoy: true }); // deja el fixture limpio para los otros tests
  });

  it('PUT /productos/:id/disponibilidad sin token → 401', async () => {
    const res = await request(app)
      .put(`/api/v1/productos/${productoDisponibleId}/disponibilidad`)
      .send({ disponible_hoy: false });
    expect(res.status).toBe(401);
  });
});
