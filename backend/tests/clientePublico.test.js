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
const { Cliente, ClientePinVerificacion, Pedido, Sucursal, Area, Mesa, Categoria, Producto, SesionCaja, Caja, Rol, Usuario } = require('../src/models');
const { enviarCodigoPin } = require('../src/integrations/email/email.client');

function tokenPara(clienteId) {
  return jwt.sign({ cliente_id: clienteId, tipo: 'cliente' }, process.env.JWT_SECRET, { expiresIn: '180d' });
}

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

    it('una segunda solicitud, pasado el intervalo mínimo, reemplaza la verificación pendiente anterior', async () => {
      await request(app).post('/api/v1/cliente/pin/solicitar')
        .send({ numero_documento: cliente.numero_documento, pin: '1111', email: 'primero@example.com' });
      // Simula que la solicitud pendiente ya pasó el intervalo mínimo de
      // 60s (ver siguiente test), para poder probar el reemplazo sin
      // depender de un sleep real en el test.
      await ClientePinVerificacion.update(
        { creado_en: new Date(Date.now() - 61_000) },
        { where: { cliente_id: cliente.id } }
      );
      await request(app).post('/api/v1/cliente/pin/solicitar')
        .send({ numero_documento: cliente.numero_documento, pin: '2222', email: 'segundo@example.com' });

      const filas = await ClientePinVerificacion.findAll({ where: { cliente_id: cliente.id } });
      expect(filas.length).toBe(1);
      expect(filas[0].email).toBe('segundo@example.com');
    });

    it('una segunda solicitud dentro de los 60s → 429, no manda otro email ni reemplaza la pendiente', async () => {
      await request(app).post('/api/v1/cliente/pin/solicitar')
        .send({ numero_documento: cliente.numero_documento, pin: '1111', email: 'primero@example.com' });

      const res = await request(app).post('/api/v1/cliente/pin/solicitar')
        .send({ numero_documento: cliente.numero_documento, pin: '2222', email: 'segundo@example.com' });

      expect(res.status).toBe(429);
      expect(enviarCodigoPin).toHaveBeenCalledTimes(1);

      const filas = await ClientePinVerificacion.findAll({ where: { cliente_id: cliente.id } });
      expect(filas.length).toBe(1);
      expect(filas[0].email).toBe('primero@example.com');
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

  describe('PUT /api/v1/cliente/pin (cambiar) y GET /api/v1/cliente/perfil', () => {
    beforeEach(async () => {
      await cliente.update({ pin_hash: await bcrypt.hash('1111', 10), puntos: 42 });
    });

    it('GET /perfil sin token → 401', async () => {
      const res = await request(app).get('/api/v1/cliente/perfil');
      expect(res.status).toBe(401);
    });

    it('GET /perfil con token válido → nombre y puntos', async () => {
      const res = await request(app)
        .get('/api/v1/cliente/perfil')
        .set('Authorization', `Bearer ${tokenPara(cliente.id)}`);

      expect(res.status).toBe(200);
      expect(res.body.datos).toEqual({ nombre: cliente.nombre, puntos: 42 });
    });

    it('PUT /pin sin token → 401', async () => {
      const res = await request(app)
        .put('/api/v1/cliente/pin')
        .send({ pin_actual: '1111', pin_nuevo: '2222' });
      expect(res.status).toBe(401);
    });

    it('PUT /pin con pin_actual incorrecto → 401, no cambia nada', async () => {
      const res = await request(app)
        .put('/api/v1/cliente/pin')
        .set('Authorization', `Bearer ${tokenPara(cliente.id)}`)
        .send({ pin_actual: '0000', pin_nuevo: '2222' });

      expect(res.status).toBe(401);
      const actualizado = await Cliente.findByPk(cliente.id);
      expect(await bcrypt.compare('1111', actualizado.pin_hash)).toBe(true);
    });

    it('PUT /pin con pin_actual correcto → cambia el PIN', async () => {
      const res = await request(app)
        .put('/api/v1/cliente/pin')
        .set('Authorization', `Bearer ${tokenPara(cliente.id)}`)
        .send({ pin_actual: '1111', pin_nuevo: '2222' });

      expect(res.status).toBe(200);
      const actualizado = await Cliente.findByPk(cliente.id);
      expect(await bcrypt.compare('2222', actualizado.pin_hash)).toBe(true);
    });

    it('token inválido → 401', async () => {
      const res = await request(app)
        .get('/api/v1/cliente/perfil')
        .set('Authorization', 'Bearer token-basura');
      expect(res.status).toBe(401);
    });

    it('token de staff (tipo distinto) no sirve acá → 401', async () => {
      const tokenStaff = jwt.sign({ id: 1, sucursal_id: null }, process.env.JWT_SECRET, { expiresIn: '1h' });
      const res = await request(app)
        .get('/api/v1/cliente/perfil')
        .set('Authorization', `Bearer ${tokenStaff}`);
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/v1/cliente/pin/recuperar/solicitar y /confirmar', () => {
    beforeEach(async () => {
      await cliente.update({ pin_hash: await bcrypt.hash('1111', 10), email: 'registrado@example.com' });
    });

    it('solicitar sin PIN configurado (otro cliente) → 409', async () => {
      const timestamp = Date.now();
      const sinPin = await Cliente.create({ nombre: 'Sin PIN Recuperar', numero_documento: `sinpin-rec-${timestamp}` });

      const res = await request(app)
        .post('/api/v1/cliente/pin/recuperar/solicitar')
        .send({ numero_documento: sinPin.numero_documento });

      expect(res.status).toBe(409);
      await Cliente.destroy({ where: { id: sinPin.id } });
    });

    it('solicitar sin email registrado → 409', async () => {
      await cliente.update({ email: null });

      const res = await request(app)
        .post('/api/v1/cliente/pin/recuperar/solicitar')
        .send({ numero_documento: cliente.numero_documento });

      expect(res.status).toBe(409);
    });

    it('solicitar manda el código al email YA registrado, no a uno enviado por el body', async () => {
      const res = await request(app)
        .post('/api/v1/cliente/pin/recuperar/solicitar')
        .send({ numero_documento: cliente.numero_documento, email: 'otro-cualquiera@ejemplo.com' });

      expect(res.status).toBe(200);
      expect(enviarCodigoPin).toHaveBeenCalledTimes(1);
      expect(enviarCodigoPin.mock.calls[0][0].to).toBe('registrado@example.com');
      expect(res.body.datos.email_parcial).toContain('@example.com');
    });

    it('segunda solicitud dentro de los 60s → 429', async () => {
      await request(app).post('/api/v1/cliente/pin/recuperar/solicitar').send({ numero_documento: cliente.numero_documento });
      const res = await request(app).post('/api/v1/cliente/pin/recuperar/solicitar').send({ numero_documento: cliente.numero_documento });

      expect(res.status).toBe(429);
      expect(enviarCodigoPin).toHaveBeenCalledTimes(1);
    });

    it('confirmar con PIN nuevo inválido → 400', async () => {
      await request(app).post('/api/v1/cliente/pin/recuperar/solicitar').send({ numero_documento: cliente.numero_documento });
      const codigo = enviarCodigoPin.mock.calls[0][0].codigo;

      const res = await request(app)
        .post('/api/v1/cliente/pin/recuperar/confirmar')
        .send({ numero_documento: cliente.numero_documento, codigo, pin_nuevo: '12' });

      expect(res.status).toBe(400);
    });

    it('confirmar con código incorrecto → 400 e incrementa intentos', async () => {
      await request(app).post('/api/v1/cliente/pin/recuperar/solicitar').send({ numero_documento: cliente.numero_documento });

      const res = await request(app)
        .post('/api/v1/cliente/pin/recuperar/confirmar')
        .send({ numero_documento: cliente.numero_documento, codigo: '000000', pin_nuevo: '9999' });

      expect(res.status).toBe(400);
      const pendiente = await ClientePinVerificacion.findOne({ where: { cliente_id: cliente.id } });
      expect(pendiente.intentos).toBe(1);
    });

    it('confirmar correcto → cambia el PIN, resetea el bloqueo, borra el pendiente y devuelve token', async () => {
      await cliente.update({ pin_intentos_fallidos: 3, pin_bloqueado_hasta: new Date(Date.now() + 60_000) });
      await request(app).post('/api/v1/cliente/pin/recuperar/solicitar').send({ numero_documento: cliente.numero_documento });
      const codigo = enviarCodigoPin.mock.calls[0][0].codigo;

      const res = await request(app)
        .post('/api/v1/cliente/pin/recuperar/confirmar')
        .send({ numero_documento: cliente.numero_documento, codigo, pin_nuevo: '9999' });

      expect(res.status).toBe(200);
      expect(res.body.datos.token).toBeDefined();

      const actualizado = await Cliente.findByPk(cliente.id);
      expect(await bcrypt.compare('9999', actualizado.pin_hash)).toBe(true);
      expect(actualizado.pin_intentos_fallidos).toBe(0);
      expect(actualizado.pin_bloqueado_hasta).toBeNull();

      const pendiente = await ClientePinVerificacion.findOne({ where: { cliente_id: cliente.id } });
      expect(pendiente).toBeNull();
    });
  });

  describe('GET /api/v1/cliente/pedidos (historial)', () => {
    // Nota: NO reutiliza el `cliente` del beforeEach de nivel superior — el
    // orden relativo entre un beforeAll anidado y un beforeEach del describe
    // padre no es algo en lo que valga la pena confiar. Este bloque crea su
    // propio cliente, autocontenido.
    let sucursal, area, mesa, categoria, producto, usuario, caja, sesionCaja, clienteHistorial, otroCliente, pedidoDeEsteCliente, pedidoDeOtroCliente;

    beforeAll(async () => {
      const timestamp = Date.now();
      sucursal = await Sucursal.create({ nombre: `Sucursal Historial Test ${timestamp}` });
      area = await Area.create({ nombre: `Area Historial Test ${timestamp}`, sucursal_id: sucursal.id });
      mesa = await Mesa.create({ area_id: area.id, nombre: 'Mesa Historial Test' });
      categoria = await Categoria.create({ nombre: `Categoria Historial Test ${timestamp}` });
      producto = await Producto.create({ categoria_id: categoria.id, nombre: `Producto Historial Test ${timestamp}`, precio: 10, stock: 0 });

      const rol = await Rol.findOne({ where: { nombre: 'Cajero' } });
      usuario = await Usuario.create({ rol_id: rol.id, nombre: `Historial Test ${timestamp}`, email: `historial-test-${timestamp}@restaurante.com`, contrasena: 'x' });
      caja = await Caja.create({ sucursal_id: sucursal.id, nombre: 'Caja Historial Test' });
      sesionCaja = await SesionCaja.create({ usuario_id: usuario.id, sucursal_id: sucursal.id, caja_id: caja.id, monto_apertura: 0 });

      // pin_hash seteado porque authCliente ahora exige una sesión vigente
      // (ver Task de fix de "PIN reseteado no revoca el token"): en la
      // realidad un token de cliente solo se emite después de que
      // verificarPin/confirmarPin confirman que el PIN ya existe.
      clienteHistorial = await Cliente.create({ nombre: 'Cliente Historial', numero_documento: `hist-${timestamp}`, pin_hash: await bcrypt.hash('1234', 10) });
      otroCliente = await Cliente.create({ nombre: 'Otro Cliente', numero_documento: `otro-${timestamp}` });

      pedidoDeEsteCliente = await Pedido.create({
        mesa_id: mesa.id, tipo: 'mesa', usuario_id: usuario.id, cliente_id: clienteHistorial.id,
        sesion_caja_id: sesionCaja.id, sucursal_id: sucursal.id, estado: 'completado', total: 10,
      });
      pedidoDeOtroCliente = await Pedido.create({
        mesa_id: mesa.id, tipo: 'mesa', usuario_id: usuario.id, cliente_id: otroCliente.id,
        sesion_caja_id: sesionCaja.id, sucursal_id: sucursal.id, estado: 'completado', total: 20,
      });
    });

    afterAll(async () => {
      await Pedido.destroy({ where: { id: [pedidoDeEsteCliente.id, pedidoDeOtroCliente.id] } });
      await SesionCaja.destroy({ where: { id: sesionCaja.id } });
      await Caja.destroy({ where: { id: caja.id } });
      await Usuario.destroy({ where: { id: usuario.id } });
      await Cliente.destroy({ where: { id: [clienteHistorial.id, otroCliente.id] } });
      await Producto.destroy({ where: { id: producto.id } });
      await Categoria.destroy({ where: { id: categoria.id } });
      await Mesa.destroy({ where: { id: mesa.id } });
      await Area.destroy({ where: { id: area.id } });
      await Sucursal.destroy({ where: { id: sucursal.id } });
    });

    it('sin token → 401', async () => {
      const res = await request(app).get('/api/v1/cliente/pedidos');
      expect(res.status).toBe(401);
    });

    it('devuelve solo los pedidos de ese cliente_id, no los de otro cliente', async () => {
      const res = await request(app)
        .get('/api/v1/cliente/pedidos')
        .set('Authorization', `Bearer ${tokenPara(clienteHistorial.id)}`);

      expect(res.status).toBe(200);
      const ids = res.body.datos.map((p) => p.id);
      expect(ids).toContain(pedidoDeEsteCliente.id);
      expect(ids).not.toContain(pedidoDeOtroCliente.id);
    });
  });
});
