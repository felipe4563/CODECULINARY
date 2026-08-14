const request = require('supertest');
const app = require('../src/app');

describe('Mesas API', () => {
  it('GET /api/v1/mesas sin token → 401', async () => {
    const res = await request(app).get('/api/v1/mesas');
    expect(res.status).toBe(401);
  });

  it('GET /api/v1/areas sin token → 401', async () => {
    const res = await request(app).get('/api/v1/areas');
    expect(res.status).toBe(401);
  });
});

const { Area, Sucursal, Mesa } = require('../src/models');

describe('Mesas y áreas por sucursal', () => {
  let adminToken, sucursalOtra;

  beforeAll(async () => {
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@restaurante.com', contrasena: process.env.ADMIN_PASSWORD || 'admin123' });
    adminToken = login.body.datos.token;
    sucursalOtra = await Sucursal.create({ nombre: 'Sucursal Mesas Test' });
  });

  afterAll(async () => {
    await Area.destroy({ where: { sucursal_id: sucursalOtra.id } });
    await Sucursal.destroy({ where: { id: sucursalOtra.id } });
  });

  it('crea un área usando la sucursal del usuario autenticado, ignorando sucursal_id del body', async () => {
    const res = await request(app)
      .post('/api/v1/areas')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Area Test Sucursal', sucursal_id: sucursalOtra.id });

    expect(res.status).toBe(201);
    expect(res.body.datos.sucursal_id).not.toBe(sucursalOtra.id);

    await Area.destroy({ where: { id: res.body.datos.id } });
  });

  it('lista solo las áreas de la sucursal activa del usuario', async () => {
    const area = await Area.create({ nombre: 'Area Otra Sucursal Test', sucursal_id: sucursalOtra.id });

    const res = await request(app)
      .get('/api/v1/areas')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.datos.find(a => a.id === area.id)).toBeUndefined();

    await area.destroy();
  });
});

describe('POST/DELETE /api/v1/mesas/:id/sesion — habilitar/deshabilitar autoservicio a mano', () => {
  let adminToken, area, mesa;

  beforeAll(async () => {
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@restaurante.com', contrasena: process.env.ADMIN_PASSWORD || 'admin123' });
    adminToken = login.body.datos.token;

    area = await Area.create({ nombre: 'Area Sesion Mesa Test', sucursal_id: 1 });
    mesa = await Mesa.create({ area_id: area.id, nombre: 'Mesa Sesion Mesa Test' });
  });

  afterAll(async () => {
    await Mesa.destroy({ where: { id: mesa.id } });
    await Area.destroy({ where: { id: area.id } });
  });

  it('GET /mesas incluye sesiones: [] cuando no hay sesión activa', async () => {
    const res = await request(app).get('/api/v1/mesas').set('Authorization', `Bearer ${adminToken}`);
    const encontrada = res.body.datos.find(m => m.id === mesa.id);
    expect(encontrada.sesiones).toEqual([]);
  });

  it('POST .../sesion habilita el autoservicio, y GET /mesas lo refleja', async () => {
    const res = await request(app)
      .post(`/api/v1/mesas/${mesa.id}/sesion`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(201);
    expect(res.body.datos.cerrada_en).toBeNull();

    const lista = await request(app).get('/api/v1/mesas').set('Authorization', `Bearer ${adminToken}`);
    const encontrada = lista.body.datos.find(m => m.id === mesa.id);
    expect(encontrada.sesiones).toHaveLength(1);
  });

  it('DELETE .../sesion cierra el autoservicio', async () => {
    const res = await request(app)
      .delete(`/api/v1/mesas/${mesa.id}/sesion`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    const lista = await request(app).get('/api/v1/mesas').set('Authorization', `Bearer ${adminToken}`);
    const encontrada = lista.body.datos.find(m => m.id === mesa.id);
    expect(encontrada.sesiones).toEqual([]);
  });
});
