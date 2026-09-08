const request = require('supertest');
const express = require('express');
const { Sucursal, IntegracionApiKey } = require('../src/models');
const { authApiKeyExterna } = require('../src/middlewares/authApiKeyExterna');
const { crear: crearKey } = require('../src/modules/integraciones/integracionesAdmin.service');

describe('Middleware authApiKeyExterna', () => {
  let sucursal, apiKeyPlano, keyId;

  const app = express();
  app.get('/protegido', authApiKeyExterna, (req, res) => {
    res.json({ sucursal_id: req.sucursal_id });
  });

  beforeAll(async () => {
    sucursal = await Sucursal.create({ nombre: 'Sucursal AuthApiKey Test' });
    const creada = await crearKey({ sucursal_id: sucursal.id, nombre_app: 'Test App' });
    apiKeyPlano = creada.api_key;
    keyId = creada.id;
  });

  afterAll(async () => {
    await IntegracionApiKey.destroy({ where: { sucursal_id: sucursal.id } });
    await Sucursal.destroy({ where: { id: sucursal.id } });
  });

  it('sin header X-Api-Key → 401', async () => {
    const res = await request(app).get('/protegido');
    expect(res.status).toBe(401);
  });

  it('con key inválida → 401', async () => {
    const res = await request(app).get('/protegido').set('X-Api-Key', 'ik_no-existe');
    expect(res.status).toBe(401);
  });

  it('con key válida → cuelga sucursal_id', async () => {
    const res = await request(app).get('/protegido').set('X-Api-Key', apiKeyPlano);
    expect(res.status).toBe(200);
    expect(res.body.sucursal_id).toBe(sucursal.id);
  });

  it('con key desactivada → 401', async () => {
    await IntegracionApiKey.update({ activo: false }, { where: { id: keyId } });
    const res = await request(app).get('/protegido').set('X-Api-Key', apiKeyPlano);
    expect(res.status).toBe(401);
  });
});
