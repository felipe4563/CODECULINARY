# Opciones por producto dentro de combos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir elegir, al agregar un combo al carrito (en Ventas y en Autoservicio), las opciones de cada producto componente que las tenga — igual que ya se puede para un producto suelto.

**Architecture:** Se agrega una tabla nueva `detalle_pedido_combo_opciones` (`detalle_pedido_id + producto_id + opcion_id`) en vez de "explotar" el combo en varias filas de `detalle_pedidos` — el combo sigue siendo UNA sola fila, así que tickets, reportes y edición/borrado de ítems no cambian. El backend valida y persiste las opciones elegidas por producto dentro del combo; el frontend encadena el modal de opciones ya existente, una vez por producto opcionable del combo.

**Tech Stack:** Node/Express/Sequelize (MariaDB), React/Vite, Jest+Supertest (backend). El frontend no tiene test runner — sus tareas se verifican con `npx eslint <archivo>` + `npm run build`.

**Spec:** `docs/superpowers/specs/2026-09-07-opciones-en-combos-design.md`

## Global Constraints

- El `precio_adicional` de cada opción elegida se suma al precio del combo (recalculado siempre en el backend, nunca confiando en lo que mande el cliente).
- La obligatoriedad de un grupo (`producto_grupos_opciones.obligatorio`) se enforce SOLO en el frontend — el backend no valida "obligatorio" para ningún caso (ni productos sueltos ni combos), no se introduce inconsistencia.
- Un producto dentro de un combo con cantidad > 1 se elige UNA sola vez (no una elección por unidad).
- NO se permite editar in-place las opciones de un combo ya agregado — hay que quitarlo y volver a agregarlo (mismo criterio que un producto suelto).
- NO se toca el descuento de insumos/stock por combo (`_finalizarVenta`) — las opciones nunca cambiaron qué insumos se descuentan.
- NO se "explota" el combo en varias filas de `detalle_pedidos` — sigue siendo una sola fila.
- Las opciones elegidas SÍ se muestran en los 4 archivos de ticket (`ticketVenta.js`, `ticketCocina.js`, `escpos.js`, `print-agent/agent.js`).
- `PedidoPage.jsx` (agregar ítems a un pedido de mesa YA EXISTENTE) queda fuera de alcance de esta ronda de UI: hoy ese flujo ni siquiera abre el selector de opciones para un producto suelto con `grupos_opciones` (agrega directo sin preguntar) — construir la cadena de opciones para combos ahí sería una capacidad inconsistente con lo que existe para productos en esa misma pantalla. El backend (`agregarItem`, Tarea 4) sí soporta el contrato completo, listo para cuando se decida cerrar esa brecha en una ronda aparte.

---

### Task 1: Tabla `detalle_pedido_combo_opciones` — migración, modelo y asociaciones

**Files:**
- Create: `backend/database/migrations/043_opciones_combo.sql`
- Create: `backend/src/models/DetallePedidoComboOpcion.js`
- Modify: `backend/src/models/index.js:62` (require), `:195-197` (asociaciones), `:204-224` (exports)
- Modify: `bd/bd_codeculinary.sql` (mantener sincronizado el baseline de producción, igual que se hizo para las migraciones 039-042 en esta misma sesión)
- Test: `backend/tests/detalle_pedido_combo_opciones.test.js`

**Interfaces:**
- Produces: modelo `DetallePedidoComboOpcion` exportado desde `backend/src/models/index.js`, con columnas `detalle_pedido_id`, `producto_id`, `opcion_id` (PK compuesta), y la asociación `DetallePedido.hasMany(DetallePedidoComboOpcion, { as: 'combo_opciones' })` — las tareas 3, 4 y 5 lo consumen.

- [ ] **Step 1: Crear la migración**

```sql
-- backend/database/migrations/043_opciones_combo.sql
-- Opciones elegidas por producto dentro de un combo. Ver
-- docs/superpowers/specs/2026-09-07-opciones-en-combos-design.md — el combo
-- sigue siendo UNA sola fila en detalle_pedidos; esta tabla guarda, aparte,
-- qué opción se eligió para cada producto componente.

CREATE TABLE detalle_pedido_combo_opciones (
  detalle_pedido_id INT UNSIGNED NOT NULL,
  producto_id INT UNSIGNED NOT NULL,
  opcion_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (detalle_pedido_id, producto_id, opcion_id),
  FOREIGN KEY (detalle_pedido_id) REFERENCES detalle_pedidos(id) ON DELETE CASCADE,
  FOREIGN KEY (producto_id) REFERENCES productos(id),
  FOREIGN KEY (opcion_id) REFERENCES opciones(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Step 2: Aplicar la migración a la base de datos de desarrollo**

Run (desde `backend/`):
```bash
node -e "require('dotenv').config(); const sequelize=require('./src/config/database'); const fs=require('fs'); sequelize.query(fs.readFileSync('database/migrations/043_opciones_combo.sql','utf8')).then(()=>{console.log('ok');process.exit(0);}).catch(e=>{console.error(e.message);process.exit(1);});"
```
Expected: imprime `ok` sin errores.

- [ ] **Step 3: Crear el modelo**

```js
// backend/src/models/DetallePedidoComboOpcion.js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Opción elegida para un producto específico dentro de un combo — ver
// docs/superpowers/specs/2026-09-07-opciones-en-combos-design.md. A
// diferencia de DetallePedidoOpcion (para productos sueltos), acá hace
// falta el campo `producto_id` porque un combo es UNA sola fila de
// DetallePedido que puede contener varios productos, cada uno con su
// propia elección.
const DetallePedidoComboOpcion = sequelize.define('DetallePedidoComboOpcion', {
  detalle_pedido_id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true },
  producto_id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true },
  opcion_id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true },
}, { tableName: 'detalle_pedido_combo_opciones', timestamps: false });

module.exports = DetallePedidoComboOpcion;
```

- [ ] **Step 4: Registrar el modelo y sus asociaciones en `backend/src/models/index.js`**

En la línea 62, después de `const DetallePedidoOpcion = require('./DetallePedidoOpcion');`, agregar:
```js
const DetallePedidoComboOpcion = require('./DetallePedidoComboOpcion');
```

Después de la línea 197 (`Opcion.belongsToMany(DetallePedido, ...)`), agregar:
```js

// Opciones elegidas por producto dentro de un combo (ver migración 043) —
// el combo sigue siendo una sola fila de DetallePedido; esta tabla guarda,
// por separado, qué opción se eligió para cada producto componente.
DetallePedido.hasMany(DetallePedidoComboOpcion, { foreignKey: 'detalle_pedido_id', as: 'combo_opciones' });
DetallePedidoComboOpcion.belongsTo(DetallePedido, { foreignKey: 'detalle_pedido_id' });
DetallePedidoComboOpcion.belongsTo(Producto, { foreignKey: 'producto_id', as: 'producto' });
DetallePedidoComboOpcion.belongsTo(Opcion, { foreignKey: 'opcion_id', as: 'opcion' });
```

En `module.exports` (línea 223), agregar `DetallePedidoComboOpcion` junto a `DetallePedidoOpcion`:
```js
  Insumo, InsumoStockSucursal, InsumoMovimiento, RecetaInsumo, DetallePedidoOpcion, DetallePedidoComboOpcion,
```

- [ ] **Step 5: Sincronizar `bd/bd_codeculinary.sql`** (baseline de provisión de restaurantes nuevos)

Agregar el `CREATE TABLE detalle_pedido_combo_opciones` (mismas columnas que la migración) después del bloque de `cliente_pin_verificaciones`, más sus bloques de "Indices", "AUTO_INCREMENT" (no aplica — sin columna autoincremental, esta tabla no necesita bloque de AUTO_INCREMENT) y "Filtros" (constraints), siguiendo exactamente el mismo patrón usado para `cliente_pin_verificaciones` en esta misma sesión (estructura primero, índices en su sección, filtros/FK en la suya).

- [ ] **Step 6: Escribir el test de la cascada de borrado**

```js
// backend/tests/detalle_pedido_combo_opciones.test.js
const {
  Sucursal, Area, Mesa, Categoria, Producto, ProductoStockSucursal, Usuario, Rol,
  SesionCaja, Pedido, DetallePedido, GrupoOpciones, Opcion, Combo, ComboProducto,
  DetallePedidoComboOpcion,
} = require('../src/models');
const bcrypt = require('bcryptjs');

