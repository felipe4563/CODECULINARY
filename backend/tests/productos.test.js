const request = require('supertest');
const app = require('../src/app');

describe('Productos API', () => {
  it('GET /api/v1/productos sin token → 401', async () => {
    const res = await request(app).get('/api/v1/productos');
    expect(res.status).toBe(401);
  });

  it('GET /api/v1/categorias sin token → 401', async () => {
    const res = await request(app).get('/api/v1/categorias');
    expect(res.status).toBe(401);
  });
});

const bcrypt = require('bcryptjs');
const { Sucursal, ProductoStockSucursal, Categoria, Usuario, Rol, Producto, GrupoOpciones, Opcion, Pedido, DetallePedido } = require('../src/models');

describe('Stock de productos por sucursal', () => {
  let adminToken, categoriaId, sucursalPrincipalId;

  beforeAll(async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'admin@restaurante.com', contrasena: process.env.ADMIN_PASSWORD || 'admin123' });
    adminToken = login.body.datos.token;
    const principal = await Sucursal.findOne({ where: { nombre: 'Sucursal Principal' } });
    sucursalPrincipalId = principal.id;

    const catRes = await request(app)
      .post('/api/v1/categorias')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Categoria Stock Productos Test' });
    categoriaId = catRes.body.datos.id;
  });

  it('crear un producto con stock inicial lo asigna a la sucursal activa del creador', async () => {
    const res = await request(app)
      .post('/api/v1/productos')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ categoria_id: categoriaId, nombre: 'Producto Stock Inicial Test', precio: 12, stock: 30 });

    expect(res.status).toBe(201);

    const fila = await ProductoStockSucursal.findOne({ where: { producto_id: res.body.datos.id, sucursal_id: sucursalPrincipalId } });
    expect(fila.stock).toBe(30);
  });

  it('el listado muestra el stock de la sucursal activa del usuario que consulta', async () => {
    const res = await request(app)
      .get('/api/v1/productos')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const creado = res.body.datos.find(p => p.nombre === 'Producto Stock Inicial Test');
    expect(creado.stock).toBe(30);
  });

  it('PUT /api/v1/productos/:id no crashea para un producto con stock (regresión)', async () => {
    const crearRes = await request(app)
      .post('/api/v1/productos')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ categoria_id: categoriaId, nombre: 'Producto Editar Stock Test', precio: 15, stock: 10 });

    expect(crearRes.status).toBe(201);

    const res = await request(app)
      .put(`/api/v1/productos/${crearRes.body.datos.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Producto Editado Test' });

    expect(res.status).toBe(200);
  });

  it('crear un producto con es_pesable=true lo persiste y se puede editar', async () => {
    const crearRes = await request(app)
      .post('/api/v1/productos')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ categoria_id: categoriaId, nombre: 'Chorizo Pesable Test', precio: 27, es_pesable: true });

    expect(crearRes.status).toBe(201);
    expect(crearRes.body.datos.es_pesable).toBe(1);

    const editarRes = await request(app)
      .put(`/api/v1/productos/${crearRes.body.datos.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ es_pesable: false });

    expect(editarRes.status).toBe(200);
    expect(editarRes.body.datos.es_pesable).toBe(0);
  });
});

