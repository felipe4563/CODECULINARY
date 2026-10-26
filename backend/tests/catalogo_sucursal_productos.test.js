const request = require('supertest');
const app = require('../src/app');
const { sequelize } = require('../src/models');
const { actualizarDisponibilidad } = require('../src/modules/productos/productos.service');
const { crearDosSucursales } = require('./helpers/dosSucursales');

describe('Productos y stock por sucursal', () => {
  let ctx, catA, catB, grupoB;
  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const sufijo = `${Date.now()}`;

  beforeAll(async () => {
    ctx = await crearDosSucursales();
    catA = (await request(app).post('/api/v1/categorias').set(auth(ctx.tokenA)).send({ nombre: `CatA ${sufijo}` })).body.datos;
    catB = (await request(app).post('/api/v1/categorias').set(auth(ctx.tokenB)).send({ nombre: `CatB ${sufijo}` })).body.datos;
    grupoB = (await request(app).post('/api/v1/grupos-opciones').set(auth(ctx.tokenB))
      .send({ nombre: `GrpB ${sufijo}`, tipo_seleccion: 'unica', opciones: [{ nombre: 'o1' }] })).body.datos;
  });
  afterAll(async () => { await ctx.limpiar(); await sequelize.close(); });

  const crearEn = (token, categoria_id, extra = {}) =>
    request(app).post('/api/v1/productos').set(auth(token)).send({ categoria_id, nombre: `P ${sufijo} ${Math.random()}`, precio: 10, ...extra });

  test('producto de A no aparece en el listado de B y GET /:id desde B → 404', async () => {
    const crear = await crearEn(ctx.tokenA, catA.id, { nombre: `Solo A ${sufijo}` });
    expect(crear.status).toBe(201);
    expect(crear.body.datos.sucursal_id).toBe(ctx.sucursalA.id);
    const resB = await request(app).get('/api/v1/productos').set(auth(ctx.tokenB));
    expect(resB.body.datos.map((p) => p.nombre)).not.toContain(`Solo A ${sufijo}`);
    const det = await request(app).get(`/api/v1/productos/${crear.body.datos.id}`).set(auth(ctx.tokenB));
    expect(det.status).toBe(404);
  });

  test('admin global sin sucursal_id lista productos de todas con sucursal', async () => {
    await crearEn(ctx.tokenA, catA.id, { nombre: `GA ${sufijo}` });
    await crearEn(ctx.tokenB, catB.id, { nombre: `GB ${sufijo}` });
    const res = await request(app).get('/api/v1/productos').set(auth(ctx.tokenGlobal));
    const ga = res.body.datos.find((p) => p.nombre === `GA ${sufijo}`);
    const gb = res.body.datos.find((p) => p.nombre === `GB ${sufijo}`);
    expect(ga.sucursal.nombre).toBe(ctx.sucursalA.nombre);
    expect(gb.sucursal.nombre).toBe(ctx.sucursalB.nombre);
    expect(gb.sucursal_id).toBe(ctx.sucursalB.id);
  });

  test('crear producto con categoría de otra sucursal → 400', async () => {
    const res = await crearEn(ctx.tokenA, catB.id);
    expect(res.status).toBe(400);
    expect(res.body.mensaje).toBe('La categoría no pertenece a la sucursal del producto');
  });

  test('crear o editar producto con grupo de opciones de otra sucursal → 400', async () => {
    const res = await crearEn(ctx.tokenA, catA.id, { grupos_opciones: [{ id: grupoB.id }] });
    expect(res.status).toBe(400);
    expect(res.body.mensaje).toBe('El grupo de opciones no pertenece a la sucursal del producto');
    const ok = await crearEn(ctx.tokenA, catA.id);
    const put = await request(app).put(`/api/v1/productos/${ok.body.datos.id}`).set(auth(ctx.tokenA))
      .send({ grupos_opciones: [{ id: grupoB.id }] });
    expect(put.status).toBe(400);
  });

  test('ajustar stock de un producto de A con usuario de B → 409', async () => {
    const crear = await crearEn(ctx.tokenA, catA.id, { stock: 5 });
    expect(crear.status).toBe(201);
    const res = await request(app).post('/api/v1/inventario/entrada').set(auth(ctx.tokenB))
      .send({ producto_id: crear.body.datos.id, cantidad: 3 });
    expect(res.status).toBe(409);
    expect(res.body.mensaje).toBe('El producto no pertenece a esta sucursal');
  });

  test('global crea producto en sucursal indicada y el stock inicial va ahí', async () => {
    const res = await crearEn(ctx.tokenGlobal, catB.id, { stock: 4, sucursal_id: ctx.sucursalB.id });
    expect(res.status).toBe(201);
    expect(res.body.datos.sucursal_id).toBe(ctx.sucursalB.id);
    expect(res.body.datos.stock_por_sucursal).toEqual([expect.objectContaining({ sucursal_id: ctx.sucursalB.id, stock: 4 })]);
  });

  test('PUT disponibilidad desde B sobre producto de A → 404', async () => {
    const crear = await crearEn(ctx.tokenA, catA.id);
    // Por servicio: el permiso productos.disponibilidad no está sembrado en la BD de test.
    await expect(actualizarDisponibilidad(crear.body.datos.id, false, { sucursal_id: ctx.sucursalB.id, acceso_todas: false }))
      .rejects.toMatchObject({ status: 404 });
    const del = await request(app).delete(`/api/v1/productos/${crear.body.datos.id}`).set(auth(ctx.tokenB));
    expect(del.status).toBe(404);
  });
});
