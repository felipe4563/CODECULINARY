const request = require('supertest');
const app = require('../src/app');
const { Categoria, Producto } = require('../src/models');
const { crearDosSucursales } = require('./helpers/dosSucursales');

describe('Combos y promociones por sucursal', () => {
  let ctx, productoA, productoB, comboA, promoA;
  const auth = (token) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    ctx = await crearDosSucursales();
    const catA = await Categoria.create({ sucursal_id: ctx.sucursalA.id, nombre: 'Cat Combos A' });
    const catB = await Categoria.create({ sucursal_id: ctx.sucursalB.id, nombre: 'Cat Combos B' });
    productoA = await Producto.create({ sucursal_id: ctx.sucursalA.id, categoria_id: catA.id, nombre: 'Prod Combos A', precio: 10, stock: null });
    productoB = await Producto.create({ sucursal_id: ctx.sucursalB.id, categoria_id: catB.id, nombre: 'Prod Combos B', precio: 10, stock: null });

    const resCombo = await request(app).post('/api/v1/combos').set(auth(ctx.tokenA))
      .send({ nombre: 'Combo Sucursal A', precio: 15, productos: [{ producto_id: productoA.id, cantidad: 1 }] });
    expect(resCombo.status).toBe(201);
    comboA = resCombo.body.datos;

    const resPromo = await request(app).post('/api/v1/promociones').set(auth(ctx.tokenA))
      .send({ nombre: 'Promo Sucursal A', tipo: 'porcentaje', valor: 10, producto_ids: [productoA.id] });
    expect(resPromo.status).toBe(201);
    promoA = resPromo.body.datos;
  });

  afterAll(async () => { await ctx.limpiar(); });

  describe('combos', () => {
    it('se crea en la sucursal del usuario y el listado incluye la sucursal', async () => {
      expect(comboA.sucursal_id).toBe(ctx.sucursalA.id);
      const res = await request(app).get('/api/v1/combos').set(auth(ctx.tokenA));
      const combo = res.body.datos.find((c) => c.id === comboA.id);
      expect(combo.sucursal).toEqual({ id: ctx.sucursalA.id, nombre: ctx.sucursalA.nombre });
    });

    it('el combo de A no aparece en /combos ni /combos/activos de B', async () => {
      const lista = await request(app).get('/api/v1/combos').set(auth(ctx.tokenB));
      expect(lista.body.datos.some((c) => c.id === comboA.id)).toBe(false);
      const activos = await request(app).get('/api/v1/combos/activos').set(auth(ctx.tokenB));
      expect(activos.body.datos.some((c) => c.id === comboA.id)).toBe(false);
    });

    it('GET/PUT/DELETE del combo de A desde B → 404', async () => {
      const get = await request(app).get(`/api/v1/combos/${comboA.id}`).set(auth(ctx.tokenB));
      expect(get.status).toBe(404);
      const put = await request(app).put(`/api/v1/combos/${comboA.id}`).set(auth(ctx.tokenB)).send({ nombre: 'Hackeado' });
      expect(put.status).toBe(404);
      const del = await request(app).delete(`/api/v1/combos/${comboA.id}`).set(auth(ctx.tokenB));
      expect(del.status).toBe(404);
    });

    it('el global ve combos de todas las sucursales y puede filtrar por sucursal_id', async () => {
      const todos = await request(app).get('/api/v1/combos/activos').set(auth(ctx.tokenGlobal));
      expect(todos.body.datos.some((c) => c.id === comboA.id)).toBe(true);
      const deB = await request(app).get(`/api/v1/combos?sucursal_id=${ctx.sucursalB.id}`).set(auth(ctx.tokenGlobal));
      expect(deB.body.datos.some((c) => c.id === comboA.id)).toBe(false);
    });

    it('el global filtra /combos/activos por sucursal_id', async () => {
      const deA = await request(app).get(`/api/v1/combos/activos?sucursal_id=${ctx.sucursalA.id}`).set(auth(ctx.tokenGlobal));
      expect(deA.status).toBe(200);
      expect(deA.body.datos.some((c) => c.id === comboA.id)).toBe(true);
      expect(deA.body.datos.every((c) => c.sucursal_id === ctx.sucursalA.id)).toBe(true);
      const deB = await request(app).get(`/api/v1/combos/activos?sucursal_id=${ctx.sucursalB.id}`).set(auth(ctx.tokenGlobal));
      expect(deB.body.datos.some((c) => c.id === comboA.id)).toBe(false);
    });

    it('un usuario con sucursal ignora el sucursal_id de /combos/activos', async () => {
      const res = await request(app).get(`/api/v1/combos/activos?sucursal_id=${ctx.sucursalA.id}`).set(auth(ctx.tokenB));
      expect(res.body.datos.some((c) => c.id === comboA.id)).toBe(false);
    });

    it('crear un combo en A con un producto de B → 400', async () => {
      const res = await request(app).post('/api/v1/combos').set(auth(ctx.tokenA))
        .send({ nombre: 'Combo Mixto', precio: 20, productos: [{ producto_id: productoA.id }, { producto_id: productoB.id }] });
      expect(res.status).toBe(400);
      expect(res.body.mensaje).toBe('Todos los productos deben pertenecer a la misma sucursal');
    });

    it('actualizar los productos de un combo de A con uno de B → 400', async () => {
      const res = await request(app).put(`/api/v1/combos/${comboA.id}`).set(auth(ctx.tokenA))
        .send({ productos: [{ producto_id: productoB.id }] });
      expect(res.status).toBe(400);
    });
  });

  describe('promociones', () => {
    it('se crea en la sucursal del usuario y el listado incluye la sucursal', async () => {
      expect(promoA.sucursal_id).toBe(ctx.sucursalA.id);
      const res = await request(app).get('/api/v1/promociones').set(auth(ctx.tokenA));
      const promo = res.body.datos.find((p) => p.id === promoA.id);
      expect(promo.sucursal).toEqual({ id: ctx.sucursalA.id, nombre: ctx.sucursalA.nombre });
    });

    it('la promoción de A no aparece en /promociones ni /promociones/activas de B', async () => {
      const lista = await request(app).get('/api/v1/promociones').set(auth(ctx.tokenB));
      expect(lista.body.datos.some((p) => p.id === promoA.id)).toBe(false);
      const activas = await request(app).get('/api/v1/promociones/activas').set(auth(ctx.tokenB));
      expect(activas.body.datos.some((p) => p.id === promoA.id)).toBe(false);
      const propias = await request(app).get('/api/v1/promociones/activas').set(auth(ctx.tokenA));
      expect(propias.body.datos.some((p) => p.id === promoA.id)).toBe(true);
    });

    it('el global filtra /promociones/activas por sucursal_id', async () => {
      const deA = await request(app).get(`/api/v1/promociones/activas?sucursal_id=${ctx.sucursalA.id}`).set(auth(ctx.tokenGlobal));
      expect(deA.body.datos.some((p) => p.id === promoA.id)).toBe(true);
      const deB = await request(app).get(`/api/v1/promociones/activas?sucursal_id=${ctx.sucursalB.id}`).set(auth(ctx.tokenGlobal));
      expect(deB.body.datos.some((p) => p.id === promoA.id)).toBe(false);
    });

    it('GET/PUT/DELETE de la promoción de A desde B → 404', async () => {
      const get = await request(app).get(`/api/v1/promociones/${promoA.id}`).set(auth(ctx.tokenB));
      expect(get.status).toBe(404);
      const put = await request(app).put(`/api/v1/promociones/${promoA.id}`).set(auth(ctx.tokenB)).send({ nombre: 'Hackeada' });
      expect(put.status).toBe(404);
      const del = await request(app).delete(`/api/v1/promociones/${promoA.id}`).set(auth(ctx.tokenB));
      expect(del.status).toBe(404);
    });

    it('crear una promoción en A con un producto de B → 400', async () => {
      const res = await request(app).post('/api/v1/promociones').set(auth(ctx.tokenA))
        .send({ nombre: 'Promo Mixta', tipo: 'porcentaje', valor: 10, producto_ids: [productoA.id, productoB.id] });
      expect(res.status).toBe(400);
      expect(res.body.mensaje).toBe('Todos los productos deben pertenecer a la misma sucursal');
    });
  });
});
