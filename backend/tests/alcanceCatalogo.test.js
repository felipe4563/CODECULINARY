const request = require('supertest');
const app = require('../src/app');
const { filtroSucursalCatalogo, sucursalParaCrear, verificarSucursal } = require('../src/utils/alcanceCatalogo');
const { crearDosSucursales } = require('./helpers/dosSucursales');

describe('alcanceCatalogo', () => {
  it('usuario de sucursal ignora la sucursal pedida', () => {
    expect(filtroSucursalCatalogo({ sucursal_id: 3, acceso_todas: false }, 9)).toEqual({ sucursal_id: 3 });
  });
  it('global sin sucursal pedida → sin filtro', () => {
    expect(filtroSucursalCatalogo({ sucursal_id: null, acceso_todas: true }, undefined)).toEqual({});
  });
  it('global con sucursal pedida filtra por ella', () => {
    expect(filtroSucursalCatalogo({ sucursal_id: null, acceso_todas: true }, '5')).toEqual({ sucursal_id: 5 });
  });
  it('sucursalParaCrear de usuario de sucursal devuelve la suya', async () => {
    await expect(sucursalParaCrear({ sucursal_id: 3, acceso_todas: false }, 9)).resolves.toBe(3);
  });
  it('sucursalParaCrear global sin sucursal → 400', async () => {
    await expect(sucursalParaCrear({ acceso_todas: true }, undefined)).rejects.toMatchObject({ status: 400, message: 'sucursal_id es requerido' });
  });
  it('sucursalParaCrear global con sucursal inexistente → 404', async () => {
    await expect(sucursalParaCrear({ acceso_todas: true }, 999999)).rejects.toMatchObject({ status: 404 });
  });
  it('verificarSucursal lanza 404 para otra sucursal', () => {
    expect(() => verificarSucursal({ sucursal_id: 2 }, { sucursal_id: 1, acceso_todas: false }, 'Producto no encontrado'))
      .toThrow(expect.objectContaining({ status: 404, message: 'Producto no encontrado' }));
  });
  it('verificarSucursal deja pasar a la propia sucursal y al global', () => {
    expect(() => verificarSucursal({ sucursal_id: 1 }, { sucursal_id: 1, acceso_todas: false }, 'x')).not.toThrow();
    expect(() => verificarSucursal({ sucursal_id: 2 }, { sucursal_id: null, acceso_todas: true }, 'x')).not.toThrow();
  });
});

describe('helper dosSucursales', () => {
  let ctx;
  beforeAll(async () => { ctx = await crearDosSucursales(); });
  afterAll(async () => { await ctx.limpiar(); });

  it('sucursalParaCrear global con sucursal existente la devuelve', async () => {
    await expect(sucursalParaCrear({ acceso_todas: true }, ctx.sucursalA.id)).resolves.toBe(ctx.sucursalA.id);
  });

  it('cada token queda ligado a su sucursal y el global a ninguna', async () => {
    const yo = async (t) => (await request(app).get('/api/v1/auth/yo').set('Authorization', `Bearer ${t}`)).body.datos;
    expect((await yo(ctx.tokenA)).sucursal_id).toBe(ctx.sucursalA.id);
    expect((await yo(ctx.tokenB)).sucursal_id).toBe(ctx.sucursalB.id);
    const g = await yo(ctx.tokenGlobal);
    expect(g.sucursal_id).toBeNull();
    expect(g.acceso_todas).toBe(true);
  });
});
