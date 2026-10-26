const request = require('supertest');
const app = require('../src/app');
const { sequelize } = require('../src/models');
const { crearDosSucursales } = require('./helpers/dosSucursales');

describe('Categorías y grupos de opciones por sucursal', () => {
  let ctx;
  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const nombre = `Cat ${Date.now()}`;

  beforeAll(async () => { ctx = await crearDosSucursales(); });
  afterAll(async () => { await ctx.limpiar(); await sequelize.close(); });

  test('categoría creada por usuario de A no aparece en el listado de B', async () => {
    const crear = await request(app).post('/api/v1/categorias').set(auth(ctx.tokenA)).send({ nombre });
    expect(crear.status).toBe(201);
    expect(crear.body.datos.sucursal_id).toBe(ctx.sucursalA.id);
    const resB = await request(app).get('/api/v1/categorias').set(auth(ctx.tokenB));
    expect(resB.body.datos.map((c) => c.nombre)).not.toContain(nombre);
    const resA = await request(app).get('/api/v1/categorias').set(auth(ctx.tokenA));
    expect(resA.body.datos.map((c) => c.nombre)).toContain(nombre);
  });

  test('usuario de B no puede editar ni eliminar una categoría de A', async () => {
    const crear = await request(app).post('/api/v1/categorias').set(auth(ctx.tokenA)).send({ nombre: `${nombre} X` });
    const id = crear.body.datos.id;
    const put = await request(app).put(`/api/v1/categorias/${id}`).set(auth(ctx.tokenB)).send({ nombre: 'Hack' });
    expect(put.status).toBe(404);
    const del = await request(app).delete(`/api/v1/categorias/${id}`).set(auth(ctx.tokenB));
    expect(del.status).toBe(404);
  });

  test('admin global sin sucursal_id al crear categoría → 400', async () => {
    const res = await request(app).post('/api/v1/categorias').set(auth(ctx.tokenGlobal)).send({ nombre: `${nombre} G` });
    expect(res.status).toBe(400);
  });

  test('admin global lista categorías filtrando por ?sucursal_id=A', async () => {
    await request(app).post('/api/v1/categorias').set(auth(ctx.tokenGlobal))
      .send({ nombre: `${nombre} GB`, sucursal_id: ctx.sucursalB.id });
    const res = await request(app).get(`/api/v1/categorias?sucursal_id=${ctx.sucursalA.id}`).set(auth(ctx.tokenGlobal));
    expect(res.status).toBe(200);
    expect(res.body.datos.length).toBeGreaterThan(0);
    expect(res.body.datos.every((c) => c.sucursal_id === ctx.sucursalA.id)).toBe(true);
  });

  test('grupo de opciones de A invisible y no editable desde B', async () => {
    const crear = await request(app).post('/api/v1/grupos-opciones').set(auth(ctx.tokenA))
      .send({ nombre: `${nombre} Grp`, tipo_seleccion: 'unica', opciones: [{ nombre: 'o1' }] });
    expect(crear.status).toBe(201);
    expect(crear.body.datos.sucursal_id).toBe(ctx.sucursalA.id);
    const id = crear.body.datos.id;
    const lista = await request(app).get('/api/v1/grupos-opciones').set(auth(ctx.tokenB));
    expect(lista.body.datos.map((g) => g.id)).not.toContain(id);
    const put = await request(app).put(`/api/v1/grupos-opciones/${id}`).set(auth(ctx.tokenB))
      .send({ nombre: 'Hack', tipo_seleccion: 'unica' });
    expect(put.status).toBe(404);
    const del = await request(app).delete(`/api/v1/grupos-opciones/${id}`).set(auth(ctx.tokenB));
    expect(del.status).toBe(404);
  });
});
