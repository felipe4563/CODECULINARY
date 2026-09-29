const bcrypt = require('bcryptjs');
const request = require('supertest');
const app = require('../src/app');
const { Sucursal, Rol, Usuario, MarcacionPersonal } = require('../src/models');

describe('Personal — marcar asistencia (empleado)', () => {
  let sucursal, token, usuarioId;

  beforeAll(async () => {
    const ts = Date.now();
    sucursal = await Sucursal.create({
      nombre: `Sucursal Personal Test ${ts}`,
      latitud: -17.393800, longitud: -63.190500, radio_geocerca_metros: 150,
    });
    const rol = await Rol.findOne({ where: { nombre: 'Mozo' } });
    const hash = await bcrypt.hash('clave123', 10);
    const usuario = await Usuario.create({
      rol_id: rol.id, nombre: `Personal Marcar Test ${ts}`,
      email: `personal-marcar-test-${ts}@restaurante.com`, contrasena: hash,
    });
    usuarioId = usuario.id;
    await usuario.addSucursal(sucursal);

    const login = await request(app).post('/api/v1/auth/login').send({ email: usuario.email, contrasena: 'clave123' });
    token = login.body.datos.token;
  });

  afterAll(async () => {
    await MarcacionPersonal.destroy({ where: { usuario_id: usuarioId } });
    await Usuario.destroy({ where: { id: usuarioId } });
    await Sucursal.destroy({ where: { id: sucursal.id } });
  });

  it('sin token → 401', async () => {
    const res = await request(app).post('/api/v1/personal/marcar').send({});
    expect(res.status).toBe(401);
  });

  it('primera marcación del día crea una entrada abierta, verificada dentro del radio', async () => {
    const res = await request(app)
      .post('/api/v1/personal/marcar')
      .set('Authorization', `Bearer ${token}`)
      .send({ lat: -17.393800, lng: -63.190500 });
    expect(res.status).toBe(200);
    expect(res.body.datos.estado).toBe('abierto');
    expect(res.body.datos.verificacion_entrada).toBe('ok');
    expect(res.body.datos.hora_salida).toBeNull();
  });

  it('sin coordenadas queda sin_verificar y no bloquea la marcación', async () => {
    await MarcacionPersonal.destroy({ where: { usuario_id: usuarioId } });
    const res = await request(app)
      .post('/api/v1/personal/marcar')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.datos.verificacion_entrada).toBe('sin_verificar');
  });

  it('lejos de la sucursal se bloquea con 409 (fuera_de_rango sí bloquea)', async () => {
    await MarcacionPersonal.destroy({ where: { usuario_id: usuarioId } });
    const res = await request(app)
      .post('/api/v1/personal/marcar')
      .set('Authorization', `Bearer ${token}`)
      .send({ lat: -17.5, lng: -63.190500 });
    expect(res.status).toBe(409);

    const marcaciones = await MarcacionPersonal.count({ where: { usuario_id: usuarioId } });
    expect(marcaciones).toBe(0);
  });

  it('una sucursal sin latitud/longitud configuradas deja la marcación sin_verificar', async () => {
    const sinCoordenadas = await Sucursal.create({ nombre: `Sucursal SinCoords Test ${Date.now()}` });
    const rol = await Rol.findOne({ where: { nombre: 'Mozo' } });
    const hash = await bcrypt.hash('clave123', 10);
    const empleado = await Usuario.create({
      rol_id: rol.id, nombre: 'Personal SinCoords Test',
      email: `personal-sincoords-test-${Date.now()}@restaurante.com`, contrasena: hash,
    });
    await empleado.addSucursal(sinCoordenadas);
    const login = await request(app).post('/api/v1/auth/login').send({ email: empleado.email, contrasena: 'clave123' });

    const res = await request(app)
      .post('/api/v1/personal/marcar')
      .set('Authorization', `Bearer ${login.body.datos.token}`)
      .send({ lat: -17.393800, lng: -63.190500 });
    expect(res.status).toBe(200);
    expect(res.body.datos.verificacion_entrada).toBe('sin_verificar');

    await MarcacionPersonal.destroy({ where: { usuario_id: empleado.id } });
    await Usuario.destroy({ where: { id: empleado.id } });
    await Sucursal.destroy({ where: { id: sinCoordenadas.id } });
  });

  it('sin sucursal activa (login "Todas las sucursales") no puede marcar asistencia', async () => {
    const rolAdmin = await Rol.findOne({ where: { nombre: 'Administrador' } });
    const hash = await bcrypt.hash('clave123', 10);
    const admin = await Usuario.create({
      rol_id: rolAdmin.id, nombre: 'Personal SinSucursal Test', acceso_todas_sucursales: 1,
      email: `personal-sinsucursal-test-${Date.now()}@restaurante.com`, contrasena: hash,
    });
    const login = await request(app).post('/api/v1/auth/login').send({ email: admin.email, contrasena: 'clave123' });
    const { pre_token } = login.body.datos;
    const conSucursal = await request(app).post('/api/v1/auth/login/sucursal').send({ pre_token, sucursal_id: null });

    const res = await request(app)
      .post('/api/v1/personal/marcar')
      .set('Authorization', `Bearer ${conSucursal.body.datos.token}`)
      .send({});
    expect(res.status).toBe(403);

    await Usuario.destroy({ where: { id: admin.id } });
  });

  it('la segunda marcación cierra la entrada abierta en vez de crear otra', async () => {
    await MarcacionPersonal.destroy({ where: { usuario_id: usuarioId } });
    await request(app).post('/api/v1/personal/marcar').set('Authorization', `Bearer ${token}`).send({ lat: -17.393800, lng: -63.190500 });
    const res = await request(app)
      .post('/api/v1/personal/marcar')
      .set('Authorization', `Bearer ${token}`)
      .send({ lat: -17.393800, lng: -63.190500 });
    expect(res.status).toBe(200);
    expect(res.body.datos.estado).toBe('cerrado');
    expect(res.body.datos.hora_salida).not.toBeNull();

    const abiertas = await MarcacionPersonal.count({ where: { usuario_id: usuarioId, estado: 'abierto' } });
    expect(abiertas).toBe(0);
  });

  it('no permite una segunda entrada el mismo día después de haber cerrado la primera', async () => {
    await MarcacionPersonal.destroy({ where: { usuario_id: usuarioId } });
    await request(app).post('/api/v1/personal/marcar').set('Authorization', `Bearer ${token}`).send({ lat: -17.393800, lng: -63.190500 });
    await request(app).post('/api/v1/personal/marcar').set('Authorization', `Bearer ${token}`).send({ lat: -17.393800, lng: -63.190500 });

    const res = await request(app)
      .post('/api/v1/personal/marcar')
      .set('Authorization', `Bearer ${token}`)
      .send({ lat: -17.393800, lng: -63.190500 });
    expect(res.status).toBe(409);

    const marcaciones = await MarcacionPersonal.count({ where: { usuario_id: usuarioId } });
    expect(marcaciones).toBe(1);
  });

  it('GET mi-estado devuelve la marcación abierta y el historial', async () => {
    await MarcacionPersonal.destroy({ where: { usuario_id: usuarioId } });
    await request(app).post('/api/v1/personal/marcar').set('Authorization', `Bearer ${token}`).send({ lat: -17.393800, lng: -63.190500 });

    const res = await request(app).get('/api/v1/personal/mi-estado').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.datos.marcacion_abierta).not.toBeNull();
    expect(res.body.datos.historial.length).toBeGreaterThanOrEqual(1);
    expect(res.body.datos.correccion_pendiente).toBeNull();
  });

  it('proponer-salida solo funciona sobre una marcación propia en cierre_automatico', async () => {
    await MarcacionPersonal.destroy({ where: { usuario_id: usuarioId } });
    const abierta = await MarcacionPersonal.create({
      usuario_id: usuarioId, sucursal_id: sucursal.id, fecha: '2026-09-20',
      hora_entrada: new Date('2026-09-20T08:00:00-04:00'), estado: 'abierto',
    });

    const rechazo = await request(app)
      .post(`/api/v1/personal/marcaciones/${abierta.id}/proponer-salida`)
      .set('Authorization', `Bearer ${token}`)
      .send({ hora_salida_propuesta: '2026-09-20T17:00:00-04:00' });
    expect(rechazo.status).toBe(409);

    await abierta.update({ estado: 'cierre_automatico', hora_salida: new Date('2026-09-20T16:00:00-04:00') });

    const res = await request(app)
      .post(`/api/v1/personal/marcaciones/${abierta.id}/proponer-salida`)
      .set('Authorization', `Bearer ${token}`)
      .send({ hora_salida_propuesta: '2026-09-20T17:00:00-04:00', nota_propuesta: 'Me quedé cerrando caja' });
    expect(res.status).toBe(200);
    expect(res.body.datos.nota_propuesta).toBe('Me quedé cerrando caja');

    const estado = await request(app).get('/api/v1/personal/mi-estado').set('Authorization', `Bearer ${token}`);
    expect(estado.body.datos.correccion_pendiente).toBeNull();
  });

  it('proponer-salida corrige el día cuando el turno cruza la medianoche', async () => {
    await MarcacionPersonal.destroy({ where: { usuario_id: usuarioId } });
    const nocturna = await MarcacionPersonal.create({
      usuario_id: usuarioId, sucursal_id: sucursal.id, fecha: '2026-09-15',
      hora_entrada: new Date('2026-09-15T22:00:00-04:00'), hora_salida: new Date('2026-09-15T06:00:00-04:00'),
      estado: 'cierre_automatico',
    });

    const res = await request(app)
      .post(`/api/v1/personal/marcaciones/${nocturna.id}/proponer-salida`)
      .set('Authorization', `Bearer ${token}`)
      .send({ hora_salida_propuesta: '2026-09-15T02:00:00-04:00' });
    expect(res.status).toBe(200);
    expect(new Date(res.body.datos.hora_salida_propuesta).toISOString()).toBe(new Date('2026-09-16T02:00:00-04:00').toISOString());

    await nocturna.destroy();
  });

  it('proponer-salida rechaza una hora más de 24 horas después de la entrada', async () => {
    await MarcacionPersonal.destroy({ where: { usuario_id: usuarioId } });
    const marcacion = await MarcacionPersonal.create({
      usuario_id: usuarioId, sucursal_id: sucursal.id, fecha: '2026-09-14',
      hora_entrada: new Date('2026-09-14T08:00:00-04:00'), hora_salida: new Date('2026-09-15T00:00:00-04:00'),
      estado: 'cierre_automatico',
    });

    const res = await request(app)
      .post(`/api/v1/personal/marcaciones/${marcacion.id}/proponer-salida`)
      .set('Authorization', `Bearer ${token}`)
      .send({ hora_salida_propuesta: '2026-09-16T09:00:00-04:00' });
    expect(res.status).toBe(400);

    await marcacion.destroy();
  });

  it('un empleado no puede proponer una hora de salida sobre la marcación de otro empleado', async () => {
    const otroHash = await bcrypt.hash('clave123', 10);
    const rol = await Rol.findOne({ where: { nombre: 'Mozo' } });
    const otro = await Usuario.create({
      rol_id: rol.id, nombre: 'Personal Otro Test',
      email: `personal-otro-test-${Date.now()}@restaurante.com`, contrasena: otroHash,
    });
    const ajena = await MarcacionPersonal.create({
      usuario_id: otro.id, sucursal_id: sucursal.id, fecha: '2026-09-18',
      hora_entrada: new Date('2026-09-18T08:00:00-04:00'), hora_salida: new Date('2026-09-18T16:00:00-04:00'),
      estado: 'cierre_automatico',
    });

    const res = await request(app)
      .post(`/api/v1/personal/marcaciones/${ajena.id}/proponer-salida`)
      .set('Authorization', `Bearer ${token}`)
      .send({ hora_salida_propuesta: '2026-09-18T17:00:00-04:00' });
    expect(res.status).toBe(404);

    await MarcacionPersonal.destroy({ where: { id: ajena.id } });
    await Usuario.destroy({ where: { id: otro.id } });
  });
});
