const request = require('supertest');
const app = require('../src/app');

describe('Configuración API', () => {
  it('GET /api/v1/configuracion sin token → 401', async () => {
    const res = await request(app).get('/api/v1/configuracion');
    expect(res.status).toBe(401);
  });
});

describe('Configuración pública incluye colores de marca', () => {
  let adminToken;

  beforeAll(async () => {
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@restaurante.com', contrasena: process.env.ADMIN_PASSWORD || 'admin123' });
    adminToken = login.body.datos.token;
  });

  it('PUT /api/v1/configuracion con color_primario/color_secundario, luego GET /api/v1/configuracion/publica los incluye', async () => {
    await request(app)
      .put('/api/v1/configuracion')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ color_primario: '#245b62', color_secundario: '#d97706' })
      .expect(200);

    const res = await request(app).get('/api/v1/configuracion/publica');
    expect(res.status).toBe(200);
    expect(res.body.datos.color_primario).toBe('#245b62');
    expect(res.body.datos.color_secundario).toBe('#d97706');
  });
});
