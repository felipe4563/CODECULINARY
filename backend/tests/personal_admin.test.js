const bcrypt = require('bcryptjs');
const request = require('supertest');
const app = require('../src/app');
const { Sucursal, Rol, Usuario, HorarioPersonal, MarcacionPersonal } = require('../src/models');

describe('Personal — administración (horarios, registros)', () => {
  let adminToken, mozoToken, sucursal, mozoId;

  beforeAll(async () => {
    const ts = Date.now();
    sucursal = await Sucursal.create({ nombre: `Sucursal Personal Admin Test ${ts}` });
    const rolMozo = await Rol.findOne({ where: { nombre: 'Mozo' } });
    const hash = await bcrypt.hash('clave123', 10);
    const mozo = await Usuario.create({
      rol_id: rolMozo.id, nombre: `Mozo Personal Test ${ts}`,
      email: `mozo-personal-test-${ts}@restaurante.com`, contrasena: hash,
    });
    mozoId = mozo.id;
    await mozo.addSucursal(sucursal);

    const loginAdmin = await request(app).post('/api/v1/auth/login').send({ email: 'admin@restaurante.com', contrasena: process.env.ADMIN_PASSWORD || 'admin123' });
    adminToken = loginAdmin.body.datos.token;

    const loginMozo = await request(app).post('/api/v1/auth/login').send({ email: mozo.email, contrasena: 'clave123' });
    mozoToken = loginMozo.body.datos.token;
  });

  afterAll(async () => {
    await MarcacionPersonal.destroy({ where: { usuario_id: mozoId } });
    await HorarioPersonal.destroy({ where: { usuario_id: mozoId } });
    await Usuario.destroy({ where: { id: mozoId } });
    await Sucursal.destroy({ where: { id: sucursal.id } });
  });

  it('un rol sin personal.administrar no puede ver /personal/filtros', async () => {
    const res = await request(app).get('/api/v1/personal/filtros').set('Authorization', `Bearer ${mozoToken}`);
    expect(res.status).toBe(403);
  });

  it('el admin ve sucursales y empleados en /personal/filtros', async () => {
    const res = await request(app).get('/api/v1/personal/filtros').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.datos.sucursales.some(s => s.id === sucursal.id)).toBe(true);
    expect(res.body.datos.empleados.some(e => e.id === mozoId)).toBe(true);
  });

  it('un horario nuevo devuelve los 7 días con trabaja=true por defecto', async () => {
    const res = await request(app).get(`/api/v1/personal/horarios/${mozoId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.datos).toHaveLength(7);
    expect(res.body.datos.every(d => d.trabaja === true)).toBe(true);
  });

  it('guarda un horario semanal con un día libre', async () => {
    const dias = Array.from({ length: 7 }, (_, dia_semana) => ({
      dia_semana,
      trabaja: dia_semana !== 0,
      hora_entrada: dia_semana !== 0 ? '08:00' : null,
      hora_salida: dia_semana !== 0 ? '17:00' : null,
    }));
    const res = await request(app)
      .put(`/api/v1/personal/horarios/${mozoId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ dias });
    expect(res.status).toBe(200);
    const domingo = res.body.datos.find(d => d.dia_semana === 0);
    expect(domingo.trabaja).toBe(false);
    expect(domingo.hora_entrada).toBeNull();
    const lunes = res.body.datos.find(d => d.dia_semana === 1);
    expect(lunes.hora_entrada).toBe('08:00:00');
  });

  it('rechaza un día laboral sin horas', async () => {
    const dias = Array.from({ length: 7 }, (_, dia_semana) => ({ dia_semana, trabaja: true, hora_entrada: null, hora_salida: null }));
    const res = await request(app)
      .put(`/api/v1/personal/horarios/${mozoId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ dias });
    expect(res.status).toBe(400);
  });

  it('rechaza un horario con un dia_semana duplicado', async () => {
    const dias = Array.from({ length: 7 }, (_, i) => ({
      dia_semana: i === 6 ? 5 : i,
      trabaja: true, hora_entrada: '08:00', hora_salida: '17:00',
    }));
    const res = await request(app)
      .put(`/api/v1/personal/horarios/${mozoId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ dias });
    expect(res.status).toBe(400);
  });

  it('lista marcaciones filtradas por sucursal y empleado', async () => {
    await MarcacionPersonal.create({
      usuario_id: mozoId, sucursal_id: sucursal.id, fecha: '2026-09-25',
      hora_entrada: new Date('2026-09-25T08:00:00-04:00'), hora_salida: new Date('2026-09-25T17:00:00-04:00'), estado: 'cerrado',
    });
    const res = await request(app)
      .get('/api/v1/personal/marcaciones')
      .query({ sucursal_id: sucursal.id, usuario_id: mozoId })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.datos.length).toBeGreaterThanOrEqual(1);
    expect(res.body.datos[0].usuario.id).toBe(mozoId);
  });

  it('resuelve una marcación en cierre_automatico', async () => {
    const marcacion = await MarcacionPersonal.create({
      usuario_id: mozoId, sucursal_id: sucursal.id, fecha: '2026-09-24',
      hora_entrada: new Date('2026-09-24T08:00:00-04:00'), hora_salida: new Date('2026-09-24T16:00:00-04:00'),
      estado: 'cierre_automatico', hora_salida_propuesta: new Date('2026-09-24T17:30:00-04:00'),
    });
    const res = await request(app)
      .patch(`/api/v1/personal/marcaciones/${marcacion.id}/resolver`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ hora_salida: '2026-09-24T17:30:00-04:00' });
    expect(res.status).toBe(200);
    expect(res.body.datos.estado).toBe('cerrado');
    expect(res.body.datos.aprobado_por).not.toBeNull();
  });

  it('resolver corrige el día cuando la salida aprobada cruza la medianoche', async () => {
    const marcacion = await MarcacionPersonal.create({
      usuario_id: mozoId, sucursal_id: sucursal.id, fecha: '2026-09-16',
      hora_entrada: new Date('2026-09-16T22:00:00-04:00'), hora_salida: new Date('2026-09-16T06:00:00-04:00'),
      estado: 'cierre_automatico',
    });
    const res = await request(app)
      .patch(`/api/v1/personal/marcaciones/${marcacion.id}/resolver`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ hora_salida: '2026-09-16T02:00:00-04:00' });
    expect(res.status).toBe(200);
    expect(new Date(res.body.datos.hora_salida).toISOString()).toBe(new Date('2026-09-17T02:00:00-04:00').toISOString());
  });

  it('resolver rechaza una hora_salida más de 24 horas después de la entrada', async () => {
    const marcacion = await MarcacionPersonal.create({
      usuario_id: mozoId, sucursal_id: sucursal.id, fecha: '2026-09-17',
      hora_entrada: new Date('2026-09-17T08:00:00-04:00'), hora_salida: new Date('2026-09-17T20:00:00-04:00'),
      estado: 'cierre_automatico',
    });
    const res = await request(app)
      .patch(`/api/v1/personal/marcaciones/${marcacion.id}/resolver`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ hora_salida: '2026-09-19T09:00:00-04:00' });
    expect(res.status).toBe(400);
  });

  it('resolver sin hora_salida devuelve 400', async () => {
    const marcacion = await MarcacionPersonal.create({
      usuario_id: mozoId, sucursal_id: sucursal.id, fecha: '2026-09-19',
      hora_entrada: new Date('2026-09-19T08:00:00-04:00'), hora_salida: new Date('2026-09-19T16:00:00-04:00'),
      estado: 'cierre_automatico',
    });
    const res = await request(app)
      .patch(`/api/v1/personal/marcaciones/${marcacion.id}/resolver`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('no permite resolver una marcación que ya está cerrada', async () => {
    const marcacion = await MarcacionPersonal.create({
      usuario_id: mozoId, sucursal_id: sucursal.id, fecha: '2026-09-23',
      hora_entrada: new Date('2026-09-23T08:00:00-04:00'), hora_salida: new Date('2026-09-23T17:00:00-04:00'), estado: 'cerrado',
    });
    const res = await request(app)
      .patch(`/api/v1/personal/marcaciones/${marcacion.id}/resolver`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ hora_salida: '2026-09-23T18:00:00-04:00' });
    expect(res.status).toBe(409);
  });
});
