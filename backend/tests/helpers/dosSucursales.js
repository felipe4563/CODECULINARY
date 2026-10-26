const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../../src/app');
const { Usuario, Rol, Sucursal, sequelize } = require('../../src/models');

// Crea dos sucursales con un administrador cada una y un usuario global
// (acceso a todas las sucursales), y devuelve sus tokens. Para tests del
// catálogo por sucursal. `limpiar()` borra todo lo creado, incluido el
// catálogo que los tests hayan creado en esas sucursales.
async function crearDosSucursales() {
  const sufijo = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const rol = await Rol.findOne({ where: { nombre: 'Administrador' } });
  const hash = await bcrypt.hash('clave123', 10);

  const sucursalA = await Sucursal.create({ nombre: `Sucursal Cat A ${sufijo}` });
  const sucursalB = await Sucursal.create({ nombre: `Sucursal Cat B ${sufijo}` });

  const crearUsuario = (prefijo, extra = {}) => Usuario.create({
    rol_id: rol.id, nombre: `Admin ${prefijo} ${sufijo}`, email: `cat-${prefijo}-${sufijo}@restaurante.com`,
    contrasena: hash, ...extra,
  });
  const usuarioA = await crearUsuario('a');
  await usuarioA.addSucursales([sucursalA]);
  const usuarioB = await crearUsuario('b');
  await usuarioB.addSucursales([sucursalB]);
  const usuarioGlobal = await crearUsuario('g', { acceso_todas_sucursales: 1 });

  const loginDirecto = async (usuario) => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: usuario.email, contrasena: 'clave123' });
    return res.body.datos.token;
  };
  const tokenA = await loginDirecto(usuarioA);
  const tokenB = await loginDirecto(usuarioB);

  const loginG = await request(app).post('/api/v1/auth/login').send({ email: usuarioGlobal.email, contrasena: 'clave123' });
  const eleccion = await request(app).post('/api/v1/auth/login/sucursal')
    .send({ pre_token: loginG.body.datos.pre_token, sucursal_id: null });
  const tokenGlobal = eleccion.body.datos.token;

  async function limpiar() {
    const ids = [sucursalA.id, sucursalB.id];
    const q = (sql) => sequelize.query(sql, { replacements: { ids } });
    // Catálogo creado en estas sucursales, en orden seguro por FKs.
    await q('DELETE FROM promocion_productos WHERE promocion_id IN (SELECT id FROM promociones WHERE sucursal_id IN (:ids))');
    await q('DELETE FROM promociones WHERE sucursal_id IN (:ids)');
    await q('DELETE FROM combo_productos WHERE combo_id IN (SELECT id FROM combos WHERE sucursal_id IN (:ids))');
    await q('DELETE FROM combos WHERE sucursal_id IN (:ids)');
    await q('DELETE FROM producto_grupos_opciones WHERE producto_id IN (SELECT id FROM productos WHERE sucursal_id IN (:ids))');
    await q('DELETE FROM producto_stock_sucursal WHERE producto_id IN (SELECT id FROM productos WHERE sucursal_id IN (:ids))');
    await q('DELETE FROM productos WHERE sucursal_id IN (:ids)');
    await q('DELETE FROM grupos_opciones WHERE sucursal_id IN (:ids)');
    await q('DELETE FROM categorias WHERE sucursal_id IN (:ids)');
    await Usuario.destroy({ where: { id: [usuarioA.id, usuarioB.id, usuarioGlobal.id] } });
    await Sucursal.destroy({ where: { id: ids } });
  }

  return { sucursalA, sucursalB, tokenA, tokenB, tokenGlobal, limpiar };
}

module.exports = { crearDosSucursales };
