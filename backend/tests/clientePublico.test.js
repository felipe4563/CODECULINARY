jest.mock('../src/integrations/email/email.client', () => ({
  enviarCodigoPin: jest.fn().mockResolvedValue(),
}));

// resolverOCrearPorDocumento (Task 3) llama a la API real de Personas para
// resolver CIs que todavía no son un Cliente en la base — se mockea acá para
// que estos tests no dependan de red/credenciales externas ni de que el CI
// de prueba (inventado con Date.now()) exista de verdad en el registro
// civil. Cualquier documento "nuevo" resuelve a una persona ficticia, tal
// como lo haría un CI real encontrado en la API.
jest.mock('../src/integrations/personas/personas.client', () => ({
  buscarPorDocumento: jest.fn((numeroDocumento) => Promise.resolve({
    codigo: 999999,
    numeroDocumento,
    primerNombre: 'Test',
    primerApellido: 'Persona',
  })),
  buscarPorCodigo: jest.fn().mockResolvedValue(null),
  buscarPorNombre: jest.fn().mockResolvedValue({ content: [] }),
}));

const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const { Cliente, ClientePinVerificacion } = require('../src/models');
const { enviarCodigoPin } = require('../src/integrations/email/email.client');

describe('Cliente público — PIN', () => {
  let cliente;

  beforeEach(async () => {
    enviarCodigoPin.mockClear();
    const timestamp = Date.now();
    cliente = await Cliente.create({ nombre: 'Test PIN', numero_documento: `pin-${timestamp}` });
  });

  afterEach(async () => {
    await ClientePinVerificacion.destroy({ where: { cliente_id: cliente.id } });
    await Cliente.destroy({ where: { id: cliente.id } });
  });

  describe('POST /api/v1/cliente/estado', () => {
    it('CI sin PIN → tiene_pin: false, y crea el Cliente si no existía', async () => {
      const timestamp = Date.now();
      const res = await request(app)
        .post('/api/v1/cliente/estado')
        .send({ numero_documento: `nuevo-${timestamp}` });

      expect(res.status).toBe(200);
      expect(res.body.datos).toEqual({ tiene_pin: false });

      const creado = await Cliente.findOne({ where: { numero_documento: `nuevo-${timestamp}` } });
      expect(creado).not.toBeNull();
      await Cliente.destroy({ where: { id: creado.id } });
    });

    it('CI con PIN ya activo → tiene_pin: true', async () => {
      await cliente.update({ pin_hash: await bcrypt.hash('1234', 10) });

      const res = await request(app)
        .post('/api/v1/cliente/estado')
        .send({ numero_documento: cliente.numero_documento });

      expect(res.status).toBe(200);
      expect(res.body.datos).toEqual({ tiene_pin: true });
    });
  });

  describe('POST /api/v1/cliente/pin/solicitar', () => {
    it('PIN inválido (no 4 dígitos) → 400', async () => {
      const res = await request(app)
        .post('/api/v1/cliente/pin/solicitar')
        .send({ numero_documento: cliente.numero_documento, pin: '12', email: 'a@b.com' });

      expect(res.status).toBe(400);
    });

    it('email inválido → 400', async () => {
      const res = await request(app)
        .post('/api/v1/cliente/pin/solicitar')
        .send({ numero_documento: cliente.numero_documento, pin: '1234', email: 'no-es-email' });

      expect(res.status).toBe(400);
    });

    it('CI que ya tiene PIN activo → 409', async () => {
      await cliente.update({ pin_hash: await bcrypt.hash('1234', 10) });

      const res = await request(app)
        .post('/api/v1/cliente/pin/solicitar')
        .send({ numero_documento: cliente.numero_documento, pin: '5678', email: 'a@b.com' });

      expect(res.status).toBe(409);
    });

    it('caso feliz: crea la verificación pendiente y manda el código por email', async () => {
      const res = await request(app)
        .post('/api/v1/cliente/pin/solicitar')
        .send({ numero_documento: cliente.numero_documento, pin: '1234', email: 'cliente@example.com' });

      expect(res.status).toBe(200);
      expect(res.body.datos).toEqual({ ok: true });
      expect(enviarCodigoPin).toHaveBeenCalledTimes(1);
      expect(enviarCodigoPin.mock.calls[0][0].to).toBe('cliente@example.com');

      const pendiente = await ClientePinVerificacion.findOne({ where: { cliente_id: cliente.id } });
      expect(pendiente).not.toBeNull();
      expect(pendiente.email).toBe('cliente@example.com');
    });

    it('una segunda solicitud reemplaza la verificación pendiente anterior', async () => {
      await request(app).post('/api/v1/cliente/pin/solicitar')
        .send({ numero_documento: cliente.numero_documento, pin: '1111', email: 'primero@example.com' });
      await request(app).post('/api/v1/cliente/pin/solicitar')
        .send({ numero_documento: cliente.numero_documento, pin: '2222', email: 'segundo@example.com' });

      const filas = await ClientePinVerificacion.findAll({ where: { cliente_id: cliente.id } });
      expect(filas.length).toBe(1);
      expect(filas[0].email).toBe('segundo@example.com');
    });
  });

  describe('POST /api/v1/cliente/pin/confirmar', () => {
    async function solicitar(numero_documento, pin, email) {
      await request(app).post('/api/v1/cliente/pin/solicitar').send({ numero_documento, pin, email });
      const enviado = enviarCodigoPin.mock.calls[enviarCodigoPin.mock.calls.length - 1][0];
      return enviado.codigo;
    }

    it('sin verificación pendiente → 400', async () => {
      const res = await request(app)
        .post('/api/v1/cliente/pin/confirmar')
        .send({ numero_documento: cliente.numero_documento, codigo: '000000' });

      expect(res.status).toBe(400);
    });

    it('código incorrecto → 400 e incrementa intentos', async () => {
      await solicitar(cliente.numero_documento, '1234', 'a@b.com');

      const res = await request(app)
        .post('/api/v1/cliente/pin/confirmar')
        .send({ numero_documento: cliente.numero_documento, codigo: '999999' });

      expect(res.status).toBe(400);
      const pendiente = await ClientePinVerificacion.findOne({ where: { cliente_id: cliente.id } });
      expect(pendiente.intentos).toBe(1);
    });

    it('código vencido → 400', async () => {
      const codigo = await solicitar(cliente.numero_documento, '1234', 'a@b.com');
      await ClientePinVerificacion.update(
        { expira_en: new Date(Date.now() - 60_000) },
        { where: { cliente_id: cliente.id } }
      );

      const res = await request(app)
        .post('/api/v1/cliente/pin/confirmar')
        .send({ numero_documento: cliente.numero_documento, codigo });

      expect(res.status).toBe(400);
    });

    it('5 intentos fallidos seguidos → 429', async () => {
      await solicitar(cliente.numero_documento, '1234', 'a@b.com');
      for (let i = 0; i < 5; i++) {
        await request(app).post('/api/v1/cliente/pin/confirmar')
          .send({ numero_documento: cliente.numero_documento, codigo: '000000' });
      }

      const res = await request(app)
        .post('/api/v1/cliente/pin/confirmar')
        .send({ numero_documento: cliente.numero_documento, codigo: '000000' });

      expect(res.status).toBe(429);
    });

    it('código correcto → activa el PIN, guarda el email, borra el pendiente y devuelve un token', async () => {
      const codigo = await solicitar(cliente.numero_documento, '1234', 'confirmado@example.com');

      const res = await request(app)
        .post('/api/v1/cliente/pin/confirmar')
        .send({ numero_documento: cliente.numero_documento, codigo });

      expect(res.status).toBe(200);
      expect(res.body.datos.token).toBeDefined();

      const payload = jwt.verify(res.body.datos.token, process.env.JWT_SECRET);
      expect(payload.cliente_id).toBe(cliente.id);
      expect(payload.tipo).toBe('cliente');

      const actualizado = await Cliente.findByPk(cliente.id);
      expect(actualizado.pin_hash).not.toBeNull();
      expect(actualizado.email).toBe('confirmado@example.com');
      expect(await bcrypt.compare('1234', actualizado.pin_hash)).toBe(true);

      const pendiente = await ClientePinVerificacion.findOne({ where: { cliente_id: cliente.id } });
      expect(pendiente).toBeNull();
    });
  });

  describe('POST /api/v1/cliente/pin/verificar', () => {
    beforeEach(async () => {
      await cliente.update({ pin_hash: await bcrypt.hash('4321', 10) });
    });

    it('sin PIN configurado (otro cliente) → 409', async () => {
      const timestamp = Date.now();
      const sinPin = await Cliente.create({ nombre: 'Sin PIN', numero_documento: `sinpin-${timestamp}` });

      const res = await request(app)
        .post('/api/v1/cliente/pin/verificar')
        .send({ numero_documento: sinPin.numero_documento, pin: '0000' });

      expect(res.status).toBe(409);
      await Cliente.destroy({ where: { id: sinPin.id } });
    });

    it('PIN correcto → 200 con token y resetea el contador de intentos', async () => {
      await cliente.update({ pin_intentos_fallidos: 2 });

      const res = await request(app)
        .post('/api/v1/cliente/pin/verificar')
        .send({ numero_documento: cliente.numero_documento, pin: '4321' });

      expect(res.status).toBe(200);
      expect(res.body.datos.token).toBeDefined();
      const payload = jwt.verify(res.body.datos.token, process.env.JWT_SECRET);
      expect(payload.cliente_id).toBe(cliente.id);

      const actualizado = await Cliente.findByPk(cliente.id);
      expect(actualizado.pin_intentos_fallidos).toBe(0);
    });

    it('PIN incorrecto → 401 e incrementa el contador', async () => {
      const res = await request(app)
        .post('/api/v1/cliente/pin/verificar')
        .send({ numero_documento: cliente.numero_documento, pin: '0000' });

      expect(res.status).toBe(401);
      const actualizado = await Cliente.findByPk(cliente.id);
      expect(actualizado.pin_intentos_fallidos).toBe(1);
    });

    it('5 intentos fallidos seguidos → bloquea 5 minutos y resetea el contador', async () => {
      for (let i = 0; i < 5; i++) {
        await request(app).post('/api/v1/cliente/pin/verificar')
          .send({ numero_documento: cliente.numero_documento, pin: '0000' });
      }

      const actualizado = await Cliente.findByPk(cliente.id);
      expect(actualizado.pin_intentos_fallidos).toBe(0);
      expect(actualizado.pin_bloqueado_hasta).not.toBeNull();
      expect(actualizado.pin_bloqueado_hasta.getTime()).toBeGreaterThan(Date.now());
    });

    it('bloqueo vigente → 429 aunque el PIN sea correcto, sin tocar el contador', async () => {
      await cliente.update({ pin_bloqueado_hasta: new Date(Date.now() + 60_000), pin_intentos_fallidos: 0 });

      const res = await request(app)
        .post('/api/v1/cliente/pin/verificar')
        .send({ numero_documento: cliente.numero_documento, pin: '4321' });

      expect(res.status).toBe(429);
      const actualizado = await Cliente.findByPk(cliente.id);
      expect(actualizado.pin_intentos_fallidos).toBe(0);
    });
  });
});