describe('Productos — stock inicial con acceso a todas las sucursales', () => {
  let categoriaId, sucursalX, usuarioTodasId, tokenTodas;

  beforeAll(async () => {
    const categoria = await Categoria.create({ nombre: 'Categoria Stock Inicial Todas Test' });
    categoriaId = categoria.id;
    sucursalX = await Sucursal.create({ nombre: 'Sucursal Stock Inicial Todas X' });

    const rolAdmin = await Rol.findOne({ where: { nombre: 'Administrador' } });
    const hash = await bcrypt.hash('clave123', 10);
    const todas = await Usuario.create({
      rol_id: rolAdmin.id, nombre: 'Productos Acceso Todas Test', email: 'productos-todas-test@restaurante.com',
      contrasena: hash, acceso_todas_sucursales: 1,
    });
    usuarioTodasId = todas.id;
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'productos-todas-test@restaurante.com', contrasena: 'clave123' });
    const elegido = await request(app).post('/api/v1/auth/login/sucursal').send({ pre_token: login.body.datos.pre_token, sucursal_id: null });
    tokenTodas = elegido.body.datos.token;
  });

  afterAll(async () => {
    await Producto.destroy({ where: { categoria_id: categoriaId } });
    await Categoria.destroy({ where: { id: categoriaId } });
    await Usuario.destroy({ where: { id: usuarioTodasId } });
    await Sucursal.destroy({ where: { id: sucursalX.id } });
  });

  it('acceso-todas creando producto con stock y sin sucursal_id → 400', async () => {
    const res = await request(app)
      .post('/api/v1/productos')
      .set('Authorization', `Bearer ${tokenTodas}`)
      .send({ categoria_id: categoriaId, nombre: 'Producto Sin Sucursal Test', precio: 10, stock: 20 });
    expect(res.status).toBe(400);
  });

  it('acceso-todas creando producto con stock y sucursal_id válido → asigna el stock ahí', async () => {
    const res = await request(app)
      .post('/api/v1/productos')
      .set('Authorization', `Bearer ${tokenTodas}`)
      .send({ categoria_id: categoriaId, nombre: 'Producto Con Sucursal Test', precio: 10, stock: 20, sucursal_id: sucursalX.id });
    expect(res.status).toBe(201);

    const stock = await ProductoStockSucursal.findOne({ where: { producto_id: res.body.datos.id, sucursal_id: sucursalX.id } });
    expect(stock.stock).toBe(20);
  });

  it('acceso-todas creando producto sin stock no requiere sucursal_id', async () => {
    const res = await request(app)
      .post('/api/v1/productos')
      .set('Authorization', `Bearer ${tokenTodas}`)
      .send({ categoria_id: categoriaId, nombre: 'Producto Sin Stock Inicial Test', precio: 10 });
    expect(res.status).toBe(201);
  });

  it('acceso-todas creando producto con stock y sucursal_id inexistente → 404 y no crea el producto', async () => {
    const antes = await Producto.count({ where: { categoria_id: categoriaId } });
    const res = await request(app)
      .post('/api/v1/productos')
      .set('Authorization', `Bearer ${tokenTodas}`)
      .send({ categoria_id: categoriaId, nombre: 'Producto Sucursal Inexistente Test', precio: 10, stock: 20, sucursal_id: 999999 });
    expect(res.status).toBe(404);

    const despues = await Producto.count({ where: { categoria_id: categoriaId } });
    expect(despues).toBe(antes); // no quedó huérfano
  });
});

describe('Productos — grupo de opciones', () => {
  let categoriaId, grupoId, adminToken;

  beforeAll(async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'admin@restaurante.com', contrasena: process.env.ADMIN_PASSWORD || 'admin123' });
    adminToken = login.body.datos.token;

    const categoria = await Categoria.create({ nombre: 'Categoria Grupo Opciones Productos Test' });
    categoriaId = categoria.id;

    const grupo = await GrupoOpciones.create({ nombre: 'Término Productos Test' });
    await Opcion.create({ grupo_opciones_id: grupo.id, nombre: 'Jugoso', orden: 1 });
    grupoId = grupo.id;
  });

  afterAll(async () => {
    await Producto.destroy({ where: { categoria_id: categoriaId } });
    await Categoria.destroy({ where: { id: categoriaId } });
    await Opcion.destroy({ where: { grupo_opciones_id: grupoId } });
    await GrupoOpciones.destroy({ where: { id: grupoId } });
  });

  it('crea un producto con grupo_opciones_id y lo devuelve con sus opciones', async () => {
    const crear = await request(app)
      .post('/api/v1/productos')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ categoria_id: categoriaId, nombre: 'Picaña Test', precio: 85, grupo_opciones_id: grupoId });

    expect(crear.status).toBe(201);
    expect(crear.body.datos.grupo_opciones.nombre).toBe('Término Productos Test');
    expect(crear.body.datos.grupo_opciones.opciones.map(o => o.nombre)).toEqual(['Jugoso']);
  });

  it('GET /productos incluye grupo_opciones cuando está asignado', async () => {
    const res = await request(app).get('/api/v1/productos').set('Authorization', `Bearer ${adminToken}`);
    const creado = res.body.datos.find(p => p.nombre === 'Picaña Test');
    expect(creado.grupo_opciones.id).toBe(grupoId);
  });

  it('un producto sin grupo asignado devuelve grupo_opciones null', async () => {
    const crear = await request(app)
      .post('/api/v1/productos')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ categoria_id: categoriaId, nombre: 'Producto Sin Grupo Test', precio: 20 });

    expect(crear.body.datos.grupo_opciones).toBeNull();
  });
});

