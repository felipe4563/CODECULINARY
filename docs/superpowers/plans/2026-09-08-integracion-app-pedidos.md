# Integración con app de pedidos externa — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exponer una API con autenticación por clave (una por sucursal) para que
una app de pedidos externa ya desarrollada pueda leer el menú y crear pedidos que
entren al sistema como cualquier otro (cocina, reportes, tickets), identificando
la sucursal solo por la key usada.

**Architecture:** Módulo backend nuevo `integraciones` que reutiliza
`ventasService.crearCompleta` (extendido para soportar `tipo: 'delivery'` y un
pago diferido) en vez de duplicar lógica de precios/combos/cupones. El frontend
gana tres piezas: administración de API keys (Configuración), una vista para
cobrar pedidos que llegan pendientes de pago, y una etiqueta de origen en Cocina.

**Tech Stack:** Node/Express, Sequelize, MariaDB, React/Vite, React Query.

**Spec:** `docs/superpowers/specs/2026-09-08-integracion-app-pedidos-design.md`

## Global Constraints

- Una API key por sucursal (no una key global ni sucursal_id mandado por la app).
- La key se guarda hasheada (SHA-256, no bcrypt — es un secreto de alta entropía
  generado por el sistema, no una contraseña elegida por un humano; SHA-256
  permite además buscarla por igualdad directa en la consulta, sin iterar).
- Los pedidos de esta integración usan cliente genérico (sin fidelidad/puntos).
- El pedido entra a cocina automáticamente al crearse (sin paso de aceptación).
- Fuera de alcance: notificaciones push a la app externa (se resuelve con
  polling), vinculación a fidelidad, y el punto ciego de impresión Bluetooth
  (problema preexistente, no de esta integración).

---

## Task 1: Migración, modelo `IntegracionApiKey` y columnas nuevas en `pedidos`

**Files:**
- Create: `backend/database/migrations/044_integracion_pedidos_externos.sql`
- Create: `backend/src/models/IntegracionApiKey.js`
- Modify: `backend/src/models/index.js`
- Modify: `backend/src/models/Pedido.js`
- Modify: `bd/bd_codeculinary.sql`
- Test: `backend/tests/integracion_api_keys.model.test.js`

**Interfaces:**
- Produces: modelo `IntegracionApiKey` (`id, sucursal_id, nombre_app,
  api_key_hash, activo, creado_en, actualizado_en`), exportado desde
  `backend/src/models/index.js`. `Pedido` gana `direccion_entrega`,
  `telefono_cliente`, `origen_app` (todas `STRING`, nullable), y sus ENUMs
  `origen`/`tipo`/`metodo_pago` ganan `'app_externa'`, `'delivery'` y
  `'app_externa'` respectivamente.

- [ ] **Step 1: Escribir la migración**

```sql
-- backend/database/migrations/044_integracion_pedidos_externos.sql
-- Integración con app de pedidos externa. Ver
-- docs/superpowers/specs/2026-09-08-integracion-app-pedidos-design.md

CREATE TABLE integraciones_api_keys (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sucursal_id INT UNSIGNED NOT NULL,
  nombre_app VARCHAR(100) NOT NULL,
  api_key_hash VARCHAR(255) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE CASCADE,
  UNIQUE KEY api_key_hash (api_key_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE pedidos
  MODIFY COLUMN origen ENUM('staff','autoservicio','app_externa') NOT NULL DEFAULT 'staff',
  MODIFY COLUMN tipo ENUM('mesa','llevar','delivery') NOT NULL DEFAULT 'mesa',
  MODIFY COLUMN metodo_pago ENUM('efectivo','qr','app_externa') NOT NULL DEFAULT 'efectivo',
  ADD COLUMN direccion_entrega VARCHAR(255) NULL AFTER documento_cliente,
  ADD COLUMN telefono_cliente VARCHAR(50) NULL AFTER direccion_entrega,
  ADD COLUMN origen_app VARCHAR(100) NULL AFTER origen;
```

- [ ] **Step 2: Correr la migración**

Run: `cd backend && node database/migrate.js` (o el comando de migración que ya
usa el proyecto — revisar `backend/database/migrate.js` o el script `migrate`
en `backend/package.json` si el nombre difiere).
Expected: la migración 044 corre sin error; `DESCRIBE pedidos;` muestra las 3
columnas nuevas y los ENUMs actualizados.

- [ ] **Step 3: Modelo `IntegracionApiKey`**

```javascript
// backend/src/models/IntegracionApiKey.js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const IntegracionApiKey = sequelize.define('IntegracionApiKey', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  sucursal_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  nombre_app: { type: DataTypes.STRING(100), allowNull: false },
  api_key_hash: { type: DataTypes.STRING(255), allowNull: false },
  activo: { type: DataTypes.BOOLEAN, defaultValue: true },
}, {
  tableName: 'integraciones_api_keys',
  createdAt: 'creado_en',
  updatedAt: 'actualizado_en',
});

module.exports = IntegracionApiKey;
```

- [ ] **Step 4: Registrar el modelo y su asociación en `models/index.js`**

Agregar el `require` junto a los demás modelos (cerca de la línea donde está
`DetallePedidoComboOpcion`):

```javascript
const IntegracionApiKey = require('./IntegracionApiKey');
```

Agregar la asociación junto a las de `Caja`/`Sucursal` (mismo patrón que
`Caja.belongsTo(Sucursal, ...)` / `Sucursal.hasMany(Caja, ...)`):

```javascript
IntegracionApiKey.belongsTo(Sucursal, { foreignKey: 'sucursal_id', as: 'sucursal' });
Sucursal.hasMany(IntegracionApiKey, { foreignKey: 'sucursal_id', as: 'integraciones_api_keys' });
```

Agregar `IntegracionApiKey` a la lista de `module.exports` al final del archivo.

- [ ] **Step 5: Extender `Pedido.js`**

```javascript
// En backend/src/models/Pedido.js, reemplazar estas 3 líneas:
  tipo: { type: DataTypes.ENUM('mesa', 'llevar'), defaultValue: 'mesa' },
  origen: { type: DataTypes.ENUM('staff', 'autoservicio'), defaultValue: 'staff' },
  numero_llevar: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
// por:
  tipo: { type: DataTypes.ENUM('mesa', 'llevar', 'delivery'), defaultValue: 'mesa' },
  origen: { type: DataTypes.ENUM('staff', 'autoservicio', 'app_externa'), defaultValue: 'staff' },
  origen_app: { type: DataTypes.STRING(100), allowNull: true },
  numero_llevar: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },

// Y reemplazar:
  documento_cliente: { type: DataTypes.STRING(50) },
// por:
  documento_cliente: { type: DataTypes.STRING(50) },
  direccion_entrega: { type: DataTypes.STRING(255) },
  telefono_cliente: { type: DataTypes.STRING(50) },

// Y reemplazar:
  metodo_pago: { type: DataTypes.ENUM('efectivo','qr'), defaultValue: 'efectivo' },
// por:
  metodo_pago: { type: DataTypes.ENUM('efectivo','qr','app_externa'), defaultValue: 'efectivo' },
```

- [ ] **Step 6: Sincronizar `bd/bd_codeculinary.sql`**

Este archivo es el dump de referencia usado para aprovisionar bases nuevas (ver
migraciones 039-043 ya reflejadas ahí) — cada migración debe reflejarse acá
también, en sus 3 secciones (estructura, índices/AUTO_INCREMENT, filtros/FK):

1. En la sección "Estructura de tabla para la tabla `pedidos`": actualizar la
   línea de `origen` a `enum('staff','autoservicio','app_externa')`, la de
   `tipo` a `enum('mesa','llevar','delivery')`, la de `metodo_pago` a
   `enum('efectivo','qr','app_externa')`, y agregar `origen_app`,
   `direccion_entrega`, `telefono_cliente` como columnas `varchar` nullable en
   las posiciones correspondientes.
2. Agregar una sección nueva completa para `integraciones_api_keys` (estructura
   + índices + AUTO_INCREMENT + `ADD CONSTRAINT ... FOREIGN KEY (sucursal_id)
   REFERENCES sucursales (id) ON DELETE CASCADE`), en orden alfabético junto a
   las demás tablas — mismo patrón que se siguió para
   `detalle_pedido_combo_opciones` en la migración 043.

- [ ] **Step 7: Test del modelo**

```javascript
// backend/tests/integracion_api_keys.model.test.js
const { Sucursal, IntegracionApiKey } = require('../src/models');

describe('Modelo IntegracionApiKey', () => {
  let sucursal;

  beforeAll(async () => {
    sucursal = await Sucursal.create({ nombre: 'Sucursal Integracion Test' });
  });

  afterAll(async () => {
    await IntegracionApiKey.destroy({ where: { sucursal_id: sucursal.id } });
    await Sucursal.destroy({ where: { id: sucursal.id } });
  });

  it('crea una key con activo=true por defecto', async () => {
    const key = await IntegracionApiKey.create({
      sucursal_id: sucursal.id, nombre_app: 'PedidosYa', api_key_hash: 'hash-de-prueba',
    });
    expect(key.activo).toBe(true);
  });

  it('se borra en cascada si se borra la sucursal', async () => {
    const sucursalTemp = await Sucursal.create({ nombre: 'Sucursal Cascada Test' });
    await IntegracionApiKey.create({
      sucursal_id: sucursalTemp.id, nombre_app: 'Test', api_key_hash: 'hash-cascada',
    });
    await sucursalTemp.destroy();
    const restantes = await IntegracionApiKey.findAll({ where: { sucursal_id: sucursalTemp.id } });
    expect(restantes.length).toBe(0);
  });
});
```

- [ ] **Step 8: Correr el test**

Run: `cd backend && npx jest integracion_api_keys.model.test.js`
Expected: 2 tests en verde.

- [ ] **Step 9: Commit**

```bash
git add backend/database/migrations/044_integracion_pedidos_externos.sql backend/src/models/IntegracionApiKey.js backend/src/models/index.js backend/src/models/Pedido.js bd/bd_codeculinary.sql backend/tests/integracion_api_keys.model.test.js
git commit -m "feat(integraciones): tabla de API keys por sucursal + columnas de delivery/origen en pedidos"
```

---

