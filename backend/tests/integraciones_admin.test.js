const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../src/app');
const { Sucursal, IntegracionApiKey, Rol, Permiso, Usuario } = require('../src/models');

describe('Administración de API keys de integraciones', () => {
  // Nota: el admin sembrado (admin@restaurante.com) en esta base de dev NO
  // tiene acceso_todas_sucursales=1 — está atado a una sola sucursal, igual
  // que cualquier usuario "normal" con una sola sucursal asignada (ver
  // auth.service.js login(): con una sola sucursal disponible, el token sale
  // con ese sucursal_id fijo, no null). Por eso, desde que integracionesAdmin
  // valida alcance (finding I1), estos tests tienen que operar sobre la
  // sucursal real del admin — no sobre una recién creada fuera de su alcance.
  let sucursal, adminToken;

  beforeAll(async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'admin@restaurante.com', contrasena: process.env.ADMIN_PASSWORD || 'admin123' });
    adminToken = login.body.datos.token;
    const sucursalId = login.body.datos.usuario.sucursal_activa.id;
    sucursal = sucursalId != null
      ? await Sucursal.findByPk(sucursalId)
      : await Sucursal.create({ nombre: 'Sucursal Integraciones Admin Test' });
  });

  afterAll(async () => {
    await IntegracionApiKey.destroy({ where: { sucursal_id: sucursal.id, nombre_app: ['PedidosYa', 'Temp'] } });
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

describe('Administración de API keys de integraciones — alcance por sucursal', () => {
  let sucursalPropia, sucursalAjena, rolId, usuarioId, tokenEscopado, keyAjena;

  beforeAll(async () => {
    sucursalPropia = await Sucursal.create({ nombre: 'Sucursal Alcance Propia Test' });
    sucursalAjena = await Sucursal.create({ nombre: 'Sucursal Alcance Ajena Test' });

    const rol = await Rol.create({ nombre: 'Config Sucursal Test', descripcion: 'Rol de prueba con permisos de configuración pero sin acceso a todas' });
    rolId = rol.id;
    const permisosConfig = await Permiso.findAll({ where: { modulo: 'configuracion' } });
    await rol.setPermisos(permisosConfig);

    const hash = await bcrypt.hash('clave123', 10);
    const usuario = await Usuario.create({
      rol_id: rol.id, nombre: 'Config Sucursal Test', email: 'config-sucursal-test@restaurante.com',
      contrasena: hash, acceso_todas_sucursales: 0,
    });
    usuarioId = usuario.id;
    await usuario.addSucursal(sucursalPropia);

    const login = await request(app).post('/api/v1/auth/login').send({ email: 'config-sucursal-test@restaurante.com', contrasena: 'clave123' });
    tokenEscopado = login.body.datos.token;

    keyAjena = await IntegracionApiKey.create({ sucursal_id: sucursalAjena.id, nombre_app: 'Ajena', api_key_hash: 'x' });
  });

  afterAll(async () => {
    await IntegracionApiKey.destroy({ where: { sucursal_id: [sucursalPropia.id, sucursalAjena.id] } });
    await Usuario.destroy({ where: { id: usuarioId } });
    await Rol.destroy({ where: { id: rolId } });
    await Sucursal.destroy({ where: { id: [sucursalPropia.id, sucursalAjena.id] } });
  });

  it('crear una key para una sucursal distinta a la propia → 403', async () => {
    const res = await request(app)
      .post('/api/v1/integraciones-admin')
      .set('Authorization', `Bearer ${tokenEscopado}`)
      .send({ sucursal_id: sucursalAjena.id, nombre_app: 'PedidosYa' });

    expect(res.status).toBe(403);
  });

  it('desactivar una key de una sucursal ajena → 404', async () => {
    const res = await request(app)
      .post(`/api/v1/integraciones-admin/${keyAjena.id}/desactivar`)
      .set('Authorization', `Bearer ${tokenEscopado}`);

    expect(res.status).toBe(404);
  });

  it('regenerar una key de una sucursal ajena → 404', async () => {
    const res = await request(app)
      .post(`/api/v1/integraciones-admin/${keyAjena.id}/regenerar`)
      .set('Authorization', `Bearer ${tokenEscopado}`);

    expect(res.status).toBe(404);
  });
});