describe('Productos — eliminar y filtro de inactivos', () => {
  let adminToken, categoriaId, sucursalId, usuarioId;

  beforeAll(async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'admin@restaurante.com', contrasena: process.env.ADMIN_PASSWORD || 'admin123' });
    adminToken = login.body.datos.token;

    const admin = await Usuario.findOne({ where: { email: 'admin@restaurante.com' } });
    usuarioId = admin.id;
    const principal = await Sucursal.findOne({ where: { nombre: 'Sucursal Principal' } });
    sucursalId = principal.id;

    const categoria = await Categoria.create({ nombre: 'Categoria Eliminar Productos Test' });
    categoriaId = categoria.id;
  });

  afterAll(async () => {
    await Producto.destroy({ where: { categoria_id: categoriaId } });
    await Categoria.destroy({ where: { id: categoriaId } });
  });

  it('DELETE de un producto sin ventas lo borra de verdad', async () => {
    const crear = await request(app)
      .post('/api/v1/productos')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ categoria_id: categoriaId, nombre: 'Producto Sin Ventas Test', precio: 10 });
    const productoId = crear.body.datos.id;

    const res = await request(app)
      .delete(`/api/v1/productos/${productoId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.datos.eliminado).toBe(true);

    const enBd = await Producto.findByPk(productoId);
    expect(enBd).toBeNull();
  });

  it('DELETE de un producto con ventas lo desactiva en vez de borrarlo', async () => {
    const crear = await request(app)
      .post('/api/v1/productos')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ categoria_id: categoriaId, nombre: 'Producto Con Ventas Test', precio: 10 });
    const productoId = crear.body.datos.id;

    const pedido = await Pedido.create({ sucursal_id: sucursalId, usuario_id: usuarioId, estado: 'completado' });
    await DetallePedido.create({ pedido_id: pedido.id, producto_id: productoId, cantidad: 1, precio: 10 });

    const res = await request(app)
      .delete(`/api/v1/productos/${productoId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.datos.eliminado).toBe(false);

    const enBd = await Producto.findByPk(productoId);
    expect(enBd).not.toBeNull();
    expect(enBd.activo).toBe(0);

    await DetallePedido.destroy({ where: { pedido_id: pedido.id } });
    await Pedido.destroy({ where: { id: pedido.id } });
  });

  it('GET /productos por defecto solo trae activos', async () => {
    const activo = await Producto.create({ categoria_id: categoriaId, nombre: 'Producto Activo Filtro Test', precio: 10, activo: 1 });
    const inactivo = await Producto.create({ categoria_id: categoriaId, nombre: 'Producto Inactivo Filtro Test', precio: 10, activo: 0 });

    const res = await request(app).get('/api/v1/productos').set('Authorization', `Bearer ${adminToken}`);

    const nombres = res.body.datos.map(p => p.nombre);
    expect(nombres).toContain(activo.nombre);
    expect(nombres).not.toContain(inactivo.nombre);
  });

  it('GET /productos?solo_inactivos=true solo trae inactivos, no mezcla con activos', async () => {
    const activo = await Producto.create({ categoria_id: categoriaId, nombre: 'Producto Activo Filtro 2 Test', precio: 10, activo: 1 });
    const inactivo = await Producto.create({ categoria_id: categoriaId, nombre: 'Producto Inactivo Filtro 2 Test', precio: 10, activo: 0 });

    const res = await request(app)
      .get('/api/v1/productos?solo_inactivos=true')
      .set('Authorization', `Bearer ${adminToken}`);

    const nombres = res.body.datos.map(p => p.nombre);
    expect(nombres).toContain(inactivo.nombre);
    expect(nombres).not.toContain(activo.nombre);
  });
});