## Task 2: Servicio y endpoints de administración de API keys

**Files:**
- Create: `backend/src/modules/integraciones/integracionesAdmin.service.js`
- Create: `backend/src/modules/integraciones/integracionesAdmin.controller.js`
- Create: `backend/src/modules/integraciones/integracionesAdmin.routes.js`
- Modify: `backend/src/app.js`
- Test: `backend/tests/integraciones_admin.test.js`

**Interfaces:**
- Consumes: modelo `IntegracionApiKey` (Task 1), `Sucursal` (ya existente),
  middlewares `../../middlewares/auth` y `verificarPermiso` de
  `../../middlewares/permisos` (ya existentes, mismo patrón que
  `configuracion.routes.js`).
- Produces: rutas montadas en `/api/v1/integraciones-admin` — `GET /`,
  `POST /`, `POST /:id/desactivar`, `POST /:id/regenerar` — protegidas con el
  permiso `configuracion.editar` (reutilizado, no se crea un permiso nuevo).
  La función `generarApiKeyPlano()` (interna, no exportada) es la que
  usará el middleware de autenticación pública en la Task 4 — ahí se
  reimplementa el hash con la misma fórmula (`sha256` en hex), documentada acá.

- [ ] **Step 1: Servicio de administración**

```javascript
// backend/src/modules/integraciones/integracionesAdmin.service.js
const crypto = require('crypto');
const { IntegracionApiKey, Sucursal } = require('../../models');

// Las API keys se guardan como SHA-256 en hex (no bcrypt): son secretos de
// alta entropía generados por el sistema, no contraseñas elegidas por un
// humano — no hace falta un hash lento ni salt por fila, y SHA-256 permite
// buscar la key directamente por igualdad en la consulta (WHERE
// api_key_hash = ?) en vez de traer todas las filas activas y comparar una
// por una como haría falta con bcrypt.
function _hashear(apiKeyPlano) {
  return crypto.createHash('sha256').update(apiKeyPlano).digest('hex');
}

function _generarApiKeyPlano() {
  return 'ik_' + crypto.randomBytes(24).toString('hex');
}

async function listar() {
  const keys = await IntegracionApiKey.findAll({
    include: [{ model: Sucursal, as: 'sucursal', attributes: ['id', 'nombre'] }],
    order: [['creado_en', 'DESC']],
  });
  return keys.map((k) => ({
    id: k.id, sucursal: k.sucursal, nombre_app: k.nombre_app, activo: k.activo, creado_en: k.creado_en,
  }));
}

async function crear({ sucursal_id, nombre_app }) {
  const sucursal = await Sucursal.findByPk(sucursal_id);
  if (!sucursal) throw Object.assign(new Error('Sucursal no encontrada'), { status: 404 });

  const apiKeyPlano = _generarApiKeyPlano();
  const key = await IntegracionApiKey.create({
    sucursal_id, nombre_app, api_key_hash: _hashear(apiKeyPlano),
  });
  // El valor en texto plano solo existe en esta respuesta — no se puede
  // volver a consultar después, ni siquiera desde acá (solo queda el hash).
  return { id: key.id, sucursal_id, nombre_app, api_key: apiKeyPlano };
}

async function desactivar(id) {
  const key = await IntegracionApiKey.findByPk(id);
  if (!key) throw Object.assign(new Error('Key no encontrada'), { status: 404 });
  await key.update({ activo: false });
  return { id: key.id, activo: false };
}

async function regenerar(id) {
  const key = await IntegracionApiKey.findByPk(id);
  if (!key) throw Object.assign(new Error('Key no encontrada'), { status: 404 });
  const apiKeyPlano = _generarApiKeyPlano();
  await key.update({ api_key_hash: _hashear(apiKeyPlano), activo: true });
  return { id: key.id, sucursal_id: key.sucursal_id, nombre_app: key.nombre_app, api_key: apiKeyPlano };
}

module.exports = { listar, crear, desactivar, regenerar, _hashear };
```

- [ ] **Step 2: Controlador**

```javascript
// backend/src/modules/integraciones/integracionesAdmin.controller.js
const svc = require('./integracionesAdmin.service');

async function listar(req, res, next) {
  try { res.json({ ok: true, datos: await svc.listar() }); }
  catch (err) { next(err); }
}

async function crear(req, res, next) {
  try {
    const { sucursal_id, nombre_app } = req.body;
    if (!sucursal_id || !nombre_app) {
      return res.status(400).json({ ok: false, mensaje: 'sucursal_id y nombre_app son requeridos' });
    }
    res.status(201).json({ ok: true, datos: await svc.crear({ sucursal_id, nombre_app }) });
  } catch (err) { next(err); }
}

async function desactivar(req, res, next) {
  try { res.json({ ok: true, datos: await svc.desactivar(req.params.id) }); }
  catch (err) { next(err); }
}

async function regenerar(req, res, next) {
  try { res.json({ ok: true, datos: await svc.regenerar(req.params.id) }); }
  catch (err) { next(err); }
}

module.exports = { listar, crear, desactivar, regenerar };
```

- [ ] **Step 3: Rutas**

```javascript
// backend/src/modules/integraciones/integracionesAdmin.routes.js
const { Router } = require('express');
const ctrl = require('./integracionesAdmin.controller');
const auth = require('../../middlewares/auth');
const { verificarPermiso } = require('../../middlewares/permisos');

const router = Router();
router.use(auth);

router.get('/', verificarPermiso('configuracion', 'ver'), ctrl.listar);
router.post('/', verificarPermiso('configuracion', 'editar'), ctrl.crear);
router.post('/:id/desactivar', verificarPermiso('configuracion', 'editar'), ctrl.desactivar);
router.post('/:id/regenerar', verificarPermiso('configuracion', 'editar'), ctrl.regenerar);

module.exports = router;
```

- [ ] **Step 4: Montar en `app.js`**

Junto a los demás `require` de rutas (cerca de `configuracionRoutes`):

```javascript
const integracionesAdminRoutes = require('./modules/integraciones/integracionesAdmin.routes');
```

Junto a los demás `app.use('/api/v1/...')` (cerca de `configuracionRoutes`):

```javascript
app.use('/api/v1/integraciones-admin', integracionesAdminRoutes);
```

- [ ] **Step 5: Test**

```javascript
// backend/tests/integraciones_admin.test.js
const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const { Sucursal, Rol, Usuario, IntegracionApiKey } = require('../src/models');

describe('Administración de API keys de integraciones', () => {
  let sucursal, token;

  beforeAll(async () => {
    sucursal = await Sucursal.create({ nombre: 'Sucursal Integraciones Admin Test' });
    const rol = await Rol.create({ nombre: 'Admin Integraciones Test', permisos: ['configuracion.ver', 'configuracion.editar'] });
    const usuario = await Usuario.create({
      nombre: 'Admin Test', usuario: `admin_integraciones_${Date.now()}`,
      contrasena: await bcrypt.hash('clave123', 10), rol_id: rol.id, sucursal_id: sucursal.id,
    });
    token = jwt.sign({ id: usuario.id }, process.env.JWT_SECRET);
  });

  afterAll(async () => {
    await IntegracionApiKey.destroy({ where: { sucursal_id: sucursal.id } });
    await Sucursal.destroy({ where: { id: sucursal.id } });
  });

  it('crea una key y la devuelve en texto plano una sola vez', async () => {
    const res = await request(app)
      .post('/api/v1/integraciones-admin')
      .set('Authorization', `Bearer ${token}`)
      .send({ sucursal_id: sucursal.id, nombre_app: 'PedidosYa' });

    expect(res.status).toBe(201);
    expect(res.body.datos.api_key).toMatch(/^ik_[0-9a-f]{48}$/);

    const guardada = await IntegracionApiKey.findByPk(res.body.datos.id);
    expect(guardada.api_key_hash).not.toBe(res.body.datos.api_key);
  });

  it('listar no expone el hash de la key', async () => {
    const res = await request(app)
      .get('/api/v1/integraciones-admin')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.datos[0].api_key_hash).toBeUndefined();
  });

  it('desactivar marca activo=false', async () => {
    const creada = await IntegracionApiKey.create({ sucursal_id: sucursal.id, nombre_app: 'Temp', api_key_hash: 'x' });
    const res = await request(app)
      .post(`/api/v1/integraciones-admin/${creada.id}/desactivar`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.datos.activo).toBe(false);
  });
});
```

- [ ] **Step 6: Correr el test**

Run: `cd backend && npx jest integraciones_admin.test.js`
Expected: 3 tests en verde. Si `Rol.create` o `Usuario.create` fallan por
columnas requeridas distintas, revisar `backend/tests/cajas.test.js` (usa el
mismo patrón de setup de usuario+rol+JWT) y ajustar los campos exactos.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/integraciones/integracionesAdmin.service.js backend/src/modules/integraciones/integracionesAdmin.controller.js backend/src/modules/integraciones/integracionesAdmin.routes.js backend/src/app.js backend/tests/integraciones_admin.test.js
git commit -m "feat(integraciones): endpoints de administración de API keys por sucursal"
```

---

## Task 3: Middleware de autenticación por API key

**Files:**
- Create: `backend/src/middlewares/authApiKeyExterna.js`
- Test: `backend/tests/authApiKeyExterna.test.js`

**Interfaces:**
- Consumes: `IntegracionApiKey` (Task 1), `_hashear` expuesto por
  `integracionesAdmin.service.js` (Task 2) — se reimporta esa misma función en
  vez de duplicar la fórmula de hash, para que ambos lados usen exactamente
  el mismo algoritmo.
- Produces: middleware `authApiKeyExterna(req, res, next)` que cuelga
  `req.sucursal_id` (Number) y `req.integracionApiKeyId` (Number) cuando la
  key es válida; usado por las rutas públicas de la Task 5.

- [ ] **Step 1: Escribir el middleware**

```javascript
// backend/src/middlewares/authApiKeyExterna.js
const { IntegracionApiKey } = require('../models');
const { _hashear } = require('../modules/integraciones/integracionesAdmin.service');