describe('DetallePedidoComboOpcion — cascada de borrado', () => {
  let sucursalId, usuarioId, sesionId, pedidoId, detalleId, opcionId, productoId;

  beforeAll(async () => {
    const sucursal = await Sucursal.create({ nombre: 'Sucursal Combo Opciones Test' });
    sucursalId = sucursal.id;
    const rol = await Rol.findOne({ where: { nombre: 'Cajero' } });
    const hash = await bcrypt.hash('clave123', 10);
    const usuario = await Usuario.create({ rol_id: rol.id, nombre: 'Combo Opciones Test', email: 'combo-opciones-test@restaurante.com', contrasena: hash });
    usuarioId = usuario.id;
    const sesion = await SesionCaja.create({ usuario_id: usuarioId, sucursal_id: sucursalId, monto_apertura: 0 });
    sesionId = sesion.id;

    const categoria = await Categoria.create({ nombre: 'Categoria Combo Opciones Test' });
    const producto = await Producto.create({ categoria_id: categoria.id, nombre: 'Producto Combo Opciones Test', precio: 5, stock: 0 });
    productoId = producto.id;

    const grupo = await GrupoOpciones.create({ nombre: 'Tamaño Combo Opciones Test', tipo_seleccion: 'unica' });
    const opcion = await Opcion.create({ grupo_opciones_id: grupo.id, nombre: 'Grande', precio_adicional: 3, orden: 0 });
    opcionId = opcion.id;

    const combo = await Combo.create({ nombre: 'Combo Test Cascada', precio: 20 });
    await ComboProducto.create({ combo_id: combo.id, producto_id: productoId, cantidad: 1 });

    const pedido = await Pedido.create({
      sucursal_id: sucursalId, usuario_id: usuarioId, sesion_caja_id: sesionId,
      tipo: 'llevar', estado: 'completado', total: 23,
    });
    pedidoId = pedido.id;
    const detalle = await DetallePedido.create({ pedido_id: pedido.id, combo_id: combo.id, cantidad: 1, precio: 23 });
    detalleId = detalle.id;
    await DetallePedidoComboOpcion.create({ detalle_pedido_id: detalleId, producto_id: productoId, opcion_id: opcionId });
  });

  afterAll(async () => {
    await Pedido.destroy({ where: { id: pedidoId } });
    await SesionCaja.destroy({ where: { id: sesionId } });
    await Usuario.destroy({ where: { id: usuarioId } });
    await Sucursal.destroy({ where: { id: sucursalId } });
  });

  it('la fila de opciones existe antes de borrar el detalle', async () => {
    const filas = await DetallePedidoComboOpcion.findAll({ where: { detalle_pedido_id: detalleId } });
    expect(filas.length).toBe(1);
  });

  it('borrar el DetallePedido borra en cascada sus filas de detalle_pedido_combo_opciones', async () => {
    await DetallePedido.destroy({ where: { id: detalleId } });
    const filas = await DetallePedidoComboOpcion.findAll({ where: { detalle_pedido_id: detalleId } });
    expect(filas.length).toBe(0);
  });
});
```

- [ ] **Step 7: Correr el test**

Run: `cd backend && npx jest tests/detalle_pedido_combo_opciones.test.js`
Expected: 2 passing.

- [ ] **Step 8: Commit**

```bash
git add backend/database/migrations/043_opciones_combo.sql backend/src/models/DetallePedidoComboOpcion.js backend/src/models/index.js bd/bd_codeculinary.sql backend/tests/detalle_pedido_combo_opciones.test.js
git commit -m "feat(combos): tabla detalle_pedido_combo_opciones + modelo + cascada"
```

---

### Task 2: `combos.service.js` incluye `grupos_opciones` por producto componente

**Files:**
- Modify: `backend/src/modules/productos/productos.service.js:273` (exports)
- Modify: `backend/src/modules/combos/combos.service.js:1-6` (imports e `INCLUDE_PRODUCTOS`), `:8-22` (`listar`, `listarActivos`, `obtener`)
- Test: `backend/tests/combos.test.js`

**Interfaces:**
- Consumes: `DetallePedidoComboOpcion` no se usa acá — esta tarea es independiente de la Tarea 1.
- Produces: `combos.service.listar()`, `listarActivos()` y `obtener()` devuelven cada `combo.productos[i].grupos_opciones` ya normalizado (forma `{id, nombre, tipo_seleccion, orden, obligatorio, opciones:[{id,nombre,precio_adicional,orden}]}`) — la Tarea 7 (VentasPage) y Tarea 8 (AutoservicioPage) lo consumen para decidir si abrir el selector de opciones.

- [ ] **Step 1: Exportar `_normalizarGruposOpciones` desde `productos.service.js`**

En `backend/src/modules/productos/productos.service.js:273`, el export actual es:
```js
module.exports = { listarCategorias, crearCategoria, actualizarCategoria, eliminarCategoria, listarGruposOpciones, crearGrupoOpciones, actualizarGrupoOpciones, eliminarGrupoOpciones, listarProductos, obtenerProducto, crearProducto, actualizarProducto, eliminarProducto };
```
Cambiarlo a:
```js
module.exports = { listarCategorias, crearCategoria, actualizarCategoria, eliminarCategoria, listarGruposOpciones, crearGrupoOpciones, actualizarGrupoOpciones, eliminarGrupoOpciones, listarProductos, obtenerProducto, crearProducto, actualizarProducto, eliminarProducto, _normalizarGruposOpciones };
```

- [ ] **Step 2: Escribir el test que falla**

```js
// backend/tests/combos.test.js — agregar a la suite existente (o crearla si no existe)
const request = require('supertest');
const app = require('../src/app');
const { Sucursal, Usuario, Rol, Categoria, Producto, GrupoOpciones, Opcion, ProductoGrupoOpciones, Combo, ComboProducto } = require('../src/models');
const bcrypt = require('bcryptjs');

describe('Combos — grupos_opciones anidado', () => {
  let adminToken, categoriaId, productoId, grupoId, comboId;

  beforeAll(async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'admin@restaurante.com', contrasena: process.env.ADMIN_PASSWORD || 'admin123' });
    adminToken = login.body.datos.token;

    const categoria = await Categoria.create({ nombre: 'Categoria Combo Grupos Test' });
    categoriaId = categoria.id;
    const producto = await Producto.create({ categoria_id: categoriaId, nombre: 'Producto Combo Grupos Test', precio: 8, stock: 0 });
    productoId = producto.id;
    const grupo = await GrupoOpciones.create({ nombre: 'Tamaño Combo Grupos Test', tipo_seleccion: 'unica' });
    grupoId = grupo.id;
    await Opcion.create({ grupo_opciones_id: grupoId, nombre: 'Grande', precio_adicional: 2, orden: 0 });
    await ProductoGrupoOpciones.create({ producto_id: productoId, grupo_opciones_id: grupoId, orden: 0, obligatorio: 1 });

    const combo = await Combo.create({ nombre: 'Combo Grupos Test', precio: 15 });
    comboId = combo.id;
    await ComboProducto.create({ combo_id: comboId, producto_id: productoId, cantidad: 1 });
  });

  afterAll(async () => {
    await ComboProducto.destroy({ where: { combo_id: comboId } });
    await Combo.destroy({ where: { id: comboId } });
    await ProductoGrupoOpciones.destroy({ where: { producto_id: productoId } });
    await Opcion.destroy({ where: { grupo_opciones_id: grupoId } });
    await GrupoOpciones.destroy({ where: { id: grupoId } });
    await Producto.destroy({ where: { id: productoId } });
    await Categoria.destroy({ where: { id: categoriaId } });
  });

  it('GET /api/v1/combos incluye grupos_opciones anidado en cada producto del combo', async () => {
    const res = await request(app).get('/api/v1/combos').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const combo = res.body.datos.find((c) => c.id === comboId);
    expect(combo).toBeDefined();
    const producto = combo.productos.find((p) => p.id === productoId);
    expect(producto.grupos_opciones).toHaveLength(1);
    expect(producto.grupos_opciones[0].obligatorio).toBe(true);
    expect(producto.grupos_opciones[0].opciones[0].nombre).toBe('Grande');
    expect(producto.grupos_opciones[0].opciones[0].precio_adicional).toBe(2);
  });
});
```

- [ ] **Step 3: Correr el test para verificar que falla**

Run: `cd backend && npx jest tests/combos.test.js -t "grupos_opciones anidado"`
Expected: FAIL — `producto.grupos_opciones` es `undefined` (el include actual no lo trae).

- [ ] **Step 4: Modificar `combos.service.js`**

Reemplazar el archivo completo (agrega imports e include anidado, y normaliza los productos en las 3 funciones de lectura):

```js
const { Combo, ComboProducto, Producto, DetallePedido, GrupoOpciones, Opcion, sequelize } = require('../../models');
const { estaActivoHoy } = require('../../utils/disponibilidad');
const { _normalizarGruposOpciones } = require('../productos/productos.service');

const INCLUDE_PRODUCTOS = [
  {
    model: Producto, as: 'productos', attributes: ['id', 'nombre', 'precio'], through: { attributes: ['cantidad'] },
    include: [
      { model: GrupoOpciones, as: 'grupos_opciones', attributes: ['id', 'nombre', 'tipo_seleccion'],
        through: { attributes: ['orden', 'obligatorio'] },
        include: [{ model: Opcion, as: 'opciones', attributes: ['id', 'nombre', 'precio_adicional', 'orden'] }] },
    ],
  },
];

// Reusa la misma normalización que productos.service.js aplica a un producto
// suelto (aplana ProductoGrupoOpciones.orden/obligatorio, ordena opciones) —
// sin esto, SelectorOpcionModal no puede leer `grupo.obligatorio` porque
// vendría anidado bajo `ProductoGrupoOpciones` en vez de plano.
function _normalizarCombo(combo) {
  (combo.productos || []).forEach(_normalizarGruposOpciones);
  return combo;
}

async function listar() {
  const combos = await Combo.findAll({ include: INCLUDE_PRODUCTOS, order: [['nombre', 'ASC']] });
  return combos.map(_normalizarCombo);
}

// Combos vendibles ahora mismo (activos y dentro de su ventana de fechas/días) — para el POS.
async function listarActivos() {
  const combos = await Combo.findAll({ where: { activo: 1 }, include: INCLUDE_PRODUCTOS, order: [['nombre', 'ASC']] });
  return combos.filter((c) => estaActivoHoy(c)).map(_normalizarCombo);
}

async function obtener(id, transaction) {
  const combo = await Combo.findByPk(id, { include: INCLUDE_PRODUCTOS, transaction });
  if (!combo) throw Object.assign(new Error('Combo no encontrado'), { status: 404 });
  return _normalizarCombo(combo);
}

async function _sincronizarProductos(combo_id, productos, transaction) {
  if (!productos) return;
  if (productos.length === 0) {
    throw Object.assign(new Error('El combo debe incluir al menos un producto'), { status: 400 });
  }
  await ComboProducto.destroy({ where: { combo_id }, transaction });
  await ComboProducto.bulkCreate(
    productos.map((p) => ({ combo_id, producto_id: p.producto_id ?? p.id, cantidad: p.cantidad ?? 1 })),
    { transaction }
  );
}

