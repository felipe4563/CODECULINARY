const request = require('supertest');
const app = require('../src/app');
const { Sucursal, IntegracionApiKey } = require('../src/models');

describe('Administración de API keys de integraciones', () => {
  let sucursal, adminToken;

  beforeAll(async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'admin@restaurante.com', contrasena: process.env.ADMIN_PASSWORD || 'admin123' });
    adminToken = login.body.datos.token;
    sucursal = await Sucursal.create({ nombre: 'Sucursal Integraciones Admin Test' });
  });

  afterAll(async () => {
    await IntegracionApiKey.destroy({ where: { sucursal_id: sucursal.id } });
    await Sucursal.destroy({ where: { id: sucursal.id } });
  });

  it('crea una key y la devuelve en texto plano una sola vez', async () => {
    const res = await request(app)
      .post('/api/v1/integraciones-admin')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ sucursal_id: sucursal.id, nombre_app: 'PedidosYa' });

    expect(res.status).toBe(201);
    expect(res.body.datos.api_key).toMatch(/^ik_[0-9a-f]{48}$/);

    const guardada = await IntegracionApiKey.findByPk(res.body.datos.id);
    expect(guardada.api_key_hash).not.toBe(res.body.datos.api_key);
  });

  it('listar no expone el hash de la key', async () => {
    const res = await request(app)
      .get('/api/v1/integraciones-admin')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.datos[0].api_key_hash).toBeUndefined();
  });

  it('desactivar marca activo=false', async () => {
    const creada = await IntegracionApiKey.create({ sucursal_id: sucursal.id, nombre_app: 'Temp', api_key_hash: 'x' });
    const res = await request(app)
      .post(`/api/v1/integraciones-admin/${creada.id}/desactivar`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.datos.activo).toBe(false);
  });
});
