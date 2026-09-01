const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../src/app');
const { Sucursal, Area, Mesa, Categoria, Producto, SesionCaja, LibroCaja, Pedido, DetallePedido, Caja, Rol, Usuario, GrupoOpciones, Opcion, DetallePedidoOpcion } = require('../src/models');

describe('Reportes filtrados por sucursal', () => {
  let adminToken, sucursalOtra, pedidoOtraSucursalId, pedidoPropioId, cajaOtra;

  beforeAll(async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'admin@restaurante.com', contrasena: process.env.ADMIN_PASSWORD || 'admin123' });
    adminToken = login.body.datos.token;
    const sucursalPropiaId = login.body.datos.usuario.sucursal_activa.id;

    sucursalOtra = await Sucursal.create({ nombre: 'Sucursal Reportes Test' });
    const categoria = await Categoria.create({ nombre: 'Categoria Reportes Test' });
    const producto = await Producto.create({ categoria_id: categoria.id, nombre: 'Producto Reportes Test', precio: 6, stock: null });
    cajaOtra = await Caja.create({ sucursal_id: sucursalOtra.id, nombre: 'Caja Reportes Test' });
    const sesion = await SesionCaja.create({ usuario_id: 1, sucursal_id: sucursalOtra.id, caja_id: cajaOtra.id, monto_apertura: 0 });
    const pedido = await Pedido.create({
      sucursal_id: sucursalOtra.id, usuario_id: 1, sesion_caja_id: sesion.id, tipo: 'llevar',
      estado: 'completado', total: 6,
    });
    pedidoOtraSucursalId = pedido.id;

    // Fixture: the dev DB has no completado pedidos in the admin's own sucursal,
    // so create one to exercise the "sucursal incluida en cada fila" assertion.
    const pedidoPropio = await Pedido.create({
      sucursal_id: sucursalPropiaId, usuario_id: 1, tipo: 'llevar',
      estado: 'completado', total: 6,
    });
    pedidoPropioId = pedidoPropio.id;

    this._cleanup = { producto, categoria, sesion, pedido };
  });

  afterAll(async () => {
    await Pedido.destroy({ where: { id: pedidoPropioId } });
    await Pedido.destroy({ where: { id: pedidoOtraSucursalId } });
    await SesionCaja.destroy({ where: { sucursal_id: sucursalOtra.id } });
    await Caja.destroy({ where: { sucursal_id: sucursalOtra.id } });
    await Sucursal.destroy({ where: { id: sucursalOtra.id } });
  });

  it('el reporte de ventas del admin (sucursal Principal) no incluye pedidos de otra sucursal', async () => {
    const res = await request(app)
      .get('/api/v1/reportes/ventas')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.datos.filas.find(p => p.id === pedidoOtraSucursalId)).toBeUndefined();
  });

  it('el reporte de ventas incluye el objeto sucursal en cada fila', async () => {
    const res = await request(app)
      .get('/api/v1/reportes/ventas')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.datos.filas.length).toBeGreaterThan(0);
    expect(res.body.datos.filas[0].sucursal).toHaveProperty('id');
    expect(res.body.datos.filas[0].sucursal).toHaveProperty('nombre');
  });

  it('el reporte de caja filtra por sucursal e incluye el objeto sucursal en cada fila', async () => {
    const sesionOtra = await SesionCaja.create({ usuario_id: 1, sucursal_id: sucursalOtra.id, caja_id: cajaOtra.id, monto_apertura: 0 });
    const registroOtra = await LibroCaja.create({
      sesion_caja_id: sesionOtra.id, usuario_id: 1, tipo: 'ingreso', concepto: 'Test caja otra sucursal', monto: 50, metodo_pago: 'efectivo',
    });

    const res = await request(app)
      .get('/api/v1/reportes/caja')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.datos.find(r => r.id === registroOtra.id)).toBeUndefined();

    if (res.body.datos.length > 0) {
      expect(res.body.datos[0].sucursal).toHaveProperty('id');
      expect(res.body.datos[0].sucursal).toHaveProperty('nombre');
    }

    await LibroCaja.destroy({ where: { id: registroOtra.id } });
    await SesionCaja.destroy({ where: { id: sesionOtra.id } });
  });
});