async function crear({ nombre, descripcion, precio, imagen, activo = 1, fecha_inicio, fecha_fin, dias_semana, productos = [] }) {
  if (!nombre || !nombre.trim()) throw Object.assign(new Error('El nombre es requerido'), { status: 400 });
  if (!(parseFloat(precio) > 0)) throw Object.assign(new Error('El precio debe ser mayor a 0'), { status: 400 });
  if (!productos.length) throw Object.assign(new Error('El combo debe incluir al menos un producto'), { status: 400 });

  return sequelize.transaction(async (t) => {
    const combo = await Combo.create({
      nombre: nombre.trim(), descripcion, precio, imagen, activo, fecha_inicio: fecha_inicio || null, fecha_fin: fecha_fin || null, dias_semana: dias_semana || null,
    }, { transaction: t });
    await _sincronizarProductos(combo.id, productos, t);
    return obtener(combo.id, t);
  });
}

async function actualizar(id, { nombre, descripcion, precio, imagen, activo, fecha_inicio, fecha_fin, dias_semana, productos }) {
  const combo = await Combo.findByPk(id);
  if (!combo) throw Object.assign(new Error('Combo no encontrado'), { status: 404 });

  return sequelize.transaction(async (t) => {
    const datos = {};
    if (nombre !== undefined) datos.nombre = nombre.trim();
    if (descripcion !== undefined) datos.descripcion = descripcion;
    if (precio !== undefined) datos.precio = precio;
    if (imagen !== undefined) datos.imagen = imagen;
    if (activo !== undefined) datos.activo = activo;
    if (fecha_inicio !== undefined) datos.fecha_inicio = fecha_inicio || null;
    if (fecha_fin !== undefined) datos.fecha_fin = fecha_fin || null;
    if (dias_semana !== undefined) datos.dias_semana = dias_semana || null;
    await combo.update(datos, { transaction: t });
    await _sincronizarProductos(id, productos, t);
    return obtener(id, t);
  });
}

async function eliminar(id) {
  const combo = await Combo.findByPk(id);
  if (!combo) throw Object.assign(new Error('Combo no encontrado'), { status: 404 });
  const tieneVentas = await DetallePedido.count({ where: { combo_id: id } });
  if (tieneVentas > 0) {
    await combo.update({ activo: 0 });
    return { eliminado: false };
  }
  await combo.destroy();
  return { eliminado: true };
}

module.exports = { listar, listarActivos, obtener, crear, actualizar, eliminar };
```

- [ ] **Step 5: Correr el test para verificar que pasa**

Run: `cd backend && npx jest tests/combos.test.js -t "grupos_opciones anidado"`
Expected: PASS.

- [ ] **Step 6: Correr toda la suite de combos y ventas para descartar regresiones**

Run: `cd backend && npx jest tests/combos.test.js tests/ventas.test.js`
Expected: todos en verde (la Tarea 2 no debería afectar ningún test existente — solo agrega un include).

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/productos/productos.service.js backend/src/modules/combos/combos.service.js backend/tests/combos.test.js
git commit -m "feat(combos): incluir grupos_opciones por producto componente"
```

---

### Task 3: `crearCompleta` acepta `opciones_por_producto` en ítems de combo

**Files:**
- Modify: `backend/src/modules/ventas/ventas.service.js:1-5` (imports), `:807-826` (bucle de armado de `productos`), `:866-881` (creación de `DetallePedido` por ítem)
- Test: `backend/tests/ventas.test.js`

**Interfaces:**
- Consumes: modelo `DetallePedidoComboOpcion` (Tarea 1), modelo `ComboProducto` (ya existente, solo hace falta importarlo en este archivo).
- Produces: el ítem de combo en el payload de `POST /ventas/completa` acepta `opciones_por_producto: [{producto_id, opcion_ids}]`. Función interna nueva `_validarOpcionesCombo(combo_id, opcionesPorProducto)` — devuelve el array validado o lanza 400. La Tarea 4 (`agregarItem`) reusa esta misma función.

- [ ] **Step 1: Escribir el test que falla (happy path + precio)**

Agregar a `backend/tests/ventas.test.js`, en un describe nuevo al final del archivo:

```js
describe('Ventas — opciones por producto dentro de un combo', () => {
  let sucursalId, usuarioId, cajaId, sesionId, token;
  let productoId, otroProductoId, grupoId, opcionId, comboId;

  beforeAll(async () => {
    const sucursal = await Sucursal.create({ nombre: 'Sucursal Combo Opciones Ventas Test' });
    sucursalId = sucursal.id;
    const rol = await Rol.findOne({ where: { nombre: 'Cajero' } });
    const hash = await bcrypt.hash('clave123', 10);
    const usuario = await Usuario.create({ rol_id: rol.id, nombre: 'Combo Opciones Ventas Test', email: 'combo-opciones-ventas-test@restaurante.com', contrasena: hash });
    usuarioId = usuario.id;
    await usuario.addSucursal(sucursal);
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'combo-opciones-ventas-test@restaurante.com', contrasena: 'clave123' });
    token = login.body.datos.token;

    const caja = await Caja.create({ sucursal_id: sucursalId, nombre: 'Caja Combo Opciones Ventas Test' });
    cajaId = caja.id;
    const sesion = await SesionCaja.create({ usuario_id: usuarioId, sucursal_id: sucursalId, caja_id: cajaId, monto_apertura: 0 });
    sesionId = sesion.id;

    const categoria = await Categoria.create({ nombre: 'Categoria Combo Opciones Ventas Test' });
    const producto = await Producto.create({ categoria_id: categoria.id, nombre: 'Producto Combo Opciones Ventas Test', precio: 10, stock: 0 });
    productoId = producto.id;
    await ProductoStockSucursal.create({ producto_id: productoId, sucursal_id: sucursalId, stock: 20 });
    const otroProducto = await Producto.create({ categoria_id: categoria.id, nombre: 'Otro Producto Combo Opciones Ventas Test', precio: 6, stock: 0 });
    otroProductoId = otroProducto.id;
    await ProductoStockSucursal.create({ producto_id: otroProductoId, sucursal_id: sucursalId, stock: 20 });

    const grupo = await GrupoOpciones.create({ nombre: 'Tamaño Combo Opciones Ventas Test', tipo_seleccion: 'unica' });
    grupoId = grupo.id;
    const opcion = await Opcion.create({ grupo_opciones_id: grupoId, nombre: 'Grande', precio_adicional: 3, orden: 0 });
    opcionId = opcion.id;

    const combo = await Combo.create({ nombre: 'Combo Opciones Ventas Test', precio: 20 });
    comboId = combo.id;
    await ComboProducto.create({ combo_id: comboId, producto_id: productoId, cantidad: 1 });
    await ComboProducto.create({ combo_id: comboId, producto_id: otroProductoId, cantidad: 1 });
  });

  afterAll(async () => {
    await Pedido.destroy({ where: { usuario_id: usuarioId } });
    await ComboProducto.destroy({ where: { combo_id: comboId } });
    await Combo.destroy({ where: { id: comboId } });
    await Opcion.destroy({ where: { grupo_opciones_id: grupoId } });
    await GrupoOpciones.destroy({ where: { id: grupoId } });
    await SesionCaja.destroy({ where: { id: sesionId } });
    await Caja.destroy({ where: { id: cajaId } });
    await ProductoStockSucursal.destroy({ where: { producto_id: [productoId, otroProductoId] } });
    await Producto.destroy({ where: { id: [productoId, otroProductoId] } });
    await Usuario.destroy({ where: { id: usuarioId } });
    await Sucursal.destroy({ where: { id: sucursalId } });
  });

  it('crearCompleta con combo + opción con precio_adicional suma el extra al total', async () => {
    const res = await request(app)
      .post('/api/v1/ventas/completa')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'llevar', metodo_pago: 'efectivo', monto_recibido: 30, sesion_caja_id: sesionId,
        items: [{ combo_id: comboId, cantidad: 1, opciones_por_producto: [{ producto_id: productoId, opcion_ids: [opcionId] }] }],
      });
    expect(res.status).toBe(201);
    expect(parseFloat(res.body.datos.total)).toBe(23); // 20 (combo) + 3 (opción)
  });

  it('crearCompleta con combo sin opciones elegidas sigue funcionando igual que antes', async () => {
    const res = await request(app)
      .post('/api/v1/ventas/completa')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'llevar', metodo_pago: 'efectivo', monto_recibido: 30, sesion_caja_id: sesionId,
        items: [{ combo_id: comboId, cantidad: 1 }],
      });
    expect(res.status).toBe(201);
    expect(parseFloat(res.body.datos.total)).toBe(20);
  });

  it('dos productos del mismo combo con opciones propias no se mezclan entre sí', async () => {
    const otraOpcion = await Opcion.create({ grupo_opciones_id: grupoId, nombre: 'Chico', precio_adicional: 0, orden: 1 });
    const res = await request(app)
      .post('/api/v1/ventas/completa')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'llevar', metodo_pago: 'efectivo', monto_recibido: 30, sesion_caja_id: sesionId,
        items: [{
          combo_id: comboId, cantidad: 1,
          opciones_por_producto: [
            { producto_id: productoId, opcion_ids: [opcionId] },
            { producto_id: otroProductoId, opcion_ids: [otraOpcion.id] },
          ],
        }],
      });
    expect(res.status).toBe(201);

    const { DetallePedido, DetallePedidoComboOpcion } = require('../src/models');
    const detalle = await DetallePedido.findOne({ where: { pedido_id: res.body.datos.id, combo_id: comboId } });
    const filas = await DetallePedidoComboOpcion.findAll({ where: { detalle_pedido_id: detalle.id } });
    expect(filas.map(f => `${f.producto_id}:${f.opcion_id}`).sort()).toEqual(
      [`${productoId}:${opcionId}`, `${otroProductoId}:${otraOpcion.id}`].sort()
    );
    await Opcion.destroy({ where: { id: otraOpcion.id } });
  });

  it('rechaza opciones_por_producto con un producto que no pertenece al combo', async () => {
    const productoAjeno = await Producto.create({ categoria_id: (await Categoria.findOne()).id, nombre: 'Producto Ajeno Combo Test', precio: 4, stock: 0 });
    const res = await request(app)
      .post('/api/v1/ventas/completa')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'llevar', metodo_pago: 'efectivo', monto_recibido: 30, sesion_caja_id: sesionId,
        items: [{ combo_id: comboId, cantidad: 1, opciones_por_producto: [{ producto_id: productoAjeno.id, opcion_ids: [] }] }],
      });
    expect(res.status).toBe(400);
    await Producto.destroy({ where: { id: productoAjeno.id } });
  });
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `cd backend && npx jest tests/ventas.test.js -t "opciones por producto dentro de un combo"`
Expected: FAIL — el total no incluye el extra (el backend ignora `opciones_por_producto` hoy), y el 4to test no rechaza nada (falta la validación).

- [ ] **Step 3: Agregar `ComboProducto` y `DetallePedidoComboOpcion` a los imports**

En `backend/src/modules/ventas/ventas.service.js:1-5`, el bloque actual es:
```js
const { Op } = require('sequelize');
const {
  Pedido, DetallePedido, Mesa, Producto, Cliente, SesionCaja, Caja, LibroCaja, Configuracion, PagoQr, Opcion, Combo, Promocion, Cupon,
  RecetaInsumo, DetallePedidoOpcion, sequelize,
} = require('../../models');
```
Reemplazarlo por:
```js
const { Op } = require('sequelize');
const {
  Pedido, DetallePedido, Mesa, Producto, Cliente, SesionCaja, Caja, LibroCaja, Configuracion, PagoQr, Opcion, Combo, ComboProducto, Promocion, Cupon,
  RecetaInsumo, DetallePedidoOpcion, DetallePedidoComboOpcion, sequelize,
} = require('../../models');
```

- [ ] **Step 4: Agregar la función de validación**

Justo después de la función `_extraPorOpciones` (la que suma `precio_adicional`, alrededor de la línea 34), agregar:
```js

