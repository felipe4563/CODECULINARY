const request = require('supertest');
const app = require('../src/app');

describe('Libro Caja API', () => {
  it('GET /api/v1/libro-caja sin token → 401', async () => {
    const res = await request(app).get('/api/v1/libro-caja');
    expect(res.status).toBe(401);
  });
});

const bcrypt = require('bcryptjs');
const {
  Sucursal, Rol, Usuario, Caja, SesionCaja, LibroCaja,
} = require('../src/models');

describe('Libro Caja — aislamiento entre sucursales', () => {
  let sucursalA, sucursalB, usuarioAId, usuarioBId, tokenA, tokenB, cajaAId, cajaBId, sesionAId, sesionBId, movimientoAId;

  beforeAll(async () => {
    sucursalA = await Sucursal.create({ nombre: 'Sucursal LibroCaja Test A' });
    sucursalB = await Sucursal.create({ nombre: 'Sucursal LibroCaja Test B' });

    const rol = await Rol.findOne({ where: { nombre: 'Cajero' } });
    const hash = await bcrypt.hash('clave123', 10);

    const usuarioA = await Usuario.create({ rol_id: rol.id, nombre: 'LibroCaja Test A', email: 'librocaja-a-test@restaurante.com', contrasena: hash });
    await usuarioA.addSucursal(sucursalA);
    usuarioAId = usuarioA.id;

    const usuarioB = await Usuario.create({ rol_id: rol.id, nombre: 'LibroCaja Test B', email: 'librocaja-b-test@restaurante.com', contrasena: hash });
    await usuarioB.addSucursal(sucursalB);
    usuarioBId = usuarioB.id;

    const loginA = await request(app).post('/api/v1/auth/login').send({ email: 'librocaja-a-test@restaurante.com', contrasena: 'clave123' });
    tokenA = loginA.body.datos.token;
    const loginB = await request(app).post('/api/v1/auth/login').send({ email: 'librocaja-b-test@restaurante.com', contrasena: 'clave123' });
    tokenB = loginB.body.datos.token;

    const cajaA = await Caja.create({ sucursal_id: sucursalA.id, nombre: 'Caja LibroCaja Test A' });
    cajaAId = cajaA.id;
    const cajaB = await Caja.create({ sucursal_id: sucursalB.id, nombre: 'Caja LibroCaja Test B' });
    cajaBId = cajaB.id;

    const sesionA = await SesionCaja.create({ usuario_id: usuarioAId, sucursal_id: sucursalA.id, caja_id: cajaAId, monto_apertura: 0 });
    sesionAId = sesionA.id;
    const sesionB = await SesionCaja.create({ usuario_id: usuarioBId, sucursal_id: sucursalB.id, caja_id: cajaBId, monto_apertura: 0 });
    sesionBId = sesionB.id;

    const movimientoA = await request(app)
      .post('/api/v1/libro-caja')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ sesion_caja_id: sesionAId, tipo: 'ingreso', concepto: 'Movimiento A', monto: 50 });
    movimientoAId = movimientoA.body.datos.id;
  });

  afterAll(async () => {
    // El test "Sin sesión" crea un movimiento con sesion_caja_id NULL — filtrar
    // solo por sesion_caja_id lo deja huérfano y rompe el Usuario.destroy de
    // abajo por la FK, así que acá se filtra también por usuario_id.
    await LibroCaja.destroy({ where: { usuario_id: [usuarioAId, usuarioBId] } });
    await SesionCaja.destroy({ where: { id: [sesionAId, sesionBId] } });
    await Caja.destroy({ where: { id: [cajaAId, cajaBId] } });
    await Usuario.destroy({ where: { id: [usuarioAId, usuarioBId] } });
    await Sucursal.destroy({ where: { id: [sucursalA.id, sucursalB.id] } });
  });

  it('un usuario de la sucursal B NO ve los movimientos de la sucursal A al listar sin filtro', async () => {
    const res = await request(app)
      .get('/api/v1/libro-caja')
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(200);
    const ids = res.body.datos.filas.map((m) => m.id);
    expect(ids).not.toContain(movimientoAId);
  });

  it('un usuario de la sucursal A sí ve su propio movimiento al listar sin filtro', async () => {
    const res = await request(app)
      .get('/api/v1/libro-caja')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    const ids = res.body.datos.filas.map((m) => m.id);
    expect(ids).toContain(movimientoAId);
  });

  it('un usuario de otra sucursal NO puede listar filtrando por un sesion_caja_id ajeno (404)', async () => {
    const res = await request(app)
      .get('/api/v1/libro-caja')
      .query({ sesion_caja_id: sesionAId })
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(404);
  });

  it('un usuario de otra sucursal NO puede ver el resumen filtrando por un sesion_caja_id ajeno (404)', async () => {
    const res = await request(app)
      .get('/api/v1/libro-caja/resumen')
      .query({ sesion_caja_id: sesionAId })
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(404);
  });

  it('un usuario de otra sucursal NO puede crear un movimiento en una sesión de caja ajena (404)', async () => {
    const res = await request(app)
      .post('/api/v1/libro-caja')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ sesion_caja_id: sesionAId, tipo: 'ingreso', concepto: 'Intento ajeno', monto: 10 });

    expect(res.status).toBe(404);

    const entradas = await LibroCaja.count({ where: { sesion_caja_id: sesionAId } });
    expect(entradas).toBe(1); // solo el movimiento original, no se creó el intruso
  });

  it('POST /api/v1/libro-caja sin sesion_caja_id → lo crea igual, sin sesión asociada (gasto/ingreso fuera de caja)', async () => {
    const res = await request(app)
      .post('/api/v1/libro-caja')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ tipo: 'ingreso', concepto: 'Sin sesión', monto: 10 });

    expect(res.status).toBe(201);
    expect(res.body.datos.sesion_caja_id).toBeNull();
  });

  it('un egreso en efectivo registrado por Libro de Caja suma a total_gastos de la sesión (regresión)', async () => {
    const antes = await SesionCaja.findByPk(sesionAId);
    const gastosAntes = parseFloat(antes.total_gastos);

    const res = await request(app)
      .post('/api/v1/libro-caja')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ sesion_caja_id: sesionAId, tipo: 'egreso', concepto: 'Pago proveedor Test', monto: 25 });

    expect(res.status).toBe(201);

    const despues = await SesionCaja.findByPk(sesionAId);
    expect(parseFloat(despues.total_gastos)).toBe(gastosAntes + 25);
  });

  it('un egreso por QR no suma a total_gastos (no sale efectivo de la caja)', async () => {
    const antes = await SesionCaja.findByPk(sesionAId);
    const gastosAntes = parseFloat(antes.total_gastos);

    const res = await request(app)
      .post('/api/v1/libro-caja')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ sesion_caja_id: sesionAId, tipo: 'egreso', concepto: 'Egreso QR Test', monto: 15, metodo_pago: 'qr' });

    expect(res.status).toBe(201);

    const despues = await SesionCaja.findByPk(sesionAId);
    expect(parseFloat(despues.total_gastos)).toBe(gastosAntes);
  });

  it('un ingreso no suma a total_gastos', async () => {
    const antes = await SesionCaja.findByPk(sesionAId);
    const gastosAntes = parseFloat(antes.total_gastos);

    const res = await request(app)
      .post('/api/v1/libro-caja')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ sesion_caja_id: sesionAId, tipo: 'ingreso', concepto: 'Ingreso Test', monto: 30 });

    expect(res.status).toBe(201);

    const despues = await SesionCaja.findByPk(sesionAId);
    expect(parseFloat(despues.total_gastos)).toBe(gastosAntes);
  });
});