async function authApiKeyExterna(req, res, next) {
  const apiKey = req.header('X-Api-Key');
  if (!apiKey) {
    return res.status(401).json({ ok: false, mensaje: 'Falta el header X-Api-Key' });
  }

  const key = await IntegracionApiKey.findOne({
    where: { api_key_hash: _hashear(apiKey), activo: true },
  });
  if (!key) {
    return res.status(401).json({ ok: false, mensaje: 'API key inválida o inactiva' });
  }

  req.sucursal_id = key.sucursal_id;
  req.integracionApiKeyId = key.id;
  req.integracionNombreApp = key.nombre_app;
  next();
}

module.exports = { authApiKeyExterna };
```

- [ ] **Step 2: Test**

```javascript
// backend/tests/authApiKeyExterna.test.js
const request = require('supertest');
const express = require('express');
const { Sucursal, IntegracionApiKey } = require('../src/models');
const { authApiKeyExterna } = require('../src/middlewares/authApiKeyExterna');
const { crear: crearKey } = require('../src/modules/integraciones/integracionesAdmin.service');

describe('Middleware authApiKeyExterna', () => {
  let sucursal, apiKeyPlano, keyId;

  const app = express();
  app.get('/protegido', authApiKeyExterna, (req, res) => {
    res.json({ sucursal_id: req.sucursal_id });
  });

  beforeAll(async () => {
    sucursal = await Sucursal.create({ nombre: 'Sucursal AuthApiKey Test' });
    const creada = await crearKey({ sucursal_id: sucursal.id, nombre_app: 'Test App' });
    apiKeyPlano = creada.api_key;
    keyId = creada.id;
  });

  afterAll(async () => {
    await IntegracionApiKey.destroy({ where: { sucursal_id: sucursal.id } });
    await Sucursal.destroy({ where: { id: sucursal.id } });
  });

  it('sin header X-Api-Key → 401', async () => {
    const res = await request(app).get('/protegido');
    expect(res.status).toBe(401);
  });

  it('con key inválida → 401', async () => {
    const res = await request(app).get('/protegido').set('X-Api-Key', 'ik_no-existe');
    expect(res.status).toBe(401);
  });

  it('con key válida → cuelga sucursal_id', async () => {
    const res = await request(app).get('/protegido').set('X-Api-Key', apiKeyPlano);
    expect(res.status).toBe(200);
    expect(res.body.sucursal_id).toBe(sucursal.id);
  });

  it('con key desactivada → 401', async () => {
    await IntegracionApiKey.update({ activo: false }, { where: { id: keyId } });
    const res = await request(app).get('/protegido').set('X-Api-Key', apiKeyPlano);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 3: Correr el test**

Run: `cd backend && npx jest authApiKeyExterna.test.js`
Expected: 4 tests en verde.

- [ ] **Step 4: Commit**

```bash
git add backend/src/middlewares/authApiKeyExterna.js backend/tests/authApiKeyExterna.test.js
git commit -m "feat(integraciones): middleware de autenticación por API key"
```

---

## Task 4: `ventas.service.js` — soporte para `delivery` y pago diferido

**Files:**
- Modify: `backend/src/modules/ventas/ventas.service.js`
- Test: `backend/tests/ventas.test.js`

**Interfaces:**
- Consumes: nada nuevo (usa las columnas de la Task 1, ya en el modelo `Pedido`).
- Produces: `crearCompleta` acepta `tipo: 'delivery'` (requiere
  `direccion_entrega`), `direccion_entrega`, `telefono_cliente`, `origen_app`
  como parámetros nuevos, y `metodo_pago: 'diferido'` como valor especial que
  dispara `estado: 'pendiente'` sin cobrar (para que la Task 5 lo use en los
  pedidos "contra entrega"). `listar()` acepta un filtro `origen` nuevo — usado
  por la Task 8 (frontend) para la vista de pedidos externos.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `backend/tests/ventas.test.js` (reusa los fixtures que ya
existen en el archivo para sucursal/usuario/caja/sesión — revisar el
`describe` más cercano, como el de "opciones por producto dentro de un
combo", para copiar el patrón exacto de setup):

```javascript
describe('crearCompleta — delivery y pago diferido', () => {
  it("tipo 'delivery' sin direccion_entrega → 400", async () => {
    const res = await request(app)
      .post('/api/v1/ventas/completa')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'delivery', items: [{ producto_id: productoId, cantidad: 1 }],
        metodo_pago: 'diferido', sesion_caja_id: sesionId,
      });
    expect(res.status).toBe(400);
  });

  it("tipo 'delivery' con metodo_pago 'diferido' → pedido queda pendiente, sin cobrar", async () => {
    const res = await request(app)
      .post('/api/v1/ventas/completa')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'delivery', items: [{ producto_id: productoId, cantidad: 1 }],
        metodo_pago: 'diferido', sesion_caja_id: sesionId,
        direccion_entrega: 'Av. Siempre Viva 742', telefono_cliente: '70012345', origen_app: 'PedidosYa',
      });
    expect(res.status).toBe(201);
    expect(res.body.datos.estado).toBe('pendiente');
    expect(res.body.datos.direccion_entrega).toBe('Av. Siempre Viva 742');
    expect(res.body.datos.telefono_cliente).toBe('70012345');
    expect(res.body.datos.origen_app).toBe('PedidosYa');
  });

  it("metodo_pago 'app_externa' → pedido queda completado de una (prepago)", async () => {
    const res = await request(app)
      .post('/api/v1/ventas/completa')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'llevar', items: [{ producto_id: productoId, cantidad: 1 }],
        metodo_pago: 'app_externa', sesion_caja_id: sesionId, origen_app: 'PedidosYa',
      });
    expect(res.status).toBe(201);
    expect(res.body.datos.estado).toBe('completado');
  });

  it("un pedido 'diferido' se puede cobrar después con POST /ventas/:id/cobrar", async () => {
    const creado = await request(app)
      .post('/api/v1/ventas/completa')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'llevar', items: [{ producto_id: productoId, cantidad: 1 }],
        metodo_pago: 'diferido', sesion_caja_id: sesionId,
      });
    const pedidoId = creado.body.datos.id;

    const cobrado = await request(app)
      .post(`/api/v1/ventas/${pedidoId}/cobrar`)
      .set('Authorization', `Bearer ${token}`)
      .send({ metodo_pago: 'efectivo', monto_recibido: 9999 });

    expect(cobrado.status).toBe(200);
    expect(cobrado.body.datos.estado).toBe('completado');
    expect(cobrado.body.datos.metodo_pago).toBe('efectivo');
  });
});

describe('listar — filtro por origen', () => {
  it('devuelve solo pedidos del origen pedido', async () => {
    await request(app)
      .post('/api/v1/ventas/completa')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'llevar', items: [{ producto_id: productoId, cantidad: 1 }],
        metodo_pago: 'app_externa', sesion_caja_id: sesionId,
      });

    const res = await request(app)
      .get('/api/v1/ventas?origen=app_externa')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.datos.every((p) => p.origen === 'app_externa')).toBe(true);
    expect(res.body.datos.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `cd backend && npx jest ventas.test.js -t "delivery y pago diferido"`
Expected: FAIL (tipo 'delivery' rechazado con "tipo debe ser 'mesa' o
'llevar'", metodo_pago 'diferido'/'app_externa' no reconocidos).

- [ ] **Step 3: Modificar `crearCompleta`**

En `backend/src/modules/ventas/ventas.service.js`, la firma de `crearCompleta`
(línea 816) pasa de:

```javascript
async function crearCompleta({ tipo, mesa_id, nombre_cliente, documento_cliente, tipo_documento, notas, items, metodo_pago, monto_recibido, descuento = 0, propina = 0, sesion_caja_id, usuario_id, cliente_id, puntos_canjear = 0, cupon_codigo, mesa_sesion_id = null, origen = 'staff' }) {
```

a:

```javascript
async function crearCompleta({ tipo, mesa_id, nombre_cliente, documento_cliente, tipo_documento, notas, items, metodo_pago, monto_recibido, descuento = 0, propina = 0, sesion_caja_id, usuario_id, cliente_id, puntos_canjear = 0, cupon_codigo, mesa_sesion_id = null, origen = 'staff', direccion_entrega = null, telefono_cliente = null, origen_app = null }) {
```

El bloque de validación de `tipo` (línea ~853-863) pasa de:

```javascript
  let mesa = null;
  if (tipo === 'mesa') {
    if (!mesa_id) throw Object.assign(new Error('mesa_id es requerido'), { status: 400 });
    mesa = await Mesa.findByPk(mesa_id);
    if (!mesa) throw Object.assign(new Error('Mesa no encontrada'), { status: 404 });
    if (!mesa_sesion_id && mesa.estado !== 'disponible') {
      throw Object.assign(new Error('Mesa ya ocupada'), { status: 409 });
    }
  } else if (tipo !== 'llevar') {
    throw Object.assign(new Error("tipo debe ser 'mesa' o 'llevar'"), { status: 400 });
  }
```

a:

```javascript
  let mesa = null;
  if (tipo === 'mesa') {
    if (!mesa_id) throw Object.assign(new Error('mesa_id es requerido'), { status: 400 });
    mesa = await Mesa.findByPk(mesa_id);
    if (!mesa) throw Object.assign(new Error('Mesa no encontrada'), { status: 404 });
    if (!mesa_sesion_id && mesa.estado !== 'disponible') {
      throw Object.assign(new Error('Mesa ya ocupada'), { status: 409 });
    }
  } else if (tipo === 'delivery') {
    if (!direccion_entrega) throw Object.assign(new Error('direccion_entrega es requerida para pedidos de delivery'), { status: 400 });
  } else if (tipo !== 'llevar') {
    throw Object.assign(new Error("tipo debe ser 'mesa', 'llevar' o 'delivery'"), { status: 400 });
  }
```

La línea del número de orden para llevar (línea ~877) pasa de:

```javascript
  const numero_llevar = tipo === 'llevar' ? await _siguienteNumeroLlevar() : null;
  const estadoInicial = metodo_pago === 'qr' ? 'pendiente' : 'completado';
```

a:

```javascript
  const numero_llevar = (tipo === 'llevar' || tipo === 'delivery') ? await _siguienteNumeroLlevar() : null;
  const estadoInicial = (metodo_pago === 'qr' || metodo_pago === 'diferido') ? 'pendiente' : 'completado';
```

El `Pedido.create` (línea ~881-889) pasa de:

```javascript
    const pedido = await Pedido.create({
      mesa_id: tipo === 'mesa' ? mesa_id : null,
      mesa_sesion_id: tipo === 'mesa' ? mesa_sesion_id : null,
      tipo, origen, numero_llevar, usuario_id, cliente_id: cliente_id || null, sesion_caja_id, sucursal_id, notas,
      estado: estadoInicial, total, descuento, propina, metodo_pago: 'efectivo',
      nombre_cliente: nombre_cliente || (tipo === 'llevar' ? 'Cliente' : 'Público General'),
      documento_cliente,
      tipo_documento: tipo_documento || 'Ticket',
    }, { transaction: t });
```

a:

```javascript
    const pedido = await Pedido.create({
      mesa_id: tipo === 'mesa' ? mesa_id : null,
      mesa_sesion_id: tipo === 'mesa' ? mesa_sesion_id : null,
      tipo, origen, origen_app, numero_llevar, usuario_id, cliente_id: cliente_id || null, sesion_caja_id, sucursal_id, notas,
      estado: estadoInicial, total, descuento, propina, metodo_pago: 'efectivo',
      nombre_cliente: nombre_cliente || (tipo === 'mesa' ? 'Público General' : 'Cliente'),
      documento_cliente,
      telefono_cliente,
      direccion_entrega: tipo === 'delivery' ? direccion_entrega : null,
      tipo_documento: tipo_documento || 'Ticket',
    }, { transaction: t });
```

La llamada a `_finalizarVenta` (línea ~914) pasa de:

```javascript
    if (metodo_pago !== 'qr') {
      await _finalizarVenta({ pedido, detalles, metodo_pago, monto_recibido, descuento, propina, usuario_id, puntos_canjear, cupon_codigo }, t);
    }
```

a:

```javascript
    if (metodo_pago !== 'qr' && metodo_pago !== 'diferido') {
      await _finalizarVenta({ pedido, detalles, metodo_pago, monto_recibido, descuento, propina, usuario_id, puntos_canjear, cupon_codigo }, t);
    }
```

Y el bloque de respuesta final (línea ~921-931) pasa de:

```javascript
  if (metodo_pago === 'qr') {
    const pedidoPendiente = await Pedido.findByPk(pedidoId);
    const pago_qr = await iniciarPagoQr(pedidoPendiente, { descuento, propina, puntos_canjear, cupon_codigo, items: itemsCupon });
    emitir('restaurante:actualizar', { tipo: 'pedido_nuevo' }, sucursal_id);
    return { pedido: await obtener(pedidoId), pago_qr };
  }

  const creado = await obtener(pedidoId);
  emitir('restaurante:actualizar', { tipo: 'pedido_cobrado' }, sucursal_id);
  const datos_impresion = await _emitirImpresion(creado, metodo_pago, parseFloat(monto_recibido || monto_neto) - monto_neto, sucursal_id);
  return { ...creado.toJSON(), datos_impresion };
```

a:

```javascript
  if (metodo_pago === 'qr') {
    const pedidoPendiente = await Pedido.findByPk(pedidoId);
    const pago_qr = await iniciarPagoQr(pedidoPendiente, { descuento, propina, puntos_canjear, cupon_codigo, items: itemsCupon });
    emitir('restaurante:actualizar', { tipo: 'pedido_nuevo' }, sucursal_id);
    return { pedido: await obtener(pedidoId), pago_qr };
  }

  if (metodo_pago === 'diferido') {
    const creado = await obtener(pedidoId);
    emitir('restaurante:actualizar', { tipo: 'pedido_nuevo' }, sucursal_id);
    // A diferencia del QR pendiente (que espera confirmación de pago antes de
    // imprimir), acá la comida hay que empezar a prepararla ya — el cobro
    // llega después, al entregar — así que se imprime cocina (y el ticket de
    // cliente, si la caja no lo desactivó) de una.
    const datos_impresion = await _emitirImpresion(creado, metodo_pago, 0, sucursal_id);
    return { ...creado.toJSON(), datos_impresion };
  }

  const creado = await obtener(pedidoId);
  emitir('restaurante:actualizar', { tipo: 'pedido_cobrado' }, sucursal_id);
  const datos_impresion = await _emitirImpresion(creado, metodo_pago, parseFloat(monto_recibido || monto_neto) - monto_neto, sucursal_id);
  return { ...creado.toJSON(), datos_impresion };
```

- [ ] **Step 4: Agregar el filtro `origen` a `listar()`**

En `backend/src/modules/ventas/ventas.service.js` (línea 186), pasa de:

```javascript
async function listar({ estado, mesa_id, sucursal_id, cliente_id, acceso_todas } = {}) {
  const where = {};
  if (estado) {
    where.estado = estado.includes(',') ? { [Op.in]: estado.split(',') } : estado;
  }
  if (mesa_id) where.mesa_id = mesa_id;
  if (cliente_id) where.cliente_id = cliente_id;
  if (!acceso_todas) where.sucursal_id = sucursal_id;
  return Pedido.findAll({ where, include: INCLUDE_PEDIDO_COMPLETO, order: [['creado_en', 'DESC']] });
}
```

a:

```javascript
async function listar({ estado, mesa_id, sucursal_id, cliente_id, origen, acceso_todas } = {}) {
  const where = {};
  if (estado) {
    where.estado = estado.includes(',') ? { [Op.in]: estado.split(',') } : estado;
  }
  if (mesa_id) where.mesa_id = mesa_id;
  if (cliente_id) where.cliente_id = cliente_id;
  if (origen) where.origen = origen;
  if (!acceso_todas) where.sucursal_id = sucursal_id;
  return Pedido.findAll({ where, include: INCLUDE_PEDIDO_COMPLETO, order: [['creado_en', 'DESC']] });
}
```

- [ ] **Step 5: Correr los tests para verificar que pasan**

Run: `cd backend && npx jest ventas.test.js`
Expected: todos los tests del archivo en verde (los nuevos y los que ya
existían).

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/ventas/ventas.service.js backend/tests/ventas.test.js
git commit -m "feat(ventas): soportar tipo 'delivery' y pago diferido (contra entrega)"
```

---

## Task 5: Módulo público `integraciones` — menú, cupón, pedidos, estado

**Files:**
- Create: `backend/src/modules/integraciones/integraciones.service.js`
- Create: `backend/src/modules/integraciones/integraciones.controller.js`
- Create: `backend/src/modules/integraciones/integraciones.routes.js`
- Modify: `backend/src/app.js`
- Test: `backend/tests/integraciones.test.js`

**Interfaces:**
- Consumes: `authApiKeyExterna` (Task 3, cuelga `req.sucursal_id`),
  `ventasService.crearCompleta` (Task 4, con `tipo`, `direccion_entrega`,
  `telefono_cliente`, `origen_app`, `metodo_pago: 'app_externa'|'diferido'`),
  `productosService.listarProductos`, `combosService.listarActivos`,
  `promocionesService.listarActivas`, `cuponesService.validar` (todos ya
  existentes, mismo patrón de uso que `autoservicio.service.js`).
- Produces: rutas públicas en `/api/v1/integraciones` — `GET /menu`,
  `POST /cupones/validar`, `POST /pedidos`, `GET /pedidos/:id/estado`.

- [ ] **Step 1: Servicio**

```javascript
// backend/src/modules/integraciones/integraciones.service.js
const { SesionCaja, Pedido, Producto, Combo } = require('../../models');
const ventasService = require('../ventas/ventas.service');
const cuponesService = require('../cupones/cupones.service');
const { listarProductos } = require('../productos/productos.service');
const { listarActivos: listarCombosActivos } = require('../combos/combos.service');
const { listarActivas: listarPromocionesActivas } = require('../promociones/promociones.service');

async function obtenerMenu(sucursal_id) {
  const alcance = { sucursal_id, acceso_todas: false };
  const [productos, combos, promociones] = await Promise.all([
    listarProductos({ solo_vendibles: true, solo_disponibles: true }, alcance),
    listarCombosActivos(),
    listarPromocionesActivas(),
  ]);
  return { productos, combos, promociones };
}

// Recalcula el subtotal con los precios reales de la base de datos antes de
// validar el cupón — no confía en los precios que mande la app externa
// (mismo motivo que autoservicio.service.js:validarCupon). Es solo una
// vista previa: el pedido real vuelve a validar el cupón (y su límite de
// usos) dentro de la transacción de crearCompleta.
async function validarCupon({ codigo, items }) {
  const idsProducto = [...new Set((items || []).filter((i) => i.producto_id).map((i) => Number(i.producto_id)))];
  const idsCombo = [...new Set((items || []).filter((i) => i.combo_id).map((i) => Number(i.combo_id)))];
  const [productos, combos] = await Promise.all([
    idsProducto.length > 0 ? Producto.findAll({ where: { id: idsProducto }, attributes: ['id', 'precio'] }) : [],
    idsCombo.length > 0 ? Combo.findAll({ where: { id: idsCombo }, attributes: ['id', 'precio'] }) : [],
  ]);
  const preciosProducto = new Map(productos.map((p) => [p.id, parseFloat(p.precio)]));
  const preciosCombo = new Map(combos.map((c) => [c.id, parseFloat(c.precio)]));

  const itemsConPrecio = (items || []).map((i) => (
    i.combo_id
      ? { producto_id: null, cantidad: i.cantidad, precio: preciosCombo.get(Number(i.combo_id)) ?? 0 }
      : { producto_id: i.producto_id, cantidad: i.cantidad, precio: preciosProducto.get(Number(i.producto_id)) ?? 0 }
  ));
  const subtotal = itemsConPrecio.reduce((s, i) => s + i.precio * i.cantidad, 0);

  return cuponesService.validar(codigo, subtotal, null, itemsConPrecio);
}

async function crearPedido(sucursal_id, { items, tipo, direccion_entrega, telefono_cliente, nombre_cliente, pago, cupon_codigo, origen_app }) {
  const sesionCaja = await SesionCaja.findOne({ where: { sucursal_id, estado: 'abierta' } });
  if (!sesionCaja) {
    throw Object.assign(new Error('El local no está tomando pedidos en este momento.'), { status: 409 });
  }

  return ventasService.crearCompleta({
    tipo,
    items,
    direccion_entrega,
    telefono_cliente,
    nombre_cliente,
    metodo_pago: pago === 'prepago' ? 'app_externa' : 'diferido',
    sesion_caja_id: sesionCaja.id,
    usuario_id: sesionCaja.usuario_id,
    origen: 'app_externa',
    origen_app,
    cupon_codigo,
  });
}

// Mismo motivo que autoservicio.service.js:consultarEstadoPedido — la
// pertenencia se verifica con un findByPk liviano ANTES de devolver nada, y
// se corta con 404 (no 403) para no confirmarle a un caller con una key
// válida pero de otra integración que el id existe.
async function consultarEstadoPedido(sucursal_id, pedido_id) {
  const pedido = await Pedido.findByPk(pedido_id, { attributes: ['id', 'sucursal_id', 'origen', 'estado', 'total'] });
  if (!pedido || pedido.sucursal_id !== sucursal_id || pedido.origen !== 'app_externa') {
    throw Object.assign(new Error('Pedido no encontrado'), { status: 404 });
  }
  return { id: pedido.id, estado: pedido.estado, total: pedido.total };
}

module.exports = { obtenerMenu, validarCupon, crearPedido, consultarEstadoPedido };
```

- [ ] **Step 2: Controlador**

Reusa la misma validación anti-inyección de `items` que
`autoservicio.controller.js` (mismo tipo de borde público sin confiar en el
payload — ver el comentario de `_validarItems` ahí para el porqué exacto):

```javascript
// backend/src/modules/integraciones/integraciones.controller.js
const svc = require('./integraciones.service');

const MAX_ITEMS = 50;

function _esIdPositivo(v) {
  return Number.isInteger(v) && v > 0;
}

function _validarItems(items) {
  if (!Array.isArray(items) || items.length === 0) return 'items es requerido';
  if (items.length > MAX_ITEMS) return `No se pueden pedir más de ${MAX_ITEMS} ítems a la vez`;

  for (const item of items) {
    if (!item || typeof item !== 'object') return 'Ítem inválido';
    const tieneProducto = item.producto_id !== undefined && item.producto_id !== null;
    const tieneCombo = item.combo_id !== undefined && item.combo_id !== null;
    if (tieneProducto === tieneCombo) return 'Cada ítem debe tener producto_id o combo_id (uno solo)';
    if (tieneProducto && !_esIdPositivo(item.producto_id)) return 'producto_id inválido';
    if (tieneCombo && !_esIdPositivo(item.combo_id)) return 'combo_id inválido';
    if (!Number.isInteger(item.cantidad) || item.cantidad <= 0) return 'Cantidad inválida';
  }
  return null;
}

async function obtenerMenu(req, res, next) {
  try { res.json({ ok: true, datos: await svc.obtenerMenu(req.sucursal_id) }); }
  catch (err) { next(err); }
}

async function validarCupon(req, res, next) {
  try {
    const { codigo, items } = req.body;
    if (!codigo || typeof codigo !== 'string') {
      return res.status(400).json({ ok: false, mensaje: 'codigo es requerido' });
    }
    res.json({ ok: true, datos: await svc.validarCupon({ codigo, items }) });
  } catch (err) { next(err); }
}

async function crearPedido(req, res, next) {
  try {
    const { items, tipo, direccion_entrega, telefono_cliente, nombre_cliente, pago, cupon_codigo } = req.body;
    const errorItems = _validarItems(items);
    if (errorItems) return res.status(400).json({ ok: false, mensaje: errorItems });
    if (!['llevar', 'delivery'].includes(tipo)) {
      return res.status(400).json({ ok: false, mensaje: "tipo debe ser 'llevar' o 'delivery'" });
    }
    if (tipo === 'delivery' && !direccion_entrega) {
      return res.status(400).json({ ok: false, mensaje: 'direccion_entrega es requerida para delivery' });
    }
    if (!['prepago', 'contra_entrega'].includes(pago)) {
      return res.status(400).json({ ok: false, mensaje: "pago debe ser 'prepago' o 'contra_entrega'" });
    }
    const datos = await svc.crearPedido(req.sucursal_id, {
      items, tipo, direccion_entrega, telefono_cliente, nombre_cliente, pago, cupon_codigo,
      origen_app: req.integracionNombreApp,
    });
    res.status(201).json({ ok: true, datos });
  } catch (err) { next(err); }
}

async function estadoPedido(req, res, next) {
  try { res.json({ ok: true, datos: await svc.consultarEstadoPedido(req.sucursal_id, req.params.pedido_id) }); }
  catch (err) { next(err); }
}

module.exports = { obtenerMenu, validarCupon, crearPedido, estadoPedido };
```

- [ ] **Step 3: Rutas**

```javascript
// backend/src/modules/integraciones/integraciones.routes.js
const { Router } = require('express');
const ctrl = require('./integraciones.controller');
const { authApiKeyExterna } = require('../../middlewares/authApiKeyExterna');

const router = Router();
router.use(authApiKeyExterna);

router.get('/menu', ctrl.obtenerMenu);
router.post('/cupones/validar', ctrl.validarCupon);
router.post('/pedidos', ctrl.crearPedido);
router.get('/pedidos/:pedido_id/estado', ctrl.estadoPedido);

module.exports = router;
```

- [ ] **Step 4: Montar en `app.js`**

```javascript
const integracionesRoutes = require('./modules/integraciones/integraciones.routes');
// ...
app.use('/api/v1/integraciones', integracionesRoutes);
```

- [ ] **Step 5: Test**

```javascript
// backend/tests/integraciones.test.js
const request = require('supertest');
const app = require('../src/app');
const { Sucursal, Rol, Usuario, Caja, SesionCaja, Categoria, Producto, ProductoStockSucursal, IntegracionApiKey } = require('../src/models');
const { crear: crearKey } = require('../src/modules/integraciones/integracionesAdmin.service');

describe('API pública de integraciones', () => {
  let sucursal, apiKey, categoria, producto, sesion;

  beforeAll(async () => {
    sucursal = await Sucursal.create({ nombre: 'Sucursal Integracion Publica Test' });
    const rol = await Rol.create({ nombre: 'Rol Integracion Test', permisos: ['ventas.crear', 'ventas.ver', 'ventas.cobrar'] });
    const usuario = await Usuario.create({
      nombre: 'Usuario Integracion Test', usuario: `usuario_integracion_${Date.now()}`,
      contrasena: 'x', rol_id: rol.id, sucursal_id: sucursal.id,
    });
    const caja = await Caja.create({ sucursal_id: sucursal.id, nombre: 'Caja Integracion Test' });
    sesion = await SesionCaja.create({ caja_id: caja.id, sucursal_id: sucursal.id, usuario_id: usuario.id, estado: 'abierta', monto_inicial: 0 });
    categoria = await Categoria.create({ nombre: `Categoria Integracion Test ${Date.now()}` });
    producto = await Producto.create({ categoria_id: categoria.id, nombre: 'Producto Integracion Test', precio: 25, es_vendible: 1 });
    await ProductoStockSucursal.create({ producto_id: producto.id, sucursal_id: sucursal.id, stock: 100 });

    const creada = await crearKey({ sucursal_id: sucursal.id, nombre_app: 'PedidosYa Test' });
    apiKey = creada.api_key;
  });

  afterAll(async () => {
    await SesionCaja.destroy({ where: { id: sesion.id } });
    await ProductoStockSucursal.destroy({ where: { producto_id: producto.id } });
    await Producto.destroy({ where: { id: producto.id } });
    await Categoria.destroy({ where: { id: categoria.id } });
    await IntegracionApiKey.destroy({ where: { sucursal_id: sucursal.id } });
  });

  it('GET /menu sin API key → 401', async () => {
    const res = await request(app).get('/api/v1/integraciones/menu');
    expect(res.status).toBe(401);
  });

  it('GET /menu con API key válida → devuelve el producto de esa sucursal', async () => {
    const res = await request(app).get('/api/v1/integraciones/menu').set('X-Api-Key', apiKey);
    expect(res.status).toBe(200);
    expect(res.body.datos.productos.some((p) => p.id === producto.id)).toBe(true);
  });

  it('POST /pedidos con tipo delivery y prepago → pedido completado con dirección', async () => {
    const res = await request(app)
      .post('/api/v1/integraciones/pedidos')
      .set('X-Api-Key', apiKey)
      .send({
        items: [{ producto_id: producto.id, cantidad: 2 }],
        tipo: 'delivery', direccion_entrega: 'Calle Falsa 123', telefono_cliente: '70099999',
        nombre_cliente: 'Cliente App', pago: 'prepago',
      });

    expect(res.status).toBe(201);
    expect(res.body.datos.estado).toBe('completado');
    expect(res.body.datos.origen).toBe('app_externa');
    expect(res.body.datos.origen_app).toBe('PedidosYa Test');
    expect(res.body.datos.direccion_entrega).toBe('Calle Falsa 123');
  });

  it('POST /pedidos con pago contra_entrega → pedido pendiente', async () => {
    const res = await request(app)
      .post('/api/v1/integraciones/pedidos')
      .set('X-Api-Key', apiKey)
      .send({ items: [{ producto_id: producto.id, cantidad: 1 }], tipo: 'llevar', pago: 'contra_entrega' });

    expect(res.status).toBe(201);
    expect(res.body.datos.estado).toBe('pendiente');
  });

  it('GET /pedidos/:id/estado de un pedido de otra sucursal → 404', async () => {
    const otraSucursal = await Sucursal.create({ nombre: 'Otra Sucursal Test' });
    const otraKey = await crearKey({ sucursal_id: otraSucursal.id, nombre_app: 'Otra App' });

    const creado = await request(app)
      .post('/api/v1/integraciones/pedidos')
      .set('X-Api-Key', apiKey)
      .send({ items: [{ producto_id: producto.id, cantidad: 1 }], tipo: 'llevar', pago: 'prepago' });

    const res = await request(app)
      .get(`/api/v1/integraciones/pedidos/${creado.body.datos.id}/estado`)
      .set('X-Api-Key', otraKey.api_key);
    expect(res.status).toBe(404);

    await IntegracionApiKey.destroy({ where: { sucursal_id: otraSucursal.id } });
    await otraSucursal.destroy();
  });
});
```

- [ ] **Step 6: Correr el test**

Run: `cd backend && npx jest integraciones.test.js`
Expected: 5 tests en verde. Si `Usuario.create`/`Caja.create`/`SesionCaja.create`
fallan por columnas requeridas distintas a las usadas acá, revisar
`backend/tests/autoservicio.test.js` (setup casi idéntico) y ajustar los
campos exactos a lo que pida el modelo real.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/integraciones/integraciones.service.js backend/src/modules/integraciones/integraciones.controller.js backend/src/modules/integraciones/integraciones.routes.js backend/src/app.js backend/tests/integraciones.test.js
git commit -m "feat(integraciones): endpoints públicos de menú, cupón, pedidos y estado"
```

---

## Task 6: Frontend — administración de API keys en Configuración

**Files:**
- Create: `frontend/src/api/integraciones.js`
- Create: `frontend/src/pages/configuracion/tabs/TabIntegraciones.jsx`
- Modify: `frontend/src/pages/configuracion/ConfiguracionPage.jsx`
- Modify: `frontend/src/router/index.jsx` (ninguna ruta nueva — `/configuracion/:tab` ya cubre `integraciones` vía el array `TABS`)
- Modify: `frontend/src/components/layout/Sidebar.jsx`

**Interfaces:**
- Consumes: `GET/POST /api/v1/integraciones-admin` (Task 2), componentes
  compartidos `Modal` (`../../../components/ui/Modal`) y `SettingsCard`
  (`../shared`), hook `usePermisos` (patrón ya usado por `ConfiguracionPage`).

- [ ] **Step 1: Cliente API**

```javascript
// frontend/src/api/integraciones.js
import api from './cliente';

export const getApiKeys = () =>
  api.get('/integraciones-admin').then((r) => r.data.datos);

export const crearApiKey = (datos) =>
  api.post('/integraciones-admin', datos).then((r) => r.data.datos);

export const desactivarApiKey = (id) =>
  api.post(`/integraciones-admin/${id}/desactivar`).then((r) => r.data.datos);

export const regenerarApiKey = (id) =>
  api.post(`/integraciones-admin/${id}/regenerar`).then((r) => r.data.datos);
```

- [ ] **Step 2: Pestaña de Configuración**

Mismo patrón que `TabAreas.jsx` (ver ese archivo para el estilo exacto de
`SettingsCard`/`Modal`/tarjetas), con la diferencia de que al crear o
regenerar hay que **mostrar la key en texto plano una sola vez**:

```javascript
// frontend/src/pages/configuracion/tabs/TabIntegraciones.jsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Ban, RefreshCw, Plug, Copy } from 'lucide-react';
import { getApiKeys, crearApiKey, desactivarApiKey, regenerarApiKey } from '../../../api/integraciones';
import { getSucursales } from '../../../api/sucursales';
import Modal from '../../../components/ui/Modal';
import { SettingsCard } from '../shared';

export default function TabIntegraciones({ puedeEditar }) {
  const qc = useQueryClient();
  const [modalCrear, setModalCrear] = useState(false);
  const [keyGenerada, setKeyGenerada] = useState(null); // { api_key, nombre_app }

  const { data: keys = [], isLoading } = useQuery({ queryKey: ['integraciones-api-keys'], queryFn: getApiKeys });
  const { data: sucursales = [] } = useQuery({ queryKey: ['sucursales'], queryFn: getSucursales });

  const crear = useMutation({
    mutationFn: crearApiKey,
    onSuccess: (datos) => {
      qc.invalidateQueries({ queryKey: ['integraciones-api-keys'] });
      setModalCrear(false);
      setKeyGenerada(datos);
    },
  });

  const desactivar = useMutation({
    mutationFn: desactivarApiKey,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integraciones-api-keys'] }),
  });

  const regenerar = useMutation({
    mutationFn: regenerarApiKey,
    onSuccess: (datos) => {
      qc.invalidateQueries({ queryKey: ['integraciones-api-keys'] });
      setKeyGenerada(datos);
    },
  });

  return (
    <SettingsCard
      toolbar={
        <>
          <p className="text-sm text-muted-foreground">{keys.length} integración(es)</p>
          {puedeEditar && (
            <button
              onClick={() => setModalCrear(true)}
              className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-sm font-medium transition-colors"
            >
              <Plus className="w-4 h-4" /> Nueva API key
            </button>
          )}
        </>
      }
    >
      <div className="space-y-3">
        {isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <RefreshCw className="w-4 h-4 animate-spin" /><span className="text-sm">Cargando...</span>
          </div>
        )}

        {keys.map((k) => (
          <div key={k.id} className="bg-background border border-border rounded-xl p-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 bg-primary/10 rounded-lg flex items-center justify-center shrink-0">
                <Plug className="w-4 h-4 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-foreground truncate">{k.nombre_app}</p>
                <p className="text-xs text-muted-foreground">
                  {k.sucursal?.nombre} · {k.activo ? 'Activa' : 'Desactivada'}
                </p>
              </div>
            </div>
            {puedeEditar && (
              <div className="flex gap-1 shrink-0">
                <button
                  onClick={() => regenerar.mutate(k.id)}
                  title="Regenerar key"
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
                {k.activo && (
                  <button
                    onClick={() => desactivar.mutate(k.id)}
                    title="Desactivar"
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <Ban className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>
        ))}

        {!isLoading && keys.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40 gap-2 text-muted-foreground">
            <Plug className="w-8 h-8" />
            <p className="text-sm">No hay integraciones. Crea la primera.</p>
          </div>
        )}
      </div>

      {modalCrear && (
        <FormCrearModal
          sucursales={sucursales}
          onClose={() => setModalCrear(false)}
          onGuardar={(datos) => crear.mutate(datos)}
          guardando={crear.isPending}
          error={crear.error?.response?.data?.mensaje}
        />
      )}

      {keyGenerada && (
        <Modal titulo="API key generada" onClose={() => setKeyGenerada(null)}>
          <p className="text-sm text-muted-foreground mb-3">
            Copiá esta key ahora — no se puede volver a ver después. Configurala en <strong>{keyGenerada.nombre_app}</strong>.
          </p>
          <div className="flex items-center gap-2 bg-muted rounded-xl p-3">
            <code className="text-sm flex-1 break-all">{keyGenerada.api_key}</code>
            <button
              onClick={() => navigator.clipboard.writeText(keyGenerada.api_key)}
              className="p-1.5 rounded-lg hover:bg-accent transition-colors shrink-0"
            >
              <Copy className="w-4 h-4" />
            </button>
          </div>
        </Modal>
      )}
    </SettingsCard>
  );
}

function FormCrearModal({ sucursales, onClose, onGuardar, guardando, error }) {
  const [nombre_app, setNombreApp] = useState('');
  const [sucursal_id, setSucursalId] = useState(sucursales[0]?.id ?? '');

  return (
    <Modal titulo="Nueva API key" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
            Nombre de la app
          </label>
          <input
            autoFocus
            value={nombre_app}
            onChange={(e) => setNombreApp(e.target.value)}
            placeholder="Ej: PedidosYa"
            className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
            Sucursal
          </label>
          <select
            value={sucursal_id}
            onChange={(e) => setSucursalId(Number(e.target.value))}
            className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
          >
            {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors">
            Cancelar
          </button>
          <button
            onClick={() => onGuardar({ nombre_app, sucursal_id })}
            disabled={guardando || !nombre_app.trim() || !sucursal_id}
            className="px-4 py-2 rounded-xl text-sm bg-primary hover:bg-primary/90 text-primary-foreground transition-colors disabled:opacity-60"
          >
            {guardando ? 'Generando...' : 'Generar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 3: Registrar la pestaña en `ConfiguracionPage.jsx`**

Agregar el import junto a los demás (`import TabIntegraciones from
'./tabs/TabIntegraciones';`), agregar `Plug` al import de `lucide-react`, y
agregar una fila al array `TABS`:

```javascript
{ id: 'integraciones', label: 'Integraciones', descripcion: 'API keys para apps de pedidos externas', Icono: Plug, Comp: TabIntegraciones },
```

- [ ] **Step 4: Agregar el subitem al Sidebar**

En `frontend/src/components/layout/Sidebar.jsx`, agregar `Plug` al import de
`lucide-react` y una fila al array `subItems` de Configuración:

```javascript
{ to: '/configuracion/integraciones', label: 'Integraciones', Icono: Plug },
```

- [ ] **Step 5: Probar en el navegador**

Levantar backend y frontend (`npm run dev` en ambos), ir a Configuración >
Integraciones, crear una key de prueba, confirmar que se muestra una sola vez
y que aparece en la lista como "Activa". Desactivarla y confirmar que
desaparece el botón de desactivar y queda marcada "Desactivada".

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/integraciones.js frontend/src/pages/configuracion/tabs/TabIntegraciones.jsx frontend/src/pages/configuracion/ConfiguracionPage.jsx frontend/src/components/layout/Sidebar.jsx
git commit -m "feat(frontend): administración de API keys de integraciones en Configuración"
```

---

## Task 7: Frontend — página "Pedidos externos" (cobrar contra-entrega)

**Files:**
- Create: `frontend/src/pages/pedidos-externos/PedidosExternosPage.jsx`
- Modify: `frontend/src/router/index.jsx`
- Modify: `frontend/src/components/layout/Sidebar.jsx`

**Interfaces:**
- Consumes: `getVentas` y `cobrarVenta` de `frontend/src/api/ventas.js` (ya
  existen, sin cambios — `getVentas({ origen: 'app_externa' })` ya funciona
  gracias al filtro agregado en la Task 4).

- [ ] **Step 1: Página**

```javascript
// frontend/src/pages/pedidos-externos/PedidosExternosPage.jsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Truck, MapPin, Phone, RefreshCw, DollarSign } from 'lucide-react';
import { getVentas, cobrarVenta } from '../../api/ventas';
import Modal from '../../components/ui/Modal';

const ESTADO_LABEL = {
  pendiente: 'Pendiente', listo: 'Listo', completado: 'Completado', cancelado: 'Cancelado',
};

export default function PedidosExternosPage() {
  const { data: pedidos = [], isLoading } = useQuery({
    queryKey: ['ventas', { origen: 'app_externa' }],
    queryFn: () => getVentas({ origen: 'app_externa' }),
    refetchInterval: 15000,
  });
  const [pedidoACobrar, setPedidoACobrar] = useState(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <Truck className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-foreground">Pedidos externos</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Pedidos que llegaron desde apps de delivery/pedidos</p>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <RefreshCw className="w-4 h-4 animate-spin" /><span className="text-sm">Cargando...</span>
        </div>
      )}

      <div className="space-y-3">
        {pedidos.map((p) => (
          <div key={p.id} className="bg-background border border-border rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="font-semibold text-foreground">
                  {p.origen_app || 'App externa'} · #{p.numero_llevar ?? p.id}
                </p>
                <p className="text-xs text-muted-foreground">{p.nombre_cliente}</p>
              </div>
              <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-muted text-muted-foreground">
                {ESTADO_LABEL[p.estado] ?? p.estado}
              </span>
            </div>

            {p.tipo === 'delivery' && (
              <div className="text-xs text-muted-foreground space-y-1">
                {p.direccion_entrega && (
                  <div className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" />{p.direccion_entrega}</div>
                )}
                {p.telefono_cliente && (
                  <div className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" />{p.telefono_cliente}</div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <span className="text-sm font-semibold">Bs. {parseFloat(p.total).toFixed(2)}</span>
              {p.metodo_pago === 'app_externa' ? (
                <span className="text-xs text-green-600 dark:text-green-400 font-medium">Pagado en la app</span>
              ) : ['pendiente', 'listo'].includes(p.estado) ? (
                <button
                  onClick={() => setPedidoACobrar(p)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-xs font-medium transition-colors"
                >
                  <DollarSign className="w-3.5 h-3.5" /> Cobrar
                </button>
              ) : null}
            </div>
          </div>
        ))}

        {!isLoading && pedidos.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40 gap-2 text-muted-foreground">
            <Truck className="w-8 h-8" />
            <p className="text-sm">Todavía no llegó ningún pedido externo.</p>
          </div>
        )}
      </div>

      {pedidoACobrar && (
        <ModalCobrar pedido={pedidoACobrar} onClose={() => setPedidoACobrar(null)} />
      )}
    </div>
  );
}

function ModalCobrar({ pedido, onClose }) {
  const qc = useQueryClient();
  const [metodo_pago, setMetodoPago] = useState('efectivo');
  const [monto_recibido, setMontoRecibido] = useState(pedido.total);

  const cobrar = useMutation({
    mutationFn: () => cobrarVenta(pedido.id, { metodo_pago, monto_recibido: parseFloat(monto_recibido) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ventas'] });
      onClose();
    },
  });

  return (
    <Modal titulo={`Cobrar pedido #${pedido.numero_llevar ?? pedido.id}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex gap-2">
          {['efectivo', 'qr'].map((m) => (
            <button
              key={m}
              onClick={() => setMetodoPago(m)}
              className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                metodo_pago === m ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'
              }`}
            >
              {m === 'efectivo' ? 'Efectivo' : 'QR'}
            </button>
          ))}
        </div>
        {metodo_pago === 'efectivo' && (
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              Monto recibido
            </label>
            <input
              type="number"
              value={monto_recibido}
              onChange={(e) => setMontoRecibido(e.target.value)}
              className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
            />
          </div>
        )}
        {cobrar.error && (
          <p className="text-sm text-destructive">{cobrar.error?.response?.data?.mensaje ?? 'Error al cobrar'}</p>
        )}
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors">
            Cancelar
          </button>
          <button
            onClick={() => cobrar.mutate()}
            disabled={cobrar.isPending}
            className="px-4 py-2 rounded-xl text-sm bg-primary hover:bg-primary/90 text-primary-foreground transition-colors disabled:opacity-60"
          >
            {cobrar.isPending ? 'Cobrando...' : 'Confirmar cobro'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Ruta**

En `frontend/src/router/index.jsx`, agregar el import:

```javascript
import PedidosExternosPage from '../pages/pedidos-externos/PedidosExternosPage';
```

Y la ruta, junto a `/ventas`:

```javascript
{ path: '/pedidos-externos', element: <PedidosExternosPage /> },
```

- [ ] **Step 3: Entrada en el Sidebar**

En `frontend/src/components/layout/Sidebar.jsx`, agregar `Truck` (ya está
importado, se usa en "Compras" — reutilizar el mismo ícono está bien, o usar
otro libre de `lucide-react` si se prefiere distinguirlos) y una fila en el
grupo `operacion`, reusando el permiso de `ventas` (son los mismos datos):

```javascript
{ to: '/pedidos-externos', label: 'Pedidos externos', Icono: Truck, modulo: 'ventas', accion: 'ver' },
```

- [ ] **Step 4: Probar en el navegador**

Con un pedido "contra_entrega" creado vía la API pública (Task 5, se puede
probar con `curl`/Postman usando la key generada en la Task 6), ir a "Pedidos
externos", confirmar que aparece con botón "Cobrar", cobrarlo, y confirmar
que desaparece el botón y el pedido pasa a no listarse más como accionable
(sigue apareciendo en la lista si `getVentas` no filtra por estado, ahora sin
botón de cobro).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/pedidos-externos/PedidosExternosPage.jsx frontend/src/router/index.jsx frontend/src/components/layout/Sidebar.jsx
git commit -m "feat(frontend): página de pedidos externos con cobro contra-entrega"
```

---

## Task 8: Frontend — badge de origen y datos de delivery en Cocina

**Files:**
- Modify: `frontend/src/pages/cocina/CocinaPage.jsx`
- Modify: `frontend/src/pages/cocina/PantallaCocinaImpresion.jsx`

**Interfaces:**
- Consumes: campos `pedido.tipo` (ahora puede ser `'delivery'`),
  `pedido.origen`, `pedido.origen_app`, `pedido.direccion_entrega`,
  `pedido.telefono_cliente` (todos ya vienen en la respuesta de
  `GET /ventas/cocina` sin cambios de backend — son columnas planas de
  `Pedido`).

- [ ] **Step 1: Corregir los filtros de bucket (bug real que introduciría `delivery`)**

En `frontend/src/pages/cocina/CocinaPage.jsx` (línea 48-51), los filtros usan
`p.tipo !== 'llevar'` para decidir qué va al bucket de "Mesa" — con `tipo:
'delivery'` agregado, un pedido de delivery caería en el bucket de MESA por
error (`'delivery' !== 'llevar'` es `true`). Pasa de:

```javascript
  const pendientesMesa   = pedidos.filter(p => p.estado === 'pendiente' && p.tipo !== 'llevar');
  const listosMesa       = pedidos.filter(p => p.estado === 'listo'     && p.tipo !== 'llevar');
  const pendientesLlevar = pedidos.filter(p => p.estado === 'pendiente' && p.tipo === 'llevar');
  const listosLlevar     = pedidos.filter(p => p.estado === 'listo'     && p.tipo === 'llevar');
```

a:

```javascript
  const pendientesMesa   = pedidos.filter(p => p.estado === 'pendiente' && p.tipo === 'mesa');
  const listosMesa       = pedidos.filter(p => p.estado === 'listo'     && p.tipo === 'mesa');
  const pendientesLlevar = pedidos.filter(p => p.estado === 'pendiente' && p.tipo !== 'mesa');
  const listosLlevar     = pedidos.filter(p => p.estado === 'listo'     && p.tipo !== 'mesa');
```

- [ ] **Step 2: Badge de origen y datos de delivery en `PedidoCard`**

En `frontend/src/pages/cocina/CocinaPage.jsx`, dentro de `PedidoCard` (línea
184), agregar debajo del bloque de cabecera (después de la línea 212, el
`</div>` que cierra el bloque de nombre/número) un bloque nuevo:

```javascript
      {pedido.origen === 'app_externa' && (
        <div className="flex items-center gap-1.5 flex-wrap text-xs">
          <span className="px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-medium">
            {pedido.origen_app || 'App externa'}
          </span>
        </div>
      )}
      {pedido.tipo === 'delivery' && (pedido.direccion_entrega || pedido.telefono_cliente) && (
        <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
          {pedido.direccion_entrega && <div>📍 {pedido.direccion_entrega}</div>}
          {pedido.telefono_cliente && <div>📞 {pedido.telefono_cliente}</div>}
        </div>
      )}
```

- [ ] **Step 3: Etiqueta en `PantallaCocinaImpresion.jsx`**

Pasa (línea 81-84):

```javascript
      const esLlevar = datos.pedido.tipo === 'llevar';
      const etiqueta = esLlevar
        ? `Para llevar — ${datos.pedido.nombre_cliente || 'Cliente'}`
        : (datos.pedido.mesa?.nombre || 'Mesa');
```

a:

```javascript
      const etiqueta = datos.pedido.tipo === 'mesa'
        ? (datos.pedido.mesa?.nombre || 'Mesa')
        : datos.pedido.tipo === 'delivery'
          ? `Delivery — ${datos.pedido.nombre_cliente || 'Cliente'}`
          : `Para llevar — ${datos.pedido.nombre_cliente || 'Cliente'}`;
```

- [ ] **Step 4: Probar en el navegador**

Crear (vía la API pública) un pedido `delivery` con `origen_app` y
`direccion_entrega`, abrir Cocina, confirmar que aparece en la columna de
"Para llevar" (no en "Mesa"), con la etiqueta de la app y la dirección/
teléfono visibles.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/cocina/CocinaPage.jsx frontend/src/pages/cocina/PantallaCocinaImpresion.jsx
git commit -m "fix(cocina): pedidos delivery van al bucket correcto + badge de origen y dirección"
```

---

## Task 9: Tickets — dirección/teléfono de delivery y nuevas etiquetas de pago

**Files:**
- Modify: `frontend/src/utils/ticketVenta.js`
- Modify: `frontend/src/utils/escpos.js`
- Modify: `print-agent/agent.js`

**Interfaces:**
- Consumes: `pedido.tipo === 'delivery'`, `pedido.direccion_entrega`,
  `pedido.telefono_cliente`, `pedido.origen_app`, y los valores nuevos de
  `metodo_pago` (`'app_externa'`, y el transitorio `'diferido'` que solo
  llega como parámetro de impresión, nunca persistido — ver Task 4).

- [ ] **Step 1: `ticketVenta.js` — etiqueta de método de pago**

Pasa (línea 40):

```javascript
  const metodoPagoLabel = pago.metodo_pago === 'qr' ? 'QR / Transferencia' : 'Efectivo';
```

a:

```javascript
  const METODO_PAGO_LABEL = { qr: 'QR / Transferencia', app_externa: 'Pagado en la app', diferido: 'Pendiente de cobro' };
  const metodoPagoLabel = METODO_PAGO_LABEL[pago.metodo_pago] ?? 'Efectivo';
```

- [ ] **Step 2: `ticketVenta.js` — badge con delivery**

Pasa (línea 36 y 252-258):

```javascript
  const esLlevar = pedido.tipo === 'llevar';
```

a:

```javascript
  const esLlevar = pedido.tipo === 'llevar';
  const esDelivery = pedido.tipo === 'delivery';
```

Y el badge:

```javascript
  <div class="badge ${esLlevar ? 'llevar' : ''}">
    ${esLlevar
      ? `<div class="badge-tipo">— Para Llevar —</div>
         <div class="badge-numero">${pedido.cliente?.numero_documento ?? pedido.nombre_cliente ?? '—'} &nbsp;·&nbsp; # ${nOrden}</div>`
      : `<div class="badge-tipo">— Orden de Mesa —</div>
         <div class="badge-numero">${pedido.mesa?.nombre ?? '—'} &nbsp;·&nbsp; # ${nOrden}</div>`}
  </div>
```

pasa a:

```javascript
  <div class="badge ${esLlevar || esDelivery ? 'llevar' : ''}">
    ${esDelivery
      ? `<div class="badge-tipo">— Delivery${pedido.origen_app ? ' · ' + pedido.origen_app : ''} —</div>
         <div class="badge-numero">${pedido.nombre_cliente ?? '—'} &nbsp;·&nbsp; # ${nOrden}</div>
         ${pedido.direccion_entrega ? `<div class="badge-numero">${pedido.direccion_entrega}</div>` : ''}
         ${pedido.telefono_cliente ? `<div class="badge-numero">Tel: ${pedido.telefono_cliente}</div>` : ''}`
      : esLlevar
        ? `<div class="badge-tipo">— Para Llevar${pedido.origen_app ? ' · ' + pedido.origen_app : ''} —</div>
           <div class="badge-numero">${pedido.cliente?.numero_documento ?? pedido.nombre_cliente ?? '—'} &nbsp;·&nbsp; # ${nOrden}</div>`
        : `<div class="badge-tipo">— Orden de Mesa —</div>
           <div class="badge-numero">${pedido.mesa?.nombre ?? '—'} &nbsp;·&nbsp; # ${nOrden}</div>`}
  </div>
```

- [ ] **Step 3: `escpos.js` (caja) — mismos dos cambios**

Pasa (línea 110 y 147-152):

```javascript
  const esLlevar = pedido.tipo === 'llevar';
```

a:

```javascript
  const esLlevar = pedido.tipo === 'llevar';
  const esDelivery = pedido.tipo === 'delivery';
```

Pasa:

```javascript
  if (esLlevar) {
    t.left().line('PARA LLEVAR — ' + ((pedido.cliente && pedido.cliente.numero_documento) || pedido.nombre_cliente || 'Cliente'));
  } else {
    const mesaNombre = (pedido.mesa && pedido.mesa.nombre) ? pedido.mesa.nombre : '---';
    t.left().line(mesaNombre.toUpperCase());
  }
```

a:

```javascript
  if (esDelivery) {
    t.left().line('DELIVERY' + (pedido.origen_app ? ' · ' + pedido.origen_app : '') + ' — ' + (pedido.nombre_cliente || 'Cliente'));
    if (pedido.direccion_entrega) t.left().line(pedido.direccion_entrega);
    if (pedido.telefono_cliente) t.left().line('Tel: ' + pedido.telefono_cliente);
  } else if (esLlevar) {
    t.left().line('PARA LLEVAR — ' + ((pedido.cliente && pedido.cliente.numero_documento) || pedido.nombre_cliente || 'Cliente'));
  } else {
    const mesaNombre = (pedido.mesa && pedido.mesa.nombre) ? pedido.mesa.nombre : '---';
    t.left().line(mesaNombre.toUpperCase());
  }
```

Y el label de pago (línea 204):

```javascript
  t.left().line('Pago: ' + (metodo_pago === 'efectivo' ? 'Efectivo' : 'QR / Transferencia'));
```

a:

```javascript
  var METODO_PAGO_LABEL = { qr: 'QR / Transferencia', app_externa: 'Pagado en la app', diferido: 'Pendiente de cobro' };
  t.left().line('Pago: ' + (METODO_PAGO_LABEL[metodo_pago] || 'Efectivo'));
```

(usar `var`/objeto plano en vez de `??`/optional chaining acá también si el
resto del archivo `escpos.js` es JS moderno — revisar el estilo del archivo
en el punto exacto de la edición y mantenerlo consistente; el snippet de
arriba ya usa sintaxis compatible con ambos estilos).

- [ ] **Step 4: `escpos.js` (cocina) — badge**

Pasa (línea 226 y 239-249):

```javascript
  const esLlevar = pedido.tipo === 'llevar';
```

a:

```javascript
  const esLlevar = pedido.tipo === 'llevar';
  const esDelivery = pedido.tipo === 'delivery';
```

Pasa:

```javascript
  if (esLlevar) {
    t.center().dbl().bold(true).line('PARA LLEVAR').normal().bold(false);
  }
  ...
  if (esLlevar) t.left().bold(true).dblH().line('Cliente: ' + (pedido.nombre_cliente || '-')).normal().bold(false);
```

a:

```javascript
  if (esDelivery) {
    t.center().dbl().bold(true).line('DELIVERY').normal().bold(false);
  } else if (esLlevar) {
    t.center().dbl().bold(true).line('PARA LLEVAR').normal().bold(false);
  }
  ...
  if (esDelivery) {
    t.left().bold(true).dblH().line('Cliente: ' + (pedido.nombre_cliente || '-')).normal().bold(false);
    if (pedido.direccion_entrega) t.left().line(pedido.direccion_entrega);
    if (pedido.telefono_cliente) t.left().line('Tel: ' + pedido.telefono_cliente);
  } else if (esLlevar) {
    t.left().bold(true).dblH().line('Cliente: ' + (pedido.nombre_cliente || '-')).normal().bold(false);
  }
```

(mantener el resto de las líneas intermedias sin tocar — el `...` de arriba
marca dónde sigue el código existente entre esos dos bloques, no se borra
nada más).

- [ ] **Step 5: `print-agent/agent.js` — mismos 4 cambios, dialecto `var`/`function`**

Aplicar exactamente los mismos cambios que los Steps 3 y 4 en los puntos
equivalentes (`var esLlevar = pedido.tipo === 'llevar';` en las líneas 439 y
566, los bloques `if (esLlevar) {...}` en 482-483 y 581-592, y el label de
pago en la línea 546), usando `var` en vez de `const`/`let` en todo lo nuevo
— este archivo es un script plano de Node sin transpilador, no acepta
sintaxis que el resto del archivo no use ya.

- [ ] **Step 6: Probar manualmente**

Con un pedido `delivery` de prueba, disparar la impresión (desde Ventas, si
se prueba con un pedido `origen: 'staff'` con `tipo: 'delivery'` armado a
mano en la base para la prueba, o desde el flujo real de la API una vez
montada) y confirmar visualmente que el ticket HTML (`ticketVenta.js`, se ve
en la vista previa de impresión del navegador) muestra dirección/teléfono y
la etiqueta de pago correcta. No hace falta hardware térmico para validar
`ticketVenta.js` — ese es el que se ve al imprimir desde Chrome/Edge.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/utils/ticketVenta.js frontend/src/utils/escpos.js print-agent/agent.js
git commit -m "feat(tickets): mostrar dirección/teléfono de delivery y nuevas etiquetas de método de pago"
```

---

## Task 10: Revisión final y prueba end-to-end manual

**Files:** ninguno nuevo — tarea de verificación.

- [ ] **Step 1: Correr toda la suite de backend**

Run: `cd backend && npx jest`
Expected: todos los tests en verde (los nuevos de las Tasks 1-5 y los que ya
existían).

- [ ] **Step 2: Build de frontend**

Run: `cd frontend && npm run build`
Expected: build exitoso, sin errores de importación (revisar en particular
`PedidosExternosPage.jsx`, `TabIntegraciones.jsx` y los imports nuevos en
`Sidebar.jsx`/`router/index.jsx`/`ConfiguracionPage.jsx`).

- [ ] **Step 3: Prueba end-to-end manual con `curl`**

Con backend corriendo y una API key generada desde Configuración >
Integraciones:

```bash
curl http://localhost:3001/api/v1/integraciones/menu -H "X-Api-Key: ik_..."

curl -X POST http://localhost:3001/api/v1/integraciones/pedidos \
  -H "X-Api-Key: ik_..." -H "Content-Type: application/json" \
  -d '{"items":[{"producto_id":1,"cantidad":1}],"tipo":"delivery","direccion_entrega":"Calle Test 123","telefono_cliente":"70000000","nombre_cliente":"Cliente Curl","pago":"contra_entrega"}'
```

Expected: el `POST /pedidos` responde 201 con `estado: 'pendiente'`; el
pedido aparece en Cocina (columna "Para llevar", con badge de origen y
dirección) y en "Pedidos externos" con botón "Cobrar". Cobrarlo desde ahí y
confirmar que pasa a "Completado" y que el ticket impreso (vista previa del
navegador) muestra la dirección y el método de pago elegido al cobrar.

- [ ] **Step 4: Confirmar que no se rompió nada existente**

Crear una venta normal desde Ventas (mesa y llevar) y un pedido de
Autoservicio (QR) de prueba, confirmar que ambos siguen funcionando
exactamente igual que antes (sin badge de origen visible para `'staff'`, y
con el de "QR" para `'autoservicio'` si ya existiera esa distinción — si no
existía, no hace falta agregarla, está fuera de alcance de este plan).