// Valida que cada producto_id en opciones_por_producto realmente pertenezca
// al combo — evita que alguien mande opciones para un producto ajeno al
// combo. No valida "obligatorio": eso es solo del lado del frontend, igual
// que ya pasa hoy con productos sueltos.
async function _validarOpcionesCombo(combo_id, opcionesPorProducto = []) {
  if (!opcionesPorProducto || opcionesPorProducto.length === 0) return [];
  const comboProductos = await ComboProducto.findAll({ where: { combo_id }, attributes: ['producto_id'] });
  const idsValidos = new Set(comboProductos.map((cp) => cp.producto_id));
  for (const entrada of opcionesPorProducto) {
    if (!idsValidos.has(entrada.producto_id)) {
      throw Object.assign(new Error(`El producto ${entrada.producto_id} no pertenece a este combo`), { status: 400 });
    }
  }
  return opcionesPorProducto;
}
```

- [ ] **Step 5: Usar la validación y calcular el extra en el bucle de `crearCompleta`**

En `backend/src/modules/ventas/ventas.service.js:807-826`, el bloque actual es:
```js
  const productos = [];
  for (const item of items) {
    if (item.combo_id) {
      const combo = await Combo.findByPk(item.combo_id);
      if (!combo) throw Object.assign(new Error('Combo no encontrado'), { status: 404 });
      if (!combo.activo || !estaActivoHoy(combo)) {
        throw Object.assign(new Error(`El combo "${combo.nombre}" no está disponible`), { status: 409 });
      }
      const linea = { cantidad: item.cantidad ?? 1, precio: parseFloat(combo.precio), peso: null };
      productos.push({ item, combo, linea });
      continue;
    }
```
Reemplazarlo por:
```js
  const productos = [];
  for (const item of items) {
    if (item.combo_id) {
      const combo = await Combo.findByPk(item.combo_id);
      if (!combo) throw Object.assign(new Error('Combo no encontrado'), { status: 404 });
      if (!combo.activo || !estaActivoHoy(combo)) {
        throw Object.assign(new Error(`El combo "${combo.nombre}" no está disponible`), { status: 409 });
      }
      const opcionesPorProducto = await _validarOpcionesCombo(item.combo_id, item.opciones_por_producto);
      const extraCombo = await _extraPorOpciones(opcionesPorProducto.flatMap((o) => o.opcion_ids || []));
      const linea = { cantidad: item.cantidad ?? 1, precio: parseFloat(combo.precio) + extraCombo, peso: null };
      productos.push({ item, combo, linea, opcionesPorProducto });
      continue;
    }
```

- [ ] **Step 6: Persistir las filas de opciones al crear el `DetallePedido` del combo**

En `backend/src/modules/ventas/ventas.service.js:866-881`, el bloque actual es:
```js
    const detalles = [];
    for (const { item, combo, linea } of productos) {
      const detallePedido = await DetallePedido.create({
        pedido_id: pedido.id,
        producto_id: combo ? null : item.producto_id,
        combo_id: combo ? item.combo_id : null,
        cantidad: linea.cantidad, precio: linea.precio, peso: linea.peso, nota: item.nota,
      }, { transaction: t });
      if (!combo && item.opcion_ids?.length) {
        await DetallePedidoOpcion.bulkCreate(
          item.opcion_ids.map(opcion_id => ({ detalle_pedido_id: detallePedido.id, opcion_id })),
          { transaction: t },
        );
      }
      detalles.push({ id: detallePedido.id, producto_id: combo ? null : item.producto_id, combo_id: combo ? item.combo_id : null, cantidad: linea.cantidad, precio: linea.precio });
    }
```
Reemplazarlo por:
```js
    const detalles = [];
    for (const { item, combo, linea, opcionesPorProducto } of productos) {
      const detallePedido = await DetallePedido.create({
        pedido_id: pedido.id,
        producto_id: combo ? null : item.producto_id,
        combo_id: combo ? item.combo_id : null,
        cantidad: linea.cantidad, precio: linea.precio, peso: linea.peso, nota: item.nota,
      }, { transaction: t });
      if (!combo && item.opcion_ids?.length) {
        await DetallePedidoOpcion.bulkCreate(
          item.opcion_ids.map(opcion_id => ({ detalle_pedido_id: detallePedido.id, opcion_id })),
          { transaction: t },
        );
      }
      if (combo && opcionesPorProducto?.length) {
        const filas = opcionesPorProducto.flatMap((o) =>
          (o.opcion_ids || []).map((opcion_id) => ({ detalle_pedido_id: detallePedido.id, producto_id: o.producto_id, opcion_id }))
        );
        if (filas.length) await DetallePedidoComboOpcion.bulkCreate(filas, { transaction: t });
      }
      detalles.push({ id: detallePedido.id, producto_id: combo ? null : item.producto_id, combo_id: combo ? item.combo_id : null, cantidad: linea.cantidad, precio: linea.precio });
    }
```

- [ ] **Step 7: Correr los tests para verificar que pasan**

Run: `cd backend && npx jest tests/ventas.test.js -t "opciones por producto dentro de un combo"`
Expected: 4 passing.

- [ ] **Step 8: Correr toda la suite de ventas para descartar regresiones**

Run: `cd backend && npx jest tests/ventas.test.js`
Expected: todo en verde (salvo el flake preexistente de `numero_orden_diario` bajo orden completo de suite, ya documentado — confirmar corriéndolo aislado si aparece).

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/ventas/ventas.service.js backend/tests/ventas.test.js
git commit -m "feat(ventas): crearCompleta acepta opciones por producto dentro de un combo"
```

---

### Task 4: `agregarItem` acepta `opciones_por_producto` en ítems de combo

**Files:**
- Modify: `backend/src/modules/ventas/ventas.service.js:909-921` (rama de combo de `agregarItem`)
- Test: `backend/tests/ventas.test.js`

**Interfaces:**
- Consumes: `_validarOpcionesCombo` y `DetallePedidoComboOpcion` (Tarea 3).
- Produces: `POST /ventas/:id/items` acepta el mismo `opciones_por_producto` que `crearCompleta` para un ítem de combo.

- [ ] **Step 1: Escribir el test que falla**

Agregar al describe `Ventas — opciones por producto dentro de un combo` (mismo `beforeAll`/`afterAll` de la Tarea 3):

```js
  it('agregarItem con combo + opciones calcula el extra y persiste las filas', async () => {
    const pedidoBase = await request(app)
      .post('/api/v1/ventas')
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'llevar', sesion_caja_id: sesionId });
    const pedidoId = pedidoBase.body.datos.id;

    const res = await request(app)
      .post(`/api/v1/ventas/${pedidoId}/items`)
      .set('Authorization', `Bearer ${token}`)
      .send({ combo_id: comboId, cantidad: 1, opciones_por_producto: [{ producto_id: productoId, opcion_ids: [opcionId] }] });
    expect(res.status).toBe(201);
    expect(parseFloat(res.body.datos.precio)).toBe(23);

    const { DetallePedidoComboOpcion } = require('../src/models');
    const filas = await DetallePedidoComboOpcion.findAll({ where: { detalle_pedido_id: res.body.datos.id } });
    expect(filas).toHaveLength(1);
    expect(filas[0].opcion_id).toBe(opcionId);
  });

  it('agregarItem rechaza opciones_por_producto de un producto ajeno al combo', async () => {
    const pedidoBase = await request(app)
      .post('/api/v1/ventas')
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'llevar', sesion_caja_id: sesionId });
    const pedidoId = pedidoBase.body.datos.id;
    const productoAjeno = await Producto.create({ categoria_id: (await Categoria.findOne()).id, nombre: 'Producto Ajeno Agregar Item Test', precio: 4, stock: 0 });

    const res = await request(app)
      .post(`/api/v1/ventas/${pedidoId}/items`)
      .set('Authorization', `Bearer ${token}`)
      .send({ combo_id: comboId, cantidad: 1, opciones_por_producto: [{ producto_id: productoAjeno.id, opcion_ids: [] }] });
    expect(res.status).toBe(400);
    await Producto.destroy({ where: { id: productoAjeno.id } });
  });
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `cd backend && npx jest tests/ventas.test.js -t "agregarItem con combo|agregarItem rechaza"`
Expected: FAIL — `agregarItem` hoy ignora `opciones_por_producto` por completo (precio = 20, no 23; sin filas; sin rechazo de 400).

- [ ] **Step 3: Modificar la rama de combo de `agregarItem`**

En `backend/src/modules/ventas/ventas.service.js:909-921`, el bloque actual es:
```js
  if (combo_id) {
    const combo = await Combo.findByPk(combo_id);
    if (!combo) throw Object.assign(new Error('Combo no encontrado'), { status: 404 });
    if (!combo.activo || !estaActivoHoy(combo)) {
      throw Object.assign(new Error(`El combo "${combo.nombre}" no está disponible`), { status: 409 });
    }
    const item = await DetallePedido.create({
      pedido_id, combo_id, producto_id: null, cantidad, precio: parseFloat(combo.precio), peso: null, nota,
    });
    await _recalcularTotal(pedido_id);
    emitir('restaurante:actualizar', { tipo: 'pedido_items' });
    return item;
  }
```
Reemplazarlo por (nota: la firma de la función también gana `opciones_por_producto` en su destructuring, ver Step 4):
```js
  if (combo_id) {
    const combo = await Combo.findByPk(combo_id);
    if (!combo) throw Object.assign(new Error('Combo no encontrado'), { status: 404 });
    if (!combo.activo || !estaActivoHoy(combo)) {
      throw Object.assign(new Error(`El combo "${combo.nombre}" no está disponible`), { status: 409 });
    }
    const opcionesPorProductoValidadas = await _validarOpcionesCombo(combo_id, opciones_por_producto);
    const extraCombo = await _extraPorOpciones(opcionesPorProductoValidadas.flatMap((o) => o.opcion_ids || []));
    const item = await DetallePedido.create({
      pedido_id, combo_id, producto_id: null, cantidad, precio: parseFloat(combo.precio) + extraCombo, peso: null, nota,
    });
    if (opcionesPorProductoValidadas.length) {
      const filas = opcionesPorProductoValidadas.flatMap((o) =>
        (o.opcion_ids || []).map((opcion_id) => ({ detalle_pedido_id: item.id, producto_id: o.producto_id, opcion_id }))
      );
      if (filas.length) await DetallePedidoComboOpcion.bulkCreate(filas);
    }
    await _recalcularTotal(pedido_id);
    emitir('restaurante:actualizar', { tipo: 'pedido_items' });
    return item;
  }
```

- [ ] **Step 4: Agregar `opciones_por_producto` a la firma de la función**

La línea `async function agregarItem(pedido_id, { producto_id, combo_id, cantidad = 1, nota, peso, opcion_ids }, alcance) {` pasa a:
```js
async function agregarItem(pedido_id, { producto_id, combo_id, cantidad = 1, nota, peso, opcion_ids, opciones_por_producto }, alcance) {
```

- [ ] **Step 5: Correr los tests para verificar que pasan**

Run: `cd backend && npx jest tests/ventas.test.js -t "agregarItem con combo|agregarItem rechaza"`
Expected: 2 passing.

- [ ] **Step 6: Correr toda la suite de ventas**

Run: `cd backend && npx jest tests/ventas.test.js`
Expected: todo en verde.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/ventas/ventas.service.js backend/tests/ventas.test.js
git commit -m "feat(ventas): agregarItem acepta opciones por producto dentro de un combo"
```

---

### Task 5: `INCLUDE_PEDIDO_COMPLETO` expone `combo_opciones` en cada línea

**Files:**
- Modify: `backend/src/modules/ventas/ventas.service.js:147-161` (`INCLUDE_PEDIDO_COMPLETO`)
- Test: `backend/tests/ventas.test.js`

**Interfaces:**
- Consumes: la asociación `DetallePedido.hasMany(DetallePedidoComboOpcion, { as: 'combo_opciones' })` (Tarea 1).
- Produces: cualquier pedido leído vía `listar`, `listarCocina`, `obtener` (y por lo tanto `reimprimir`, `cobrar`, confirmación de pago QR) trae `detalles[].combo_opciones = [{producto_id, producto:{id,nombre}, opcion:{id,nombre,precio_adicional}}]` — la Tarea 9 (tickets) lo consume.

- [ ] **Step 1: Escribir el test que falla**

Agregar al describe `Ventas — opciones por producto dentro de un combo` (Tarea 3):

```js
  it('GET del pedido incluye combo_opciones con nombres de producto y opción', async () => {
    const creado = await request(app)
      .post('/api/v1/ventas/completa')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'llevar', metodo_pago: 'efectivo', monto_recibido: 30, sesion_caja_id: sesionId,
        items: [{ combo_id: comboId, cantidad: 1, opciones_por_producto: [{ producto_id: productoId, opcion_ids: [opcionId] }] }],
      });
    const pedidoId = creado.body.datos.id;

    const res = await request(app)
      .get(`/api/v1/ventas/${pedidoId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const detalleCombo = res.body.datos.detalles.find((d) => d.combo_id === comboId);
    expect(detalleCombo.combo_opciones).toHaveLength(1);
    expect(detalleCombo.combo_opciones[0].producto.nombre).toBe('Producto Combo Opciones Ventas Test');
    expect(detalleCombo.combo_opciones[0].opcion.nombre).toBe('Grande');
  });
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd backend && npx jest tests/ventas.test.js -t "GET del pedido incluye combo_opciones"`
Expected: FAIL — `detalleCombo.combo_opciones` es `undefined`.

- [ ] **Step 3: Agregar el include**

En `backend/src/modules/ventas/ventas.service.js:147-161`, el bloque actual es:
```js
const INCLUDE_PEDIDO_COMPLETO = [
  { model: Mesa, as: 'mesa', attributes: ['id', 'nombre', 'estado'] },
  { model: Cliente, as: 'cliente', attributes: ['id', 'nombre', 'numero_documento', 'puntos'] },
  {
    model: DetallePedido, as: 'detalles',
    include: [
      { model: Producto, as: 'producto', attributes: ['id', 'nombre', 'precio'], required: false },
      {
        model: Combo, as: 'combo', attributes: ['id', 'nombre', 'descripcion'], required: false,
        include: [{ model: Producto, as: 'productos', attributes: ['id', 'nombre'], through: { attributes: ['cantidad'] } }],
      },
    ],
  },
  { model: Cupon, as: 'cupon', attributes: ['id', 'codigo', 'tipo', 'valor'], required: false },
];
```
Reemplazarlo por:
```js
const INCLUDE_PEDIDO_COMPLETO = [
  { model: Mesa, as: 'mesa', attributes: ['id', 'nombre', 'estado'] },
  { model: Cliente, as: 'cliente', attributes: ['id', 'nombre', 'numero_documento', 'puntos'] },
  {
    model: DetallePedido, as: 'detalles',
    include: [
      { model: Producto, as: 'producto', attributes: ['id', 'nombre', 'precio'], required: false },
      {
        model: Combo, as: 'combo', attributes: ['id', 'nombre', 'descripcion'], required: false,
        include: [{ model: Producto, as: 'productos', attributes: ['id', 'nombre'], through: { attributes: ['cantidad'] } }],
      },
      {
        model: DetallePedidoComboOpcion, as: 'combo_opciones', required: false,
        include: [
          { model: Producto, as: 'producto', attributes: ['id', 'nombre'] },
          { model: Opcion, as: 'opcion', attributes: ['id', 'nombre', 'precio_adicional'] },
        ],
      },
    ],
  },
  { model: Cupon, as: 'cupon', attributes: ['id', 'codigo', 'tipo', 'valor'], required: false },
];
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `cd backend && npx jest tests/ventas.test.js -t "GET del pedido incluye combo_opciones"`
Expected: PASS.

- [ ] **Step 5: Correr toda la suite de ventas**

Run: `cd backend && npx jest tests/ventas.test.js`
Expected: todo en verde.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/ventas/ventas.service.js backend/tests/ventas.test.js
git commit -m "feat(ventas): INCLUDE_PEDIDO_COMPLETO expone combo_opciones por línea"
```

---

### Task 6: `SelectorOpcionModal` gana un `subtitulo` opcional

**Files:**
- Modify: `frontend/src/pages/ventas/components/SelectorOpcionModal.jsx:10`, `:71-76`

**Interfaces:**
- Produces: prop opcional `subtitulo` (string o `null`/`undefined`, default sin mostrar nada) — la Tarea 7 y la Tarea 8 lo usan para mostrar contexto ("Combo: X — Producto 2 de 3").

- [ ] **Step 1: Agregar el prop y renderizarlo**

En `frontend/src/pages/ventas/components/SelectorOpcionModal.jsx:10`, cambiar:
```js
export default function SelectorOpcionModal({ producto, onElegir, onClose }) {
```
por:
```js
export default function SelectorOpcionModal({ producto, subtitulo, onElegir, onClose }) {
```

En `frontend/src/pages/ventas/components/SelectorOpcionModal.jsx:71-76`, el bloque actual es:
```js
  return (
    <Modal titulo={`${producto.nombre} — ${grupoActual.nombre}`} onClose={onClose}>
      <div className="space-y-4">
        {grupos.length > 1 && (
          <p className="text-xs text-muted-foreground">Paso {paso + 1} de {grupos.length}</p>
        )}
```
Reemplazarlo por:
```js
  return (
    <Modal titulo={`${producto.nombre} — ${grupoActual.nombre}`} onClose={onClose}>
      <div className="space-y-4">
        {subtitulo && (
          <p className="text-xs font-medium text-primary">{subtitulo}</p>
        )}
        {grupos.length > 1 && (
          <p className="text-xs text-muted-foreground">Paso {paso + 1} de {grupos.length}</p>
        )}
```

- [ ] **Step 2: Verificar**

Run: `cd frontend && npx eslint src/pages/ventas/components/SelectorOpcionModal.jsx`
Expected: sin errores. (No hay test runner en el frontend de este proyecto — la verificación es lint + build, ver Tarea 7 para el build completo.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/ventas/components/SelectorOpcionModal.jsx
git commit -m "feat(ventas): SelectorOpcionModal admite un subtitulo opcional"
```

---

### Task 7: `VentasPage.jsx` — cadena de opciones al agregar un combo

**Files:**
- Modify: `frontend/src/pages/ventas/VentasPage.jsx:55` (nuevo estado), `:167-183` (reemplaza `agregarCombo`), `:604` (payload)

**Interfaces:**
- Consumes: `combo.productos[i].grupos_opciones` (Tarea 2), `SelectorOpcionModal` con `subtitulo` (Tarea 6), contrato `opciones_por_producto` (Tarea 3).
- Produces: cada línea de combo en `carrito` gana `opciones_por_producto: [{producto_id, opcion_ids}]` y `combo_opciones_key` (string, para no mezclar variantes distintas del mismo combo en una sola línea).

- [ ] **Step 1: Agregar el estado nuevo**

En `frontend/src/pages/ventas/VentasPage.jsx:55`, después de:
```js
  const [selectorOpcion, setSelectorOpcion] = useState(null); // producto con grupo_opciones, o null
```
agregar:
```js
  const [colaOpcionesCombo, setColaOpcionesCombo] = useState(null); // { combo, pendientes: [producto...], resueltas: [{producto_id, opcion_ids}] } | null
```

- [ ] **Step 2: Reemplazar `agregarCombo` por la versión con cadena de opciones**

En `frontend/src/pages/ventas/VentasPage.jsx:167-183`, el bloque actual es:
```js
  function comboContenido(combo) {
    return (combo.productos || []).map((p) => `${p.ComboProducto?.cantidad ?? 1}x ${p.nombre}`).join(', ');
  }

  function agregarCombo(combo) {
    setCarrito((prev) => {
      const existente = prev.find((it) => it.combo_id === combo.id);
      if (existente) {
        return prev.map((it) => it === existente ? { ...it, cantidad: it.cantidad + 1 } : it);
      }
      return [...prev, {
        linea_id: nuevoLineaId(), combo_id: combo.id, nombre: `Combo: ${combo.nombre}`,
        precio: parseFloat(combo.precio), cantidad: 1, nota: null,
        combo_contenido: comboContenido(combo),
      }];
    });
  }
```
Reemplazarlo por:
```js
  function comboContenido(combo) {
    return (combo.productos || []).map((p) => `${p.ComboProducto?.cantidad ?? 1}x ${p.nombre}`).join(', ');
  }

  // Clave para distinguir variantes del mismo combo en el carrito (ej. combo
  // con "Papas: Grande" vs. mismo combo con "Papas: Chico") — mismo criterio
  // que ya usa agregarAlCarrito con `nota` para productos sueltos.
  function _claveOpcionesCombo(opcionesPorProducto) {
    return JSON.stringify(
      [...(opcionesPorProducto || [])]
        .map((o) => ({ producto_id: o.producto_id, opcion_ids: [...(o.opcion_ids || [])].sort((a, b) => a - b) }))
        .sort((a, b) => a.producto_id - b.producto_id)
    );
  }

  function _extraOpcionesCombo(combo, opcionesPorProducto) {
    const opcionesPorId = new Map();
    (combo.productos || []).forEach((p) => (p.grupos_opciones || []).forEach((g) => (g.opciones || []).forEach((o) => opcionesPorId.set(o.id, o))));
    return (opcionesPorProducto || []).reduce(
      (sum, entrada) => sum + (entrada.opcion_ids || []).reduce((s, id) => s + parseFloat(opcionesPorId.get(id)?.precio_adicional || 0), 0),
      0
    );
  }

  function agregarComboAlCarrito(combo, opcionesPorProducto) {
    const clave = _claveOpcionesCombo(opcionesPorProducto);
    setCarrito((prev) => {
      const existente = prev.find((it) => it.combo_id === combo.id && it.combo_opciones_key === clave);
      if (existente) {
        return prev.map((it) => it === existente ? { ...it, cantidad: it.cantidad + 1 } : it);
      }
      return [...prev, {
        linea_id: nuevoLineaId(), combo_id: combo.id, nombre: `Combo: ${combo.nombre}`,
        precio: parseFloat(combo.precio) + _extraOpcionesCombo(combo, opcionesPorProducto), cantidad: 1, nota: null,
        combo_contenido: comboContenido(combo),
        opciones_por_producto: opcionesPorProducto,
        combo_opciones_key: clave,
      }];
    });
  }

  function agregarCombo(combo) {
    if (!puedeCrear) return;
    const productosConOpciones = (combo.productos || []).filter((p) => p.grupos_opciones?.length > 0);
    if (productosConOpciones.length === 0) {
      agregarComboAlCarrito(combo, []);
      return;
    }
    setColaOpcionesCombo({ combo, pendientes: productosConOpciones, resueltas: [] });
  }

  function elegirOpcionCombo(seleccion) {
    setColaOpcionesCombo((cola) => {
      const [actual, ...resto] = cola.pendientes;
      const resueltas = [...cola.resueltas, { producto_id: actual.id, opcion_ids: seleccion.opcionIds }];
      if (resto.length === 0) {
        agregarComboAlCarrito(cola.combo, resueltas);
        return null;
      }
      return { ...cola, pendientes: resto, resueltas };
    });
  }
```

Nota: `agregarCombo` ya no chequea `puedeCrear` en el `onClick` del botón (línea 299, `onClick={() => puedeCrear && agregarCombo(combo)}`) porque ahora también lo chequea la propia función — esto es redundante pero inofensivo, no hace falta tocar la línea 299.

- [ ] **Step 3: Renderizar el modal de la cadena**

Buscar el bloque existente (alrededor de la línea 552, ahora desplazado por las líneas agregadas en el Step 2):
```jsx
      {selectorOpcion && (
        <SelectorOpcionModal
          producto={selectorOpcion}
          onElegir={elegirOpcion}
          onClose={() => setSelectorOpcion(null)}
        />
      )}
```
Agregar inmediatamente después (mismo nivel de indentación):
```jsx
      {colaOpcionesCombo && (
        <SelectorOpcionModal
          producto={colaOpcionesCombo.pendientes[0]}
          subtitulo={`Combo: ${colaOpcionesCombo.combo.nombre} — Producto ${colaOpcionesCombo.resueltas.length + 1} de ${colaOpcionesCombo.pendientes.length + colaOpcionesCombo.resueltas.length}`}
          onElegir={elegirOpcionCombo}
          onClose={() => setColaOpcionesCombo(null)}
        />
      )}
```

- [ ] **Step 4: Incluir `opciones_por_producto` en el payload de venta**

En `frontend/src/pages/ventas/VentasPage.jsx:604`, la línea actual es:
```js
      items: carrito.map((it) => ({ producto_id: it.producto_id, combo_id: it.combo_id, cantidad: it.cantidad, nota: it.nota, peso: it.peso, opcion_ids: it.opcion_ids })),
```
Reemplazarla por:
```js
      items: carrito.map((it) => ({ producto_id: it.producto_id, combo_id: it.combo_id, cantidad: it.cantidad, nota: it.nota, peso: it.peso, opcion_ids: it.opcion_ids, opciones_por_producto: it.opciones_por_producto })),
```

- [ ] **Step 5: Verificar**

Run: `cd frontend && npx eslint src/pages/ventas/VentasPage.jsx`
Expected: sin errores.

Run: `cd frontend && npm run build`
Expected: build exitoso (solo el warning preexistente de chunk grande).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/ventas/VentasPage.jsx
git commit -m "feat(ventas): cadena de selector de opciones al agregar un combo"
```

---

### Task 8: `AutoservicioPage.jsx` — cadena de opciones al agregar un combo

**Files:**
- Modify: `frontend/src/pages/autoservicio/AutoservicioPage.jsx:33` (nuevo estado), `:85-89` (`cantidadPorCombo`), `:148-158` (reemplaza `agregarComboAlCarrito`), `:173-177` (`itemsParaBackend`), `:284` (tile), `:396-397` (+/- en el carrito), `:501-506` (modal)

**Interfaces:**
- Consumes: lo mismo que la Tarea 7 (`grupos_opciones`, `SelectorOpcionModal` con `subtitulo`, contrato `opciones_por_producto`).
- Produces: mismo comportamiento que VentasPage.jsx, adaptado al carrito de Autoservicio (`{tipo:'combo', combo, cantidad, opciones_por_producto}`).

**Nota de diseño:** hoy `cantidadPorCombo` y el +/- del carrito asumen que solo puede existir UNA línea por `combo.id` (comentario explícito en el código: *"Los combos se identifican por combo.id (una sola variante posible)"*). Con opciones, un mismo combo puede tener varias líneas (una por combinación de opciones elegidas) — como ya pasa con productos. Esta tarea corrige esa asunción, replicando el patrón que los productos con opciones ya usan (operar por índice, sumar cantidades por id para el contador).

- [ ] **Step 1: Agregar el estado nuevo**

En `frontend/src/pages/autoservicio/AutoservicioPage.jsx:33`, después de:
```js
  const [selectorOpcion, setSelectorOpcion] = useState(null); // producto con grupos_opciones, mientras se elige
```
agregar:
```js
  const [colaOpcionesCombo, setColaOpcionesCombo] = useState(null); // { combo, pendientes: [producto...], resueltas: [{producto_id, opcion_ids}] } | null
```

- [ ] **Step 2: Corregir `cantidadPorCombo` para sumar por variantes**

En `frontend/src/pages/autoservicio/AutoservicioPage.jsx:85-89`, el bloque actual es:
```js
  const cantidadPorCombo = useMemo(() => {
    const map = {};
    carrito.forEach((l) => { if (l.tipo === 'combo') map[l.combo.id] = l.cantidad; });
    return map;
  }, [carrito]);
```
Reemplazarlo por:
```js
  const cantidadPorCombo = useMemo(() => {
    const map = {};
    carrito.forEach((l) => { if (l.tipo === 'combo') map[l.combo.id] = (map[l.combo.id] ?? 0) + l.cantidad; });
    return map;
  }, [carrito]);
```

- [ ] **Step 3: Reemplazar `agregarComboAlCarrito` y `restarComboDelCarrito`**

En `frontend/src/pages/autoservicio/AutoservicioPage.jsx:148-169`, el bloque actual es:
```js
  const agregarComboAlCarrito = (combo) => {
    setCarrito((c) => {
      const idx = c.findIndex((l) => l.tipo === 'combo' && l.combo.id === combo.id);
      if (idx >= 0) {
        const copia = [...c];
        copia[idx] = { ...copia[idx], cantidad: copia[idx].cantidad + 1 };
        return copia;
      }
      return [...c, { tipo: 'combo', combo, cantidad: 1 }];
    });
  };

  const restarComboDelCarrito = (combo) => {
    setCarrito((c) => {
      const idx = c.findIndex((l) => l.tipo === 'combo' && l.combo.id === combo.id);
      if (idx < 0) return c;
      if (c[idx].cantidad <= 1) return c.filter((_, i) => i !== idx);
      const copia = [...c];
      copia[idx] = { ...copia[idx], cantidad: copia[idx].cantidad - 1 };
      return copia;
    });
  };
```
Reemplazarlo por (`restarComboDelCarrito` deja de usarse — el Step 6 cambia el "-" del carrito a `decrementarLinea(idx)`, igual que los productos):
```js
  // Clave para distinguir variantes del mismo combo en el carrito (ej. combo
  // con "Papas: Grande" vs. mismo combo con "Papas: Chico") — mismo criterio
  // que agregarAlCarrito ya usa con `nota` para productos sueltos.
  const _claveOpcionesCombo = (opcionesPorProducto) => JSON.stringify(
    [...(opcionesPorProducto || [])]
      .map((o) => ({ producto_id: o.producto_id, opcion_ids: [...(o.opcion_ids || [])].sort((a, b) => a - b) }))
      .sort((a, b) => a.producto_id - b.producto_id)
  );

  const agregarComboAlCarrito = (combo, opcionesPorProducto = []) => {
    const clave = _claveOpcionesCombo(opcionesPorProducto);
    setCarrito((c) => {
      const idx = c.findIndex((l) => l.tipo === 'combo' && l.combo.id === combo.id && l.combo_opciones_key === clave);
      if (idx >= 0) {
        const copia = [...c];
        copia[idx] = { ...copia[idx], cantidad: copia[idx].cantidad + 1 };
        return copia;
      }
      return [...c, { tipo: 'combo', combo, cantidad: 1, opciones_por_producto: opcionesPorProducto, combo_opciones_key: clave }];
    });
  };

  const handleAgregarCombo = (combo) => {
    const productosConOpciones = (combo.productos || []).filter((p) => p.grupos_opciones?.length > 0);
    if (productosConOpciones.length === 0) {
      agregarComboAlCarrito(combo, []);
      return;
    }
    setColaOpcionesCombo({ combo, pendientes: productosConOpciones, resueltas: [] });
  };

  const elegirOpcionCombo = (seleccion) => {
    setColaOpcionesCombo((cola) => {
      const [actual, ...resto] = cola.pendientes;
      const resueltas = [...cola.resueltas, { producto_id: actual.id, opcion_ids: seleccion.opcionIds }];
      if (resto.length === 0) {
        agregarComboAlCarrito(cola.combo, resueltas);
        return null;
      }
      return { ...cola, pendientes: resto, resueltas };
    });
  };
```

- [ ] **Step 4: Incluir `opciones_por_producto` en el payload de venta**

En `frontend/src/pages/autoservicio/AutoservicioPage.jsx:173-177`, el bloque actual es:
```js
  const itemsParaBackend = () => carrito.map(l => (
    l.tipo === 'combo'
      ? { combo_id: l.combo.id, cantidad: l.cantidad }
      : { producto_id: l.producto.id, cantidad: l.cantidad, opcion_ids: l.opcion_ids }
  ));
```
Reemplazarlo por:
```js
  const itemsParaBackend = () => carrito.map(l => (
    l.tipo === 'combo'
      ? { combo_id: l.combo.id, cantidad: l.cantidad, opciones_por_producto: l.opciones_por_producto }
      : { producto_id: l.producto.id, cantidad: l.cantidad, opcion_ids: l.opcion_ids }
  ));
```

- [ ] **Step 5: Cambiar el tile del combo para usar el nuevo entrypoint**

En `frontend/src/pages/autoservicio/AutoservicioPage.jsx:284`, la línea actual es:
```js
                  onClick={() => agregarComboAlCarrito(combo)}
```
Reemplazarla por:
```js
                  onClick={() => handleAgregarCombo(combo)}
```

- [ ] **Step 6: Cambiar el +/- del carrito para operar por índice (como productos)**

En `frontend/src/pages/autoservicio/AutoservicioPage.jsx:390-397`, el bloque actual es:
```js
              // Los combos se identifican por combo.id (una sola variante
              // posible), así que siguen sumando/restando por esa función;
              // los productos con opciones pueden tener varias líneas del
              // mismo producto_id, así que acá se opera por índice.
              const onSumar = () => (esCombo ? agregarComboAlCarrito(l.combo) : incrementarLinea(idx));
              const onRestar = () => (esCombo ? restarComboDelCarrito(l.combo) : decrementarLinea(idx));
```
Reemplazarlo por:
```js
              // Un combo puede tener varias líneas (una por combinación de
              // opciones elegidas), igual que ya pasa con productos con
              // opciones — por eso acá se opera siempre por índice.
              const onSumar = () => incrementarLinea(idx);
              const onRestar = () => decrementarLinea(idx);
```

- [ ] **Step 7: Renderizar el modal de la cadena**

Buscar el bloque existente (alrededor de la línea 501, desplazado por los steps anteriores):
```jsx
      {selectorOpcion && (
        <SelectorOpcionModal
          producto={selectorOpcion}
          onElegir={elegirOpcionProducto}
          onClose={() => setSelectorOpcion(null)}
        />
      )}
```
Agregar inmediatamente después (mismo nivel de indentación):
```jsx
      {colaOpcionesCombo && (
        <SelectorOpcionModal
          producto={colaOpcionesCombo.pendientes[0]}
          subtitulo={`Combo: ${colaOpcionesCombo.combo.nombre} — Producto ${colaOpcionesCombo.resueltas.length + 1} de ${colaOpcionesCombo.pendientes.length + colaOpcionesCombo.resueltas.length}`}
          onElegir={elegirOpcionCombo}
          onClose={() => setColaOpcionesCombo(null)}
        />
      )}
```

- [ ] **Step 8: Verificar**

Run: `cd frontend && npx eslint src/pages/autoservicio/AutoservicioPage.jsx`
Expected: sin errores (confirmar que no queda ninguna referencia suelta a `restarComboDelCarrito`, que se eliminó en el Step 3).

Run: `cd frontend && npm run build`
Expected: build exitoso.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/autoservicio/AutoservicioPage.jsx
git commit -m "feat(autoservicio): cadena de selector de opciones al agregar un combo"
```

---

### Task 9: Mostrar las opciones elegidas en los tickets impresos

**Files:**
- Modify: `frontend/src/utils/ticketVenta.js:62-65`
- Modify: `frontend/src/utils/ticketCocina.js:37-40`
- Modify: `frontend/src/utils/escpos.js:160-166` (caja), `:254-260` (cocina)
- Modify: `print-agent/agent.js:498-504` (caja), `:600-606` (cocina)

**Interfaces:**
- Consumes: `detalle.combo_opciones` (Tarea 5), forma `[{producto_id, producto:{nombre}, opcion:{nombre}}]` (HTML) o `[{producto_id, opcion:{nombre}}]`/snake mongo-style objeto Sequelize (ESC/POS — mismo shape, ya que viaja por el mismo payload de `_emitirImpresion`).

- [ ] **Step 1: `ticketVenta.js`**

Agregar, antes de `export function imprimirTicketVenta` (después de la función `_fsNombre`, línea 11):
```js

// Agrupa las opciones elegidas de un combo por producto_id, para poder
// mostrarlas junto a cada producto en el listado del combo (ej. "2x Papas
// (Grande)"). `comboOpciones` viene de detalle.combo_opciones (ver
// INCLUDE_PEDIDO_COMPLETO en ventas.service.js).
function _opcionesPorProducto(comboOpciones) {
  const mapa = {};
  (comboOpciones || []).forEach((co) => {
    if (!co.opcion?.nombre) return;
    (mapa[co.producto_id] ??= []).push(co.opcion.nombre);
  });
  return mapa;
}
```

En `frontend/src/utils/ticketVenta.js:62-65`, el bloque actual es:
```js
    const nombre = d.producto?.nombre ?? (esCombo ? `Combo: ${d.combo.nombre}` : '');
    const contenidoCombo = esCombo && d.combo.productos?.length
      ? `<br><span class="prod-combo-detalle">${d.combo.productos.map(p => `${p.ComboProducto?.cantidad ?? 1}x ${p.nombre}`).join(', ')}</span>`
      : '';
```
Reemplazarlo por:
```js
    const nombre = d.producto?.nombre ?? (esCombo ? `Combo: ${d.combo.nombre}` : '');
    const opcionesPorProducto = esCombo ? _opcionesPorProducto(d.combo_opciones) : {};
    const contenidoCombo = esCombo && d.combo.productos?.length
      ? `<br><span class="prod-combo-detalle">${d.combo.productos.map(p => {
          const opciones = opcionesPorProducto[p.id];
          return `${p.ComboProducto?.cantidad ?? 1}x ${p.nombre}${opciones?.length ? ` (${opciones.join(', ')})` : ''}`;
        }).join(', ')}</span>`
      : '';
```

- [ ] **Step 2: `ticketCocina.js`**

Agregar, antes de `export function imprimirTicketCocina` (después de la función `_fsNombre`, línea 9):
```js

// Ver misma función en ticketVenta.js.
function _opcionesPorProducto(comboOpciones) {
  const mapa = {};
  (comboOpciones || []).forEach((co) => {
    if (!co.opcion?.nombre) return;
    (mapa[co.producto_id] ??= []).push(co.opcion.nombre);
  });
  return mapa;
}
```

En `frontend/src/utils/ticketCocina.js:37-40`, el bloque actual es:
```js
    const nombre = d.producto?.nombre ?? (esCombo ? `Combo: ${d.combo.nombre}` : '');
    const contenidoCombo = esCombo && d.combo.productos?.length
      ? `<br><span class="prod-combo-detalle">${d.combo.productos.map(p => `${p.ComboProducto?.cantidad ?? 1}x ${p.nombre}`).join(', ')}</span>`
      : '';
```
Reemplazarlo por:
```js
    const nombre = d.producto?.nombre ?? (esCombo ? `Combo: ${d.combo.nombre}` : '');
    const opcionesPorProducto = esCombo ? _opcionesPorProducto(d.combo_opciones) : {};
    const contenidoCombo = esCombo && d.combo.productos?.length
      ? `<br><span class="prod-combo-detalle">${d.combo.productos.map(p => {
          const opciones = opcionesPorProducto[p.id];
          return `${p.ComboProducto?.cantidad ?? 1}x ${p.nombre}${opciones?.length ? ` (${opciones.join(', ')})` : ''}`;
        }).join(', ')}</span>`
      : '';
```

- [ ] **Step 3: `escpos.js` — sección de caja**

Agregar cerca del inicio del archivo (junto a otras funciones auxiliares del módulo, antes de la primera función que arma un ticket):
```js

// Agrupa las opciones elegidas de un combo por producto_id — ver la misma
// función en ticketVenta.js/ticketCocina.js (el HTML), acá replicada para
// el camino ESC/POS Bluetooth.
function _opcionesPorProducto(comboOpciones) {
  const mapa = {};
  (comboOpciones || []).forEach((co) => {
    if (!co.opcion || !co.opcion.nombre) return;
    if (!mapa[co.producto_id]) mapa[co.producto_id] = [];
    mapa[co.producto_id].push(co.opcion.nombre);
  });
  return mapa;
}
```

En `frontend/src/utils/escpos.js:160-166`, el bloque actual es:
```js
    if (esCombo && d.combo.productos && d.combo.productos.length) {
      const contenidoCombo = d.combo.productos.map((p) => {
        const cant = (p.ComboProducto && p.ComboProducto.cantidad) || 1;
        return cant + 'x ' + p.nombre;
      }).join(', ');
      t.left().line('  (' + contenidoCombo + ')');
    }
```
Reemplazarlo por:
```js
    if (esCombo && d.combo.productos && d.combo.productos.length) {
      const opcionesPorProducto = _opcionesPorProducto(d.combo_opciones);
      const contenidoCombo = d.combo.productos.map((p) => {
        const cant = (p.ComboProducto && p.ComboProducto.cantidad) || 1;
        const opciones = opcionesPorProducto[p.id];
        return cant + 'x ' + p.nombre + (opciones && opciones.length ? ' (' + opciones.join(', ') + ')' : '');
      }).join(', ');
      t.left().line('  (' + contenidoCombo + ')');
    }
```

- [ ] **Step 4: `escpos.js` — sección de cocina**

En `frontend/src/utils/escpos.js:254-260`, el bloque actual es:
```js
    if (esCombo2 && d2.combo.productos && d2.combo.productos.length) {
      const contenidoCombo2 = d2.combo.productos.map((p) => {
        const cant = (p.ComboProducto && p.ComboProducto.cantidad) || 1;
        return cant + 'x ' + p.nombre;
      }).join(', ');
      t.left().bold(true).line('>> Incluye: ' + contenidoCombo2).bold(false);
    }
```
Reemplazarlo por:
```js
    if (esCombo2 && d2.combo.productos && d2.combo.productos.length) {
      const opcionesPorProducto2 = _opcionesPorProducto(d2.combo_opciones);
      const contenidoCombo2 = d2.combo.productos.map((p) => {
        const cant = (p.ComboProducto && p.ComboProducto.cantidad) || 1;
        const opciones = opcionesPorProducto2[p.id];
        return cant + 'x ' + p.nombre + (opciones && opciones.length ? ' (' + opciones.join(', ') + ')' : '');
      }).join(', ');
      t.left().bold(true).line('>> Incluye: ' + contenidoCombo2).bold(false);
    }
```

- [ ] **Step 5: `print-agent/agent.js` — sección de caja**

Agregar cerca del inicio del archivo (junto a otras funciones auxiliares del módulo — este archivo usa `var`/`function`, no ES6, a diferencia de `escpos.js`):
```js

// Agrupa las opciones elegidas de un combo por producto_id — ver la misma
// función en escpos.js (comparten el mismo shape de payload).
function _opcionesPorProducto(comboOpciones) {
  var mapa = {};
  (comboOpciones || []).forEach(function (co) {
    if (!co.opcion || !co.opcion.nombre) return;
    if (!mapa[co.producto_id]) mapa[co.producto_id] = [];
    mapa[co.producto_id].push(co.opcion.nombre);
  });
  return mapa;
}
```

En `print-agent/agent.js:498-504`, el bloque actual es:
```js
    if (esCombo && d.combo.productos && d.combo.productos.length) {
      var contenidoCombo = d.combo.productos.map(function(p) {
        var cant = (p.ComboProducto && p.ComboProducto.cantidad) || 1;
        return cant + 'x ' + p.nombre;
      }).join(', ');
      t.left().line('        (' + contenidoCombo + ')');
    }
```
Reemplazarlo por:
```js
    if (esCombo && d.combo.productos && d.combo.productos.length) {
      var opcionesPorProducto = _opcionesPorProducto(d.combo_opciones);
      var contenidoCombo = d.combo.productos.map(function(p) {
        var cant = (p.ComboProducto && p.ComboProducto.cantidad) || 1;
        var opciones = opcionesPorProducto[p.id];
        return cant + 'x ' + p.nombre + (opciones && opciones.length ? ' (' + opciones.join(', ') + ')' : '');
      }).join(', ');
      t.left().line('        (' + contenidoCombo + ')');
    }
```

- [ ] **Step 6: `print-agent/agent.js` — sección de cocina**

En `print-agent/agent.js:600-606`, el bloque actual es:
```js
    if (esCombo2 && d2.combo.productos && d2.combo.productos.length) {
      var contenidoCombo2 = d2.combo.productos.map(function(p) {
        var cant = (p.ComboProducto && p.ComboProducto.cantidad) || 1;
        return cant + 'x ' + p.nombre;
      }).join(', ');
      t.left().bold(true).line('     >> Incluye: ' + contenidoCombo2).bold(false);
    }
```
Reemplazarlo por:
```js
    if (esCombo2 && d2.combo.productos && d2.combo.productos.length) {
      var opcionesPorProducto2 = _opcionesPorProducto(d2.combo_opciones);
      var contenidoCombo2 = d2.combo.productos.map(function(p) {
        var cant = (p.ComboProducto && p.ComboProducto.cantidad) || 1;
        var opciones = opcionesPorProducto2[p.id];
        return cant + 'x ' + p.nombre + (opciones && opciones.length ? ' (' + opciones.join(', ') + ')' : '');
      }).join(', ');
      t.left().bold(true).line('     >> Incluye: ' + contenidoCombo2).bold(false);
    }
```

- [ ] **Step 7: Verificar**

Run: `cd frontend && npx eslint src/utils/ticketVenta.js src/utils/ticketCocina.js src/utils/escpos.js`
Expected: sin errores.

Run: `node -c print-agent/agent.js` (desde la raíz del repo)
Expected: sin salida (sintaxis válida).

Run: `cd frontend && npm run build`
Expected: build exitoso.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/utils/ticketVenta.js frontend/src/utils/ticketCocina.js frontend/src/utils/escpos.js print-agent/agent.js
git commit -m "feat(tickets): mostrar opciones elegidas de productos dentro de un combo"
```

---

## Verificación final (whole-branch)

Después de completar las 9 tareas:

- [ ] Run: `cd backend && npx jest` — toda la suite en verde (salvo el flake preexistente ya documentado de `numero_orden_diario`, confirmable en aislamiento).
- [ ] Run: `cd frontend && npm run build` — build limpio.
- [ ] Probar manualmente en el navegador: crear un combo con un producto que tenga opciones (Configuración → Combos, Configuración → Productos), venderlo desde Ventas y desde Autoservicio, confirmar que el ticket muestra la opción elegida.
