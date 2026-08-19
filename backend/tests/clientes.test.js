const request = require('supertest');
const app = require('../src/app');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Cliente, Rol, Usuario } = require('../src/models');

describe('Clientes API', () => {
  it('GET /api/v1/clientes sin token → 401', async () => {
    const res = await request(app).get('/api/v1/clientes');
    expect(res.status).toBe(401);
  });

  describe('con un usuario autenticado', () => {
    let usuario, token, cliente;

    beforeAll(async () => {
      const timestamp = Date.now();
      const rol = await Rol.findOne({ where: { nombre: 'Administrador' } });
      const hash = await bcrypt.hash('clave123', 10);
      usuario = await Usuario.create({ rol_id: rol.id, nombre: `Clientes Test ${timestamp}`, email: `clientes-test-${timestamp}@restaurante.com`, contrasena: hash, acceso_todas_sucursales: 1 });

      const login = await request(app).post('/api/v1/auth/login').send({ email: usuario.email, contrasena: 'clave123' });
      const elegido = await request(app).post('/api/v1/auth/login/sucursal').send({ pre_token: login.body.datos.pre_token, sucursal_id: null });
      token = elegido.body.datos.token;

      cliente = await Cliente.create({ nombre: 'Cliente Reset Test', numero_documento: `reset-${timestamp}`, pin_hash: await bcrypt.hash('1234', 10) });
    });

    afterAll(async () => {
      await Cliente.destroy({ where: { id: cliente.id } });
      await Usuario.destroy({ where: { id: usuario.id } });
    });

    it('GET /api/v1/clientes no expone pin_hash y sí expone tiene_pin', async () => {
      const res = await request(app).get('/api/v1/clientes').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      const encontrado = res.body.datos.find((c) => c.id === cliente.id);
      expect(encontrado.pin_hash).toBeUndefined();
      expect(encontrado.tiene_pin).toBe(true);
    });

    it('POST /api/v1/clientes/:id/resetear-pin limpia el PIN', async () => {
      const res = await request(app)
        .post(`/api/v1/clientes/${cliente.id}/resetear-pin`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      const actualizado = await Cliente.findByPk(cliente.id);
      expect(actualizado.pin_hash).toBeNull();
      expect(actualizado.pin_intentos_fallidos).toBe(0);
      expect(actualizado.pin_bloqueado_hasta).toBeNull();
    });

    it('resetear el PIN revoca la sesión de cualquier token de cliente ya emitido', async () => {
      const clienteConSesion = await Cliente.create({
        nombre: 'Cliente Sesion Test',
        numero_documento: `sesion-${Date.now()}`,
        pin_hash: await bcrypt.hash('4321', 10),
      });
      const tokenCliente = jwt.sign({ cliente_id: clienteConSesion.id, tipo: 'cliente' }, process.env.JWT_SECRET, { expiresIn: '180d' });

      const antes = await request(app)
        .get('/api/v1/cliente/perfil')
        .set('Authorization', `Bearer ${tokenCliente}`);
      expect(antes.status).toBe(200);

      await request(app)
        .post(`/api/v1/clientes/${clienteConSesion.id}/resetear-pin`)
        .set('Authorization', `Bearer ${token}`);

      const despues = await request(app)
        .get('/api/v1/cliente/perfil')
        .set('Authorization', `Bearer ${tokenCliente}`);
      expect(despues.status).toBe(401);

      await Cliente.destroy({ where: { id: clienteConSesion.id } });
    });
  });
});
