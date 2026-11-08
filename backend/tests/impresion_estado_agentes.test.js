jest.mock('../src/socket', () => ({
  emitir: jest.fn(), init: jest.fn(),
  estadoAgentes: jest.fn(() => []),
  desconexionesAgentes: jest.fn(() => ({ desconexiones: new Map(), servidor_iniciado_en: 0 })),
}));
const { estadoAgentes, desconexionesAgentes } = require('../src/socket');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../src/app');
const { Sucursal, Caja, Usuario, Rol } = require('../src/models');

describe('GET /api/v1/impresion/estado-agentes', () => {
  let sucursal, cajaFisica, cajaBluetooth, usuario;
  let token;

  beforeAll(async () => {
    const timestamp = Date.now();
    sucursal = await Sucursal.create({ nombre: `Sucursal Impresion Estado Test ${timestamp}` });
    cajaFisica = await Caja.create({ sucursal_id: sucursal.id, nombre: 'Caja Fisica Estado Test', modo_impresion: 'fisica' });
    cajaBluetooth = await Caja.create({ sucursal_id: sucursal.id, nombre: 'Caja BT Estado Test', modo_impresion: 'bluetooth' });

    const rol = await Rol.findOne({ where: { nombre: 'Cajero' } });
    const hash = await bcrypt.hash('clave123', 10);
    usuario = await Usuario.create({ rol_id: rol.id, nombre: `Impresion Estado Test ${timestamp}`, email: `impresion-estado-test-${timestamp}@restaurante.com`, contrasena: hash });
    await usuario.addSucursal(sucursal);

    const login = await request(app).post('/api/v1/auth/login').send({ email: usuario.email, contrasena: 'clave123' });
    token = login.body.datos.token;
  });

  afterAll(async () => {
    await Usuario.destroy({ where: { id: usuario.id } });
    await Caja.destroy({ where: { sucursal_id: sucursal.id } });
    await Sucursal.destroy({ where: { id: sucursal.id } });
  });

  it('sin token → 401', async () => {
    const res = await request(app).get('/api/v1/impresion/estado-agentes');
    expect(res.status).toBe(401);
  });

  it('solo lista cajas físicas (nunca bluetooth), marcando conectado según estadoAgentes()', async () => {
    estadoAgentes.mockReturnValue([{ sucursal_id: sucursal.id, caja_id: cajaFisica.id, conectado_en: Date.now() }]);

    const res = await request(app)
      .get('/api/v1/impresion/estado-agentes')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const ids = res.body.datos.map((a) => a.caja_id);
    expect(ids).toContain(cajaFisica.id);
    expect(ids).not.toContain(cajaBluetooth.id);
    expect(res.body.datos.find((a) => a.caja_id === cajaFisica.id).conectado).toBe(true);
  });

  it('caja física sin agente conectado → conectado: false', async () => {
    estadoAgentes.mockReturnValue([]);

    const res = await request(app)
      .get('/api/v1/impresion/estado-agentes')
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.datos.find((a) => a.caja_id === cajaFisica.id).conectado).toBe(false);
  });

  it('desconectada: informa desde cuándo (última desconexión registrada)', async () => {
    estadoAgentes.mockReturnValue([]);
    const hace3h = Date.now() - 3 * 3600_000;
    desconexionesAgentes.mockReturnValue({
      desconexiones: new Map([[cajaFisica.id, hace3h]]),
      servidor_iniciado_en: Date.now() - 24 * 3600_000,
    });

    const res = await request(app)
      .get('/api/v1/impresion/estado-agentes')
      .set('Authorization', `Bearer ${token}`);

    const fila = res.body.datos.find((a) => a.caja_id === cajaFisica.id);
    expect(fila.desconectado_desde).toBe(new Date(hace3h).toISOString());
    expect(fila.desde_inicio_servidor).toBe(false);
  });

  it('desconectada sin registro desde que arrancó el servidor → usa el arranque del servidor', async () => {
    estadoAgentes.mockReturnValue([]);
    const arranque = Date.now() - 5 * 3600_000;
    desconexionesAgentes.mockReturnValue({ desconexiones: new Map(), servidor_iniciado_en: arranque });

    const res = await request(app)
      .get('/api/v1/impresion/estado-agentes')
      .set('Authorization', `Bearer ${token}`);

    const fila = res.body.datos.find((a) => a.caja_id === cajaFisica.id);
    expect(fila.desconectado_desde).toBe(new Date(arranque).toISOString());
    expect(fila.desde_inicio_servidor).toBe(true);
  });

  it('conectada → desconectado_desde: null', async () => {
    estadoAgentes.mockReturnValue([{ sucursal_id: sucursal.id, caja_id: cajaFisica.id, conectado_en: Date.now() }]);
    desconexionesAgentes.mockReturnValue({ desconexiones: new Map([[cajaFisica.id, Date.now() - 1000]]), servidor_iniciado_en: 0 });

    const res = await request(app)
      .get('/api/v1/impresion/estado-agentes')
      .set('Authorization', `Bearer ${token}`);

    const fila = res.body.datos.find((a) => a.caja_id === cajaFisica.id);
    expect(fila.conectado).toBe(true);
    expect(fila.desconectado_desde).toBeNull();
  });

  it('trae version, version_pendiente y autoactualizacion del agente; sin agente → null', async () => {
    estadoAgentes.mockReturnValue([{ sucursal_id: sucursal.id, caja_id: cajaFisica.id, conectado_en: Date.now(), version: '1.1.0', version_pendiente: '1.2.0', autoactualizacion: true }]);
    let res = await request(app).get('/api/v1/impresion/estado-agentes').set('Authorization', `Bearer ${token}`);
    let fila = res.body.datos.find((a) => a.caja_id === cajaFisica.id);
    expect(fila).toEqual(expect.objectContaining({ version: '1.1.0', version_pendiente: '1.2.0', autoactualizacion: true }));

    estadoAgentes.mockReturnValue([]);
    res = await request(app).get('/api/v1/impresion/estado-agentes').set('Authorization', `Bearer ${token}`);
    fila = res.body.datos.find((a) => a.caja_id === cajaFisica.id);
    expect(fila.version).toBeNull();
    expect(fila.version_pendiente).toBeNull();
    expect(fila.autoactualizacion).toBeNull();
  });
});