describe('paginación y resumen de libro-caja', () => {
  let token;
  let idsCreados = [];

  beforeAll(async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'admin@restaurante.com', contrasena: process.env.ADMIN_PASSWORD || 'admin123' });
    token = login.body.datos.token;

    const sufijo = Date.now();
    for (let i = 0; i < 25; i++) {
      const res = await request(app)
        .post('/api/v1/libro-caja')
        .set('Authorization', `Bearer ${token}`)
        .send({ tipo: i % 2 === 0 ? 'ingreso' : 'egreso', concepto: `Movimiento paginación ${sufijo}-${i}`, monto: 10 + i });
      idsCreados.push(res.body.datos.id);
    }
  });

  afterAll(async () => {
    const { LibroCaja } = require('../src/models');
    await LibroCaja.destroy({ where: { id: idsCreados } });
  });

  test('GET /api/v1/libro-caja pagina con limite por defecto 20', async () => {
    const res = await request(app)
      .get('/api/v1/libro-caja')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.datos.limite).toBe(20);
    expect(res.body.datos.filas.length).toBeLessThanOrEqual(20);
    expect(res.body.datos.total).toBeGreaterThanOrEqual(25);
    expect(res.body.datos.total_paginas).toBe(Math.ceil(res.body.datos.total / 20));
  });

  test('GET /api/v1/libro-caja respeta pagina y limite explícitos', async () => {
    const pagina1 = await request(app)
      .get('/api/v1/libro-caja?limite=5&pagina=1')
      .set('Authorization', `Bearer ${token}`);
    const pagina2 = await request(app)
      .get('/api/v1/libro-caja?limite=5&pagina=2')
      .set('Authorization', `Bearer ${token}`);
    expect(pagina1.body.datos.filas.length).toBe(5);
    expect(pagina2.body.datos.filas.length).toBe(5);
    expect(pagina1.body.datos.filas[0].id).not.toBe(pagina2.body.datos.filas[0].id);
  });

  test('GET /api/v1/libro-caja?limite=0 devuelve todo sin paginar', async () => {
    const res = await request(app)
      .get('/api/v1/libro-caja?limite=0')
      .set('Authorization', `Bearer ${token}`);
    expect(res.body.datos.filas.length).toBe(res.body.datos.total);
    expect(res.body.datos.total_paginas).toBe(1);
  });

  test('GET /api/v1/libro-caja?tipo=ingreso filtra por tipo', async () => {
    const res = await request(app)
      .get('/api/v1/libro-caja?tipo=ingreso&limite=0')
      .set('Authorization', `Bearer ${token}`);
    expect(res.body.datos.filas.every(f => f.tipo === 'ingreso')).toBe(true);
  });

  test('GET /api/v1/libro-caja?busqueda= filtra por concepto', async () => {
    const sufijo = idsCreados.length; // no se usa el valor, solo confirma que hay fixtures
    const res = await request(app)
      .get(`/api/v1/libro-caja?busqueda=paginación&limite=0`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.body.datos.filas.length).toBeGreaterThanOrEqual(25);
    expect(res.body.datos.filas.every(f => f.concepto.includes('paginación'))).toBe(true);
  });

  test('GET /api/v1/libro-caja/resumen devuelve totales y cajeros', async () => {
    const res = await request(app)
      .get('/api/v1/libro-caja/resumen?busqueda=paginación')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.datos.total_ingresos).toBe('number');
    expect(typeof res.body.datos.total_egresos).toBe('number');
    expect(res.body.datos.cantidad).toBeGreaterThanOrEqual(25);
    expect(Array.isArray(res.body.datos.filtros.cajeros)).toBe(true);
    expect(res.body.datos.filtros.cajeros.some(c => c.id != null)).toBe(true);
  });

  test('GET /api/v1/libro-caja/resumen?tipo=ingreso deja total_egresos en 0 (no el total sin filtrar)', async () => {
    const res = await request(app)
      .get('/api/v1/libro-caja/resumen?busqueda=paginación&tipo=ingreso')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.datos.total_egresos).toBe(0);
    expect(res.body.datos.total_ingresos).toBeGreaterThan(0);
  });

  test('GET /api/v1/libro-caja/resumen?tipo=egreso deja total_ingresos en 0 (no el total sin filtrar)', async () => {
    const res = await request(app)
      .get('/api/v1/libro-caja/resumen?busqueda=paginación&tipo=egreso')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.datos.total_ingresos).toBe(0);
    expect(res.body.datos.total_egresos).toBeGreaterThan(0);
  });
});