describe('alcance por sucursal en /api/v1/reportes/*', () => {
  const timestamp = Date.now();
  let sucursalAId, sucursalBId, usuarioAdminId, usuarioAId;
  let tokenAdmin, tokenUsuarioSucursalA, pedidoAId, pedidoBId;

  beforeAll(async () => {
    const sucursalA = await Sucursal.create({ nombre: `Sucursal Reportes Alcance A ${timestamp}` });
    const sucursalB = await Sucursal.create({ nombre: `Sucursal Reportes Alcance B ${timestamp}` });
    sucursalAId = sucursalA.id;
    sucursalBId = sucursalB.id;

    const rol = await Rol.findOne({ where: { nombre: 'Administrador' } });
    const hash = await bcrypt.hash('clave123', 10);

    const usuarioAdmin = await Usuario.create({
      rol_id: rol.id, nombre: `Reportes Alcance Admin ${timestamp}`,
      email: `reportes-alcance-admin-${timestamp}@restaurante.com`, contrasena: hash,
      acceso_todas_sucursales: 1,
    });
    usuarioAdminId = usuarioAdmin.id;

    const usuarioA = await Usuario.create({
      rol_id: rol.id, nombre: `Reportes Alcance Usuario A ${timestamp}`,
      email: `reportes-alcance-usuario-a-${timestamp}@restaurante.com`, contrasena: hash,
      acceso_todas_sucursales: 0,
    });
    await usuarioA.addSucursal(sucursalA);
    usuarioAId = usuarioA.id;

    const pedidoA = await Pedido.create({
      sucursal_id: sucursalA.id, usuario_id: 1, tipo: 'llevar', estado: 'completado', total: 10,
    });
    pedidoAId = pedidoA.id;
    const pedidoB = await Pedido.create({
      sucursal_id: sucursalB.id, usuario_id: 1, tipo: 'llevar', estado: 'completado', total: 10,
    });
    pedidoBId = pedidoB.id;

    const loginAdmin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: `reportes-alcance-admin-${timestamp}@restaurante.com`, contrasena: 'clave123' });
    const sucursalTodas = loginAdmin.body.datos.sucursales.find(s => s.id === null);
    const loginAdminSucursal = await request(app)
      .post('/api/v1/auth/login/sucursal')
      .send({ pre_token: loginAdmin.body.datos.pre_token, sucursal_id: sucursalTodas.id });
    tokenAdmin = loginAdminSucursal.body.datos.token;

    const loginUsuarioA = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: `reportes-alcance-usuario-a-${timestamp}@restaurante.com`, contrasena: 'clave123' });
    tokenUsuarioSucursalA = loginUsuarioA.body.datos.token;
  });

  afterAll(async () => {
    await Pedido.destroy({ where: { id: [pedidoAId, pedidoBId] } });
    await Usuario.destroy({ where: { id: [usuarioAdminId, usuarioAId] } });
    await Sucursal.destroy({ where: { id: [sucursalAId, sucursalBId] } });
  });

  test('un admin filtrando por sucursal_id en ventas recibe solo esa sucursal', async () => {
    const res = await request(app)
      .get(`/api/v1/reportes/ventas?sucursal_id=${sucursalBId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    const filas = Array.isArray(res.body.datos) ? res.body.datos : res.body.datos.filas;
    expect(filas.every(f => f.sucursal_id === sucursalBId || f.sucursal?.id === sucursalBId)).toBe(true);
    expect(filas.some(f => f.id === pedidoBId)).toBe(true);
  });

  test('un usuario no-admin no puede ver otra sucursal aunque la pida por query', async () => {
    const res = await request(app)
      .get(`/api/v1/reportes/ventas?sucursal_id=${sucursalBId}`)
      .set('Authorization', `Bearer ${tokenUsuarioSucursalA}`);
    expect(res.status).toBe(200);
    const filas = Array.isArray(res.body.datos) ? res.body.datos : res.body.datos.filas;
    expect(filas.every(f => (f.sucursal_id ?? f.sucursal?.id) === sucursalAId)).toBe(true);
  });
});

describe('GET /api/v1/reportes/ventas — paginación, resumen y filtros', () => {
  let token;

  beforeAll(async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'admin@restaurante.com', contrasena: process.env.ADMIN_PASSWORD || 'admin123' });
    token = login.body.datos.token;
  });

  test('pagina con limite por defecto y trae total_paginas', async () => {
    const res = await request(app)
      .get('/api/v1/reportes/ventas')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.datos).toHaveProperty('filas');
    expect(res.body.datos).toHaveProperty('total');
    expect(res.body.datos).toHaveProperty('total_paginas');
    expect(res.body.datos.filas.length).toBeLessThanOrEqual(res.body.datos.limite);
  });

  test('limite=0 devuelve todo sin paginar', async () => {
    const res = await request(app)
      .get('/api/v1/reportes/ventas?limite=0')
      .set('Authorization', `Bearer ${token}`);
    expect(res.body.datos.filas.length).toBe(res.body.datos.total);
  });

  test('filtro metodo_pago solo devuelve ventas con ese método', async () => {
    const res = await request(app)
      .get('/api/v1/reportes/ventas?metodo_pago=efectivo&limite=0')
      .set('Authorization', `Bearer ${token}`);
    expect(res.body.datos.filas.every(f => f.metodo_pago === 'efectivo')).toBe(true);
  });

  test('GET /api/v1/reportes/ventas/resumen devuelve totales y filtros', async () => {
    const res = await request(app)
      .get('/api/v1/reportes/ventas/resumen')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.datos.total_ventas).toBe('number');
    expect(typeof res.body.datos.ventas_efectivo).toBe('number');
    expect(typeof res.body.datos.ventas_qr).toBe('number');
    expect(Array.isArray(res.body.datos.filtros.cajeros)).toBe(true);
  });
});

describe('GET /api/v1/reportes/ventas/productos', () => {
  let token, categoria, producto, pedido, pedido2, detalle, detalle2;

  beforeAll(async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'admin@restaurante.com', contrasena: process.env.ADMIN_PASSWORD || 'admin123' });
    token = login.body.datos.token;

    categoria = await Categoria.create({ nombre: 'Categoria Ranking Test' });
    producto = await Producto.create({ categoria_id: categoria.id, nombre: 'Producto Ranking Test', precio: 8, stock: null });

    // Dos pedidos completados distintos con el MISMO producto, para probar que el
    // ranking se agrupa por producto_id (SUM entre filas) y no una fila por pedido.
    pedido = await Pedido.create({
      sucursal_id: login.body.datos.usuario.sucursal_activa.id, usuario_id: 1, tipo: 'llevar', estado: 'completado', total: 16,
    });
    detalle = await DetallePedido.create({ pedido_id: pedido.id, producto_id: producto.id, cantidad: 2, precio: 8 });

    pedido2 = await Pedido.create({
      sucursal_id: login.body.datos.usuario.sucursal_activa.id, usuario_id: 1, tipo: 'llevar', estado: 'completado', total: 15,
    });
    detalle2 = await DetallePedido.create({ pedido_id: pedido2.id, producto_id: producto.id, cantidad: 3, precio: 5 });
  });

  afterAll(async () => {
    await DetallePedido.destroy({ where: { id: [detalle.id, detalle2.id] } });
    await Pedido.destroy({ where: { id: [pedido.id, pedido2.id] } });
    await Producto.destroy({ where: { id: producto.id } });
    await Categoria.destroy({ where: { id: categoria.id } });
  });

  test('devuelve el ranking agrupado por producto, ordenado por cantidad', async () => {
    const res = await request(app)
      .get('/api/v1/reportes/ventas/productos')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.datos)).toBe(true);
    if (res.body.datos.length > 1) {
      expect(res.body.datos[0].cantidad).toBeGreaterThanOrEqual(res.body.datos[1].cantidad);
    }
    res.body.datos.forEach(p => {
      expect(['producto', 'combo']).toContain(p.tipo);
      expect(typeof p.cantidad).toBe('number');
      expect(typeof p.monto).toBe('number');
    });
  });

  test('suma cantidad y monto de un mismo producto entre varios pedidos en una unica fila', async () => {
    const res = await request(app)
      .get('/api/v1/reportes/ventas/productos')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);

    const filasProducto = res.body.datos.filter(p => p.id === producto.id);
    // Una sola fila para el producto: prueba que el GROUP BY es por producto_id
    // y no por fila de DetallePedido (que produciria dos filas aqui).
    expect(filasProducto.length).toBe(1);

    const fila = filasProducto[0];
    // cantidad: 2 (pedido 1) + 3 (pedido 2) = 5
    expect(fila.cantidad).toBe(5);
    // monto: (2 * 8) + (3 * 5) = 16 + 15 = 31
    expect(fila.monto).toBe(31);
  });
});

describe('GET /api/v1/reportes/ventas/variantes', () => {
  let token, categoria, producto, grupo, opcion, pedido, pedido2, pedido3, detalleSinOpciones, detalleConOpciones, detalleConOpciones2;

  beforeAll(async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'admin@restaurante.com', contrasena: process.env.ADMIN_PASSWORD || 'admin123' });
    token = login.body.datos.token;
    const sucursalId = login.body.datos.usuario.sucursal_activa.id;

    categoria = await Categoria.create({ nombre: 'Categoria Variantes Test' });
    producto = await Producto.create({ categoria_id: categoria.id, nombre: 'Producto Variantes Test', precio: 10, stock: null });
    grupo = await GrupoOpciones.create({ nombre: 'Grupo Variantes Test', tipo_seleccion: 'multiple' });
    opcion = await Opcion.create({ grupo_opciones_id: grupo.id, nombre: 'Extra queso' });

    // Pedido 1: mismo producto, SIN opciones.
    pedido = await Pedido.create({ sucursal_id: sucursalId, usuario_id: 1, tipo: 'llevar', estado: 'completado', total: 10 });
    detalleSinOpciones = await DetallePedido.create({ pedido_id: pedido.id, producto_id: producto.id, cantidad: 1, precio: 10 });

    // Pedido 2 y 3: mismo producto, CON la misma opción elegida — deben agruparse
    // juntos en una fila distinta de la del producto sin opciones (2 ventas, cantidad 2).
    pedido2 = await Pedido.create({ sucursal_id: sucursalId, usuario_id: 1, tipo: 'llevar', estado: 'completado', total: 12 });
    detalleConOpciones = await DetallePedido.create({ pedido_id: pedido2.id, producto_id: producto.id, cantidad: 1, precio: 12 });
    await DetallePedidoOpcion.create({ detalle_pedido_id: detalleConOpciones.id, opcion_id: opcion.id });

    pedido3 = await Pedido.create({ sucursal_id: sucursalId, usuario_id: 1, tipo: 'llevar', estado: 'completado', total: 12 });
    detalleConOpciones2 = await DetallePedido.create({ pedido_id: pedido3.id, producto_id: producto.id, cantidad: 1, precio: 12 });
    await DetallePedidoOpcion.create({ detalle_pedido_id: detalleConOpciones2.id, opcion_id: opcion.id });
  });

  afterAll(async () => {
    await DetallePedidoOpcion.destroy({ where: { detalle_pedido_id: [detalleConOpciones.id, detalleConOpciones2.id] } });
    await DetallePedido.destroy({ where: { id: [detalleSinOpciones.id, detalleConOpciones.id, detalleConOpciones2.id] } });
    await Pedido.destroy({ where: { id: [pedido.id, pedido2.id, pedido3.id] } });
    await Opcion.destroy({ where: { id: opcion.id } });
    await GrupoOpciones.destroy({ where: { id: grupo.id } });
    await Producto.destroy({ where: { id: producto.id } });
    await Categoria.destroy({ where: { id: categoria.id } });
  });

  test('devuelve el ranking agrupado por variante (producto + combinación de opciones)', async () => {
    const res = await request(app)
      .get('/api/v1/reportes/ventas/variantes')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.datos)).toBe(true);
    res.body.datos.forEach(v => {
      expect(typeof v.clave).toBe('string');
      expect(typeof v.nombre).toBe('string');
      expect(['kg', 'un']).toContain(v.unidad);
      expect(typeof v.conOpciones).toBe('boolean');
      expect(typeof v.cantidad).toBe('number');
      expect(typeof v.monto).toBe('number');
      expect(typeof v.ventas).toBe('number');
    });

    // La variante SIN opciones y la variante CON opciones del mismo producto
    // deben quedar en filas separadas, no fusionadas en una sola.
    const filasProducto = res.body.datos.filter(v => v.nombre.startsWith('Producto Variantes Test'));
    expect(filasProducto.length).toBe(2);

    const sinOpciones = filasProducto.find(v => v.conOpciones === false);
    const conOpciones = filasProducto.find(v => v.conOpciones === true);
    expect(sinOpciones).toBeTruthy();
    expect(conOpciones).toBeTruthy();
    expect(sinOpciones.nombre).toBe('Producto Variantes Test');
    expect(sinOpciones.cantidad).toBe(1);
    expect(sinOpciones.ventas).toBe(1);

    // Las dos ventas con la misma opción elegida se agrupan en una sola fila (SUM).
    expect(conOpciones.nombre).toBe('Producto Variantes Test — Extra queso');
    expect(conOpciones.cantidad).toBe(2);
    expect(conOpciones.ventas).toBe(2);
    expect(conOpciones.monto).toBe(24);
  });
});

describe('GET /api/v1/reportes/compras — paginación, resumen y filtro estado', () => {
  let token;

  beforeAll(async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'admin@restaurante.com', contrasena: process.env.ADMIN_PASSWORD || 'admin123' });
    token = login.body.datos.token;
  });

  test('pagina con limite por defecto', async () => {
    const res = await request(app)
      .get('/api/v1/reportes/compras')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.datos).toHaveProperty('filas');
    expect(res.body.datos).toHaveProperty('total_paginas');
  });

  test('filtro estado solo devuelve compras con ese estado', async () => {
    const res = await request(app)
      .get('/api/v1/reportes/compras?estado=recibido&limite=0')
      .set('Authorization', `Bearer ${token}`);
    expect(res.body.datos.filas.every(f => f.estado === 'recibido')).toBe(true);
  });

  test('GET /api/v1/reportes/compras/resumen devuelve totales', async () => {
    const res = await request(app)
      .get('/api/v1/reportes/compras/resumen')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.datos.total_comprado).toBe('number');
    expect(typeof res.body.datos.cantidad).toBe('number');
  });
});
