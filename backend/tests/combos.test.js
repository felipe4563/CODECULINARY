const request = require('supertest');
const app = require('../src/app');
const { Categoria, Producto, GrupoOpciones, Opcion, ProductoGrupoOpciones, Combo, ComboProducto } = require('../src/models');

describe('Combos — grupos_opciones anidado', () => {
  let adminToken, categoriaId, productoId, grupoId, comboId;

  beforeAll(async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'admin@restaurante.com', contrasena: process.env.ADMIN_PASSWORD || 'admin123' });
    adminToken = login.body.datos.token;

    const categoria = await Categoria.create({ nombre: 'Categoria Combo Grupos Test' });
    categoriaId = categoria.id;
    const producto = await Producto.create({ categoria_id: categoriaId, nombre: 'Producto Combo Grupos Test', precio: 8, stock: 0 });
    productoId = producto.id;
    const grupo = await GrupoOpciones.create({ nombre: 'Tamaño Combo Grupos Test', tipo_seleccion: 'unica' });
    grupoId = grupo.id;
    await Opcion.create({ grupo_opciones_id: grupoId, nombre: 'Grande', precio_adicional: 2, orden: 0 });
    await ProductoGrupoOpciones.create({ producto_id: productoId, grupo_opciones_id: grupoId, orden: 0, obligatorio: 1 });

    const combo = await Combo.create({ nombre: 'Combo Grupos Test', precio: 15 });
    comboId = combo.id;
    await ComboProducto.create({ combo_id: comboId, producto_id: productoId, cantidad: 1 });
  });

  afterAll(async () => {
    await ComboProducto.destroy({ where: { combo_id: comboId } });
    await Combo.destroy({ where: { id: comboId } });
    await ProductoGrupoOpciones.destroy({ where: { producto_id: productoId } });
    await Opcion.destroy({ where: { grupo_opciones_id: grupoId } });
    await GrupoOpciones.destroy({ where: { id: grupoId } });
    await Producto.destroy({ where: { id: productoId } });
    await Categoria.destroy({ where: { id: categoriaId } });
  });

  it('GET /api/v1/combos incluye grupos_opciones anidado en cada producto del combo', async () => {
    const res = await request(app).get('/api/v1/combos').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const combo = res.body.datos.find((c) => c.id === comboId);
    expect(combo).toBeDefined();
    const producto = combo.productos.find((p) => p.id === productoId);
    expect(producto.grupos_opciones).toHaveLength(1);
    expect(producto.grupos_opciones[0].obligatorio).toBe(true);
    expect(producto.grupos_opciones[0].opciones[0].nombre).toBe('Grande');
    expect(producto.grupos_opciones[0].opciones[0].precio_adicional).toBe(2);
  });
});
