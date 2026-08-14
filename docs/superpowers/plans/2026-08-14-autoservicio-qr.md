# Autoservicio por QR en Mesa Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que un cliente sentado en una mesa pida y pague sin depender de un mozo/cajero: escanea un QR fijo de la mesa, ve el menú, arma su pedido, paga por QR (CodePay), y el pedido entra a cocina automáticamente al confirmarse el pago.

**Architecture:** Se agrega el concepto de "sesión de mesa" (`mesa_sesiones`) como fuente de verdad de "¿esta mesa está habilitada para autoservicio ahora?", separado de `mesa.estado` (que se sigue usando para el mapa de mesas de siempre). Un nuevo módulo backend público (sin autenticación) resuelve el QR, muestra el menú y crea pedidos reutilizando `ventasService.crearCompleta` + `iniciarPagoQr` tal cual existen hoy (mismo pipeline de pago QR, cocina e insumos). Un cron job limpia pagos QR abandonados. El frontend suma una página pública nueva (`/m/:codigo`), un aviso en vivo para el staff, y un filtro de origen en reportes.

**Tech Stack:** Node/Express/Sequelize (MySQL), Socket.IO, node-cron, React/Vite, TanStack Query, CodePay (ya integrado).

**Spec:** `docs/superpowers/specs/2026-08-10-autoservicio-qr-design.md`

## Global Constraints

- El autoservicio **siempre** paga por QR (CodePay) — nunca efectivo. No hay bandeja de aprobación humana.
- El QR de cada mesa es **fijo** (se genera una sola vez, `mesas.codigo_qr`), no rotativo.
- Cada ronda de pedido autoservicio es un **pedido y cobro independiente** — no hay cuenta combinada por mesa.
- La gate de "¿puedo pedir en esta mesa?" es la **sesión de mesa activa** (`mesa_sesiones`, `cerrada_en IS NULL`), no directamente `mesa.estado`.
- Los pagos QR pendientes ya expiran a los 30 minutos (`PagoQr.expires_at`, existente) — el gap a cerrar es que hoy esa expiración solo se revisa cuando alguien consulta el estado activamente; hace falta un barrido periódico.
- Reusar `ventasService.crearCompleta` / `iniciarPagoQr` / `consultarEstadoPagoQr` tal cual existen — no duplicar la lógica de precios, opciones, combos o pago QR en el módulo nuevo.
- Fuera de alcance (no implementar en este plan): pedidos "para llevar" por autoservicio, QR dinámico/rotativo, pago en efectivo desde autoservicio, cuenta combinada por mesa.

---

### Task 1: Migración 038 — sesión de mesa, código QR y origen del pedido

**Files:**
- Create: `backend/database/migrations/038_autoservicio_qr.sql`
- Modify: `bd/bd_codeculinary.sql` (sincronizar con el mismo estilo phpMyAdmin ya usado — ver migración 037 como precedente: bloque `CREATE TABLE` en orden alfabético, `ALTER TABLE` para las columnas nuevas, secciones de Índices y AUTO_INCREMENT correspondientes)

**Interfaces:**
- Produces: tabla `mesa_sesiones` (`id, mesa_id, sucursal_id, abierta_en, cerrada_en, abierta_por`), columna `mesas.codigo_qr`, columnas `pedidos.mesa_sesion_id` y `pedidos.origen` — usadas por todas las tareas siguientes.

- [ ] **Step 1: Escribir la migración**

```sql
ALTER TABLE mesas
  ADD COLUMN codigo_qr VARCHAR(32) NULL AFTER nombre,
  ADD UNIQUE KEY codigo_qr (codigo_qr);

CREATE TABLE mesa_sesiones (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  mesa_id INT UNSIGNED NOT NULL,
  sucursal_id INT UNSIGNED NOT NULL,
  abierta_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cerrada_en DATETIME NULL,
  abierta_por ENUM('staff','autoservicio') NOT NULL DEFAULT 'staff',
  FOREIGN KEY (mesa_id) REFERENCES mesas(id) ON DELETE CASCADE,
  FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE CASCADE,
  KEY mesa_activa (mesa_id, cerrada_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE pedidos
  ADD COLUMN mesa_sesion_id INT UNSIGNED NULL AFTER mesa_id,
  ADD COLUMN origen ENUM('staff','autoservicio') NOT NULL DEFAULT 'staff' AFTER tipo,
  ADD FOREIGN KEY (mesa_sesion_id) REFERENCES mesa_sesiones(id);
```

- [ ] **Step 2: Aplicar contra la base de dev**

```bash
mysql -u root bd_codeculinary < backend/database/migrations/038_autoservicio_qr.sql
```

Expected: sin errores. Verificar con `DESCRIBE mesas;`, `DESCRIBE pedidos;`, `SHOW CREATE TABLE mesa_sesiones;`.

- [ ] **Step 3: Sincronizar `bd/bd_codeculinary.sql`**

Seguir la misma disciplina usada para la migración 037 (documentada en la sesión previa): agregar el bloque `CREATE TABLE mesa_sesiones` en su posición alfabética, los `ALTER TABLE` de `mesas`/`pedidos`, y las secciones de Índices/AUTO_INCREMENT correspondientes. Verificar importando a una base descartable y comparando `information_schema.COLUMNS` contra la base real (mismo método ya usado antes en este proyecto), luego borrar la base descartable.

- [ ] **Step 4: Commit**

```bash
git add backend/database/migrations/038_autoservicio_qr.sql bd/bd_codeculinary.sql
git commit -m "feat(db): agregar sesion de mesa, codigo_qr y origen de pedido para autoservicio"
```

---

### Task 2: Modelos Sequelize — `MesaSesion` + campos nuevos en `Mesa`/`Pedido`

**Files:**
- Create: `backend/src/models/MesaSesion.js`
- Modify: `backend/src/models/Mesa.js`
- Modify: `backend/src/models/Pedido.js`
- Modify: `backend/src/models/index.js`
- Test: `backend/tests/mesa_sesiones.model.test.js`

**Interfaces:**
- Consumes: tabla `mesa_sesiones` y columnas nuevas (Task 1).
- Produces: `MesaSesion` (exportado desde `../../models`), `Mesa.mesa.codigo_qr`, `Pedido.mesa_sesion_id`, `Pedido.origen`, asociaciones `Mesa.hasMany(MesaSesion, as:'sesiones')`, `MesaSesion.belongsTo(Mesa, as:'mesa')`, `Pedido.belongsTo(MesaSesion, as:'mesa_sesion')`, `MesaSesion.hasMany(Pedido, as:'pedidos')` — usadas por Tasks 3-7.

- [ ] **Step 1: Escribir el modelo `MesaSesion`**

```javascript
// backend/src/models/MesaSesion.js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Registro de "quién está sentado en esta mesa ahora" — separado de
// mesa.estado. Mientras cerrada_en sea NULL, la mesa admite pedidos de
// autoservicio (ver mesas.service.js#obtenerSesionActiva) y el sistema
// avisa si el staff intenta abrir un pedido nuevo en la misma mesa en vez
// de mezclarlo con la sesión existente.
const MesaSesion = sequelize.define('MesaSesion', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  mesa_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  sucursal_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  abierta_en: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  cerrada_en: { type: DataTypes.DATE, allowNull: true },
  abierta_por: { type: DataTypes.ENUM('staff', 'autoservicio'), allowNull: false, defaultValue: 'staff' },
}, {
  tableName: 'mesa_sesiones',
  timestamps: false,
});

module.exports = MesaSesion;
```

- [ ] **Step 2: Agregar `codigo_qr` a `Mesa.js`**

En `backend/src/models/Mesa.js`, agregar el campo dentro de `sequelize.define('Mesa', { ... })`, después de `nombre`:

```javascript
  codigo_qr: { type: DataTypes.STRING(32), allowNull: true, unique: true },
```

- [ ] **Step 3: Agregar `mesa_sesion_id` y `origen` a `Pedido.js`**

En `backend/src/models/Pedido.js`, después de `mesa_id`:

```javascript
  mesa_sesion_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
```

Y después de `tipo`:

```javascript
  origen: { type: DataTypes.ENUM('staff', 'autoservicio'), defaultValue: 'staff' },
```

- [ ] **Step 4: Registrar el modelo y las asociaciones en `index.js`**

Agregar el require junto a `const Mesa = require('./Mesa');`:

```javascript
const MesaSesion = require('./MesaSesion');
```

Agregar junto a las asociaciones existentes de `Mesa`/`Pedido` (cerca de `Pedido.belongsTo(Mesa, ...)`):

```javascript
Mesa.hasMany(MesaSesion, { foreignKey: 'mesa_id', as: 'sesiones' });
MesaSesion.belongsTo(Mesa, { foreignKey: 'mesa_id', as: 'mesa' });
MesaSesion.belongsTo(Sucursal, { foreignKey: 'sucursal_id', as: 'sucursal' });
Pedido.belongsTo(MesaSesion, { foreignKey: 'mesa_sesion_id', as: 'mesa_sesion' });
MesaSesion.hasMany(Pedido, { foreignKey: 'mesa_sesion_id', as: 'pedidos' });
```

Agregar `MesaSesion` al `module.exports` final del archivo (junto a `Insumo, InsumoStockSucursal, ...`).

- [ ] **Step 5: Escribir el test de sanidad**

```javascript
// backend/tests/mesa_sesiones.model.test.js
const request = require('supertest');
const app = require('../src/app');
const { Sucursal, Area, Mesa, MesaSesion } = require('../src/models');

describe('Modelo MesaSesion', () => {
  let sucursalId, areaId, mesaId, sesionId;

  beforeAll(async () => {
    const sucursal = await Sucursal.create({ nombre: 'Sucursal MesaSesion Test' });
    sucursalId = sucursal.id;
    const area = await Area.create({ nombre: 'Area MesaSesion Test', sucursal_id: sucursalId });
    areaId = area.id;
    const mesa = await Mesa.create({ area_id: areaId, nombre: 'Mesa MesaSesion Test' });
    mesaId = mesa.id;
  });

  afterAll(async () => {
    await MesaSesion.destroy({ where: { mesa_id: mesaId } });
    await Mesa.destroy({ where: { id: mesaId } });
    await Area.destroy({ where: { id: areaId } });
    await Sucursal.destroy({ where: { id: sucursalId } });
  });

  it('crea una sesión de mesa y la recupera vía la asociación', async () => {
    const sesion = await MesaSesion.create({ mesa_id: mesaId, sucursal_id: sucursalId, abierta_por: 'autoservicio' });
    sesionId = sesion.id;

    const mesa = await Mesa.findByPk(mesaId, { include: [{ model: MesaSesion, as: 'sesiones' }] });
    expect(mesa.sesiones).toHaveLength(1);
    expect(mesa.sesiones[0].id).toBe(sesionId);
    expect(mesa.sesiones[0].cerrada_en).toBeNull();
  });

  it('sanidad: la app sigue arrancando con el modelo nuevo cargado', async () => {
    const res = await request(app).get('/api/v1/salud');
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 6: Correr los tests**

Run: `npm test -- mesa_sesiones.model.test.js`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add backend/src/models/MesaSesion.js backend/src/models/Mesa.js backend/src/models/Pedido.js backend/src/models/index.js backend/tests/mesa_sesiones.model.test.js
git commit -m "feat(models): agregar MesaSesion y campos de autoservicio en Mesa/Pedido"
```

---

### Task 3: `mesas.service.js` — sesión de mesa y código QR al crear la mesa

**Files:**
- Modify: `backend/src/modules/mesas/mesas.service.js`
- Test: `backend/tests/mesa_sesiones.test.js`

**Interfaces:**
- Consumes: `MesaSesion` (Task 2).
- Produces: `obtenerSesionActiva(mesa_id)`, `abrirSesion(mesa_id, sucursal_id, abierta_por, transaction)`, `cerrarSesion(mesa_id, transaction)`, `obtenerMesaPorCodigoQr(codigo_qr)` — exportados desde `mesas.service.js`, usados por Task 4 (ventas.service.js) y Task 5 (autoservicio).

- [ ] **Step 1: Escribir el test (contra la base real, mismo patrón que `mesas.test.js`)**

```javascript
// backend/tests/mesa_sesiones.test.js
const { Sucursal, Area, Mesa } = require('../src/models');
const mesasService = require('../src/modules/mesas/mesas.service');

describe('mesas.service — sesión de mesa y código QR', () => {
  let sucursalId, areaId, mesaId;

  beforeAll(async () => {
    const sucursal = await Sucursal.create({ nombre: 'Sucursal Sesion Test' });
    sucursalId = sucursal.id;
    const area = await Area.create({ nombre: 'Area Sesion Test', sucursal_id: sucursalId });
    areaId = area.id;
  });

  afterAll(async () => {
    await Mesa.destroy({ where: { area_id: areaId } });
    await Area.destroy({ where: { id: areaId } });
    await Sucursal.destroy({ where: { id: sucursalId } });
  });

  it('crearMesa genera un codigo_qr único', async () => {
    const mesa = await mesasService.crearMesa({ area_id: areaId, nombre: 'Mesa QR 1' }, sucursalId);
    mesaId = mesa.id;
    expect(mesa.codigo_qr).toEqual(expect.any(String));
    expect(mesa.codigo_qr.length).toBeGreaterThanOrEqual(16);
  });

  it('obtenerSesionActiva devuelve null si no hay sesión abierta', async () => {
    const sesion = await mesasService.obtenerSesionActiva(mesaId);
    expect(sesion).toBeNull();
  });

  it('abrirSesion crea una sesión y obtenerSesionActiva la encuentra', async () => {
    const abierta = await mesasService.abrirSesion(mesaId, sucursalId, 'staff');
    expect(abierta.cerrada_en).toBeNull();

    const activa = await mesasService.obtenerSesionActiva(mesaId);
    expect(activa.id).toBe(abierta.id);
  });

  it('abrirSesion es idempotente: si ya hay una activa, devuelve la misma en vez de crear otra', async () => {
    const primera = await mesasService.obtenerSesionActiva(mesaId);
    const segunda = await mesasService.abrirSesion(mesaId, sucursalId, 'staff');
    expect(segunda.id).toBe(primera.id);
  });

  it('cerrarSesion deja la mesa sin sesión activa', async () => {
    await mesasService.cerrarSesion(mesaId);
    const activa = await mesasService.obtenerSesionActiva(mesaId);
    expect(activa).toBeNull();
  });

  it('obtenerMesaPorCodigoQr resuelve la mesa con su área', async () => {
    const mesa = await Mesa.findByPk(mesaId);
    const resuelta = await mesasService.obtenerMesaPorCodigoQr(mesa.codigo_qr);
    expect(resuelta.id).toBe(mesaId);
    expect(resuelta.area.sucursal_id).toBe(sucursalId);
  });

  it('obtenerMesaPorCodigoQr con código inexistente lanza 404', async () => {
    await expect(mesasService.obtenerMesaPorCodigoQr('codigo-que-no-existe')).rejects.toMatchObject({ status: 404 });
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npm test -- mesa_sesiones.test.js`
Expected: FAIL — `mesasService.obtenerSesionActiva is not a function` (y similares para las otras funciones nuevas).

- [ ] **Step 3: Implementar en `mesas.service.js`**

Agregar al principio del archivo (junto al require existente):

```javascript
const crypto = require('crypto');
const { Area, Mesa, MesaSesion } = require('../../models');

function _generarCodigoQr() {
  return crypto.randomBytes(8).toString('hex');
}
```

Modificar `crearMesa` para que genere el código:

```javascript
async function crearMesa({ area_id, nombre, asientos = 4 }, sucursal_id) {
  const area = await Area.findByPk(area_id);
  if (!area) throw Object.assign(new Error('Área no encontrada'), { status: 404 });
  if (area.sucursal_id !== sucursal_id) {
    throw Object.assign(new Error('El área no pertenece a tu sucursal'), { status: 404 });
  }
  return Mesa.create({ area_id, nombre, asientos, codigo_qr: _generarCodigoQr() });
}
```

Agregar antes del `module.exports` final:

```javascript
// --- Sesión de mesa (autoservicio) ---

async function obtenerSesionActiva(mesa_id) {
  return MesaSesion.findOne({ where: { mesa_id, cerrada_en: null } });
}

async function abrirSesion(mesa_id, sucursal_id, abierta_por = 'staff', transaction) {
  const existente = await obtenerSesionActiva(mesa_id);
  if (existente) return existente;
  return MesaSesion.create({ mesa_id, sucursal_id, abierta_por }, { transaction });
}

async function cerrarSesion(mesa_id, transaction) {
  await MesaSesion.update(
    { cerrada_en: new Date() },
    { where: { mesa_id, cerrada_en: null }, transaction }
  );
}

async function obtenerMesaPorCodigoQr(codigo_qr) {
  const mesa = await Mesa.findOne({
    where: { codigo_qr },
    include: [{ model: Area, as: 'area', attributes: ['id', 'nombre', 'sucursal_id'] }],
  });
  if (!mesa) throw Object.assign(new Error('Mesa no encontrada'), { status: 404 });
  return mesa;
}
```

Actualizar el `module.exports` final para incluir las cuatro funciones nuevas:

```javascript
module.exports = {
  listarAreas, crearArea, actualizarArea, eliminarArea,
  listarMesas, obtenerMesa, crearMesa, actualizarMesa, eliminarMesa,
  obtenerSesionActiva, abrirSesion, cerrarSesion, obtenerMesaPorCodigoQr,
};
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npm test -- mesa_sesiones.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/mesas/mesas.service.js backend/tests/mesa_sesiones.test.js
git commit -m "feat(mesas): sesión de mesa y código QR para autoservicio"
```

---

### Task 4: `ventas.service.js` — integrar la sesión de mesa al flujo existente

**Files:**
- Modify: `backend/src/modules/ventas/ventas.service.js`
- Test: `backend/tests/mesa_sesiones_ventas.test.js`

**Interfaces:**
- Consumes: `mesasService.abrirSesion/cerrarSesion/obtenerSesionActiva` (Task 3).
- Produces: `crearCompleta` acepta ahora `mesa_sesion_id` y `origen` (usados por Task 5); `revertirPagosQrVencidos()` exportado (usado por Task 6).

**Contexto (ya verificado leyendo el código):** hoy `crear()` abre un pedido nuevo en una mesa y la marca `ocupada` **sin chequear si ya había otro pedido activo en esa mesa** — es el hueco real de "choque de mesa" que describe el spec. `crearCompleta()` (pedido pagado en el momento) sí bloquea con "Mesa ya ocupada" si `mesa.estado !== 'disponible'`. La mesa se libera automáticamente cuando el conteo de pedidos activos en esa mesa llega a 0 (en `_finalizarVenta` y en `cancelar`), pero ese conteo hoy solo mira `['pendiente','listo']` — un pedido QR en `'pendiente_pago'` (pago en curso) no cuenta como activo, lo cual liberaría la mesa de más si hay un cobro QR en curso en paralelo. Se corrige de paso.

- [ ] **Step 1: Escribir el test (falla porque las funciones/parámetros nuevos no existen todavía)**

```javascript
// backend/tests/mesa_sesiones_ventas.test.js
const bcrypt = require('bcryptjs');
const { Sucursal, Area, Mesa, Rol, Usuario, Caja, SesionCaja, Pedido, PagoQr } = require('../src/models');
const mesasService = require('../src/modules/mesas/mesas.service');
const ventasService = require('../src/modules/ventas/ventas.service');

describe('ventas.service — sesión de mesa integrada', () => {
  let sucursalId, mesaId, usuarioId, sesionCajaId;

  beforeAll(async () => {
    const sucursal = await Sucursal.create({ nombre: 'Sucursal VentasSesion Test' });
    sucursalId = sucursal.id;
    const area = await Area.create({ nombre: 'Area VentasSesion Test', sucursal_id: sucursalId });
    const mesa = await Mesa.create({ area_id: area.id, nombre: 'Mesa VentasSesion Test' });
    mesaId = mesa.id;
    const rol = await Rol.findOne({ where: { nombre: 'Cajero' } });
    const hash = await bcrypt.hash('clave123', 10);
    const usuario = await Usuario.create({ rol_id: rol.id, nombre: 'VentasSesion Test', email: 'ventassesion-test@restaurante.com', contrasena: hash });
    usuarioId = usuario.id;
    const caja = await Caja.create({ sucursal_id: sucursalId, nombre: 'Caja VentasSesion Test' });
    const sesionCaja = await SesionCaja.create({ usuario_id: usuarioId, sucursal_id: sucursalId, caja_id: caja.id, monto_apertura: 0 });
    sesionCajaId = sesionCaja.id;
  });

  afterAll(async () => {
    await Pedido.destroy({ where: { mesa_id: mesaId } });
    await SesionCaja.destroy({ where: { id: sesionCajaId } });
    await Usuario.destroy({ where: { id: usuarioId } });
    await Mesa.destroy({ where: { id: mesaId } });
    await Sucursal.destroy({ where: { id: sucursalId } });
  });

  it('crear() abre una sesión de mesa junto con el pedido', async () => {
    await ventasService.crear({ mesa_id: mesaId, tipo: 'mesa', usuario_id: usuarioId, sesion_caja_id: sesionCajaId });
    const activa = await mesasService.obtenerSesionActiva(mesaId);
    expect(activa).not.toBeNull();
  });

  it('crear() rechaza abrir un segundo pedido en una mesa con sesión activa', async () => {
    await expect(
      ventasService.crear({ mesa_id: mesaId, tipo: 'mesa', usuario_id: usuarioId, sesion_caja_id: sesionCajaId })
    ).rejects.toMatchObject({ status: 409 });
  });

  it('revertirPagosQrVencidos revierte un pago QR pendiente ya vencido', async () => {
    const pedido = await Pedido.create({
      sucursal_id: sucursalId, mesa_id: mesaId, usuario_id: usuarioId, sesion_caja_id: sesionCajaId,
      tipo: 'mesa', estado: 'pendiente_pago', total: 15,
    });
    await PagoQr.create({
      pedido_id: pedido.id, sucursal_id: sucursalId, order_id: `pedido_${pedido.id}_1`,
      estado: 'pendiente', estado_previo: 'pendiente', monto_neto: 15,
      expires_at: new Date(Date.now() - 60000),
    });

    const { revertidos } = await ventasService.revertirPagosQrVencidos();
    expect(revertidos).toBeGreaterThanOrEqual(1);

    const pagoQr = await PagoQr.findOne({ where: { pedido_id: pedido.id } });
    expect(pagoQr.estado).toBe('expirado');
    const actualizado = await Pedido.findByPk(pedido.id);
    expect(actualizado.estado).not.toBe('pendiente_pago');
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npm test -- mesa_sesiones_ventas.test.js`
Expected: FAIL en el segundo `it` (hoy no hay ningún chequeo, así que el segundo `crear()` no lanza error) y en el tercero (`revertirPagosQrVencidos` no existe).

- [ ] **Step 3: Importar `mesasService` y agregar el chequeo/apertura de sesión en `crear()`**

En la cabecera del archivo, agregar:

```javascript
const mesasService = require('../mesas/mesas.service');
```

Reemplazar el bloque `if (tipo === 'mesa') { ... }` dentro de `crear()` (líneas ~257-270):

```javascript
  if (tipo === 'mesa') {
    const mesa = await Mesa.findByPk(mesa_id);
    if (!mesa) throw Object.assign(new Error('Mesa no encontrada'), { status: 404 });

    const sesionExistente = await mesasService.obtenerSesionActiva(mesa_id);
    if (sesionExistente) {
      throw Object.assign(
        new Error(`Mesa ya tiene una sesión activa desde las ${sesionExistente.abierta_en.toLocaleTimeString('es-BO')}`),
        { status: 409, sesion_activa: sesionExistente }
      );
    }

    const pedido = await Pedido.create({
      mesa_id, tipo: 'mesa', usuario_id, cliente_id, sesion_caja_id, sucursal_id, notas,
      nombre_cliente: nombre_cliente || 'Público General',
      documento_cliente,
      tipo_documento: tipo_documento || 'Ticket',
    });
    await mesa.update({ estado: 'ocupada' });
    await mesasService.abrirSesion(mesa_id, sucursal_id, 'staff');
    const resultado = await obtener(pedido.id);
    emitir('restaurante:actualizar', { tipo: 'pedido_nuevo' }, sucursal_id);
    return resultado;
  }
```

- [ ] **Step 4: Cerrar la sesión de mesa cuando la mesa se libera**

En `_finalizarVenta`, dentro del bloque que libera la mesa (líneas ~338-347), ampliar el conteo de estados activos para incluir `'pendiente_pago'` (un pago QR en curso también cuenta como mesa ocupada) y cerrar la sesión junto con la liberación:

```javascript
  if (pedido.tipo !== 'llevar' && pedido.mesa_id) {
    // 'listo' también cuenta como pedido activo sin cobrar todavía, y
    // 'pendiente_pago' cubre un cobro QR en curso en otro pedido de la
    // misma mesa (autoservicio u otro) — si se ignora, la mesa se libera
    // de más mientras ese pago todavía puede confirmarse.
    const activos = await Pedido.count({ where: { mesa_id: pedido.mesa_id, estado: ['pendiente', 'listo', 'pendiente_pago'] }, transaction });
    if (activos === 0) {
      await Mesa.update({ estado: 'disponible' }, { where: { id: pedido.mesa_id }, transaction });
      await mesasService.cerrarSesion(pedido.mesa_id, transaction);
    }
  }
```

En `cancelar()` (líneas ~907-912), mismo ajuste:

```javascript
  if (pedido.tipo !== 'llevar' && pedido.mesa_id) {
    const activos = await Pedido.count({ where: { mesa_id: pedido.mesa_id, estado: ['pendiente', 'listo', 'pendiente_pago'] } });
    if (activos === 0) {
      await Mesa.update({ estado: 'disponible' }, { where: { id: pedido.mesa_id } });
      await mesasService.cerrarSesion(pedido.mesa_id);
    }
  }
```

- [ ] **Step 5: `crearCompleta` admite `mesa_sesion_id` y `origen`**

Cambiar la firma (línea ~671):

```javascript
async function crearCompleta({ tipo, mesa_id, nombre_cliente, documento_cliente, tipo_documento, notas, items, metodo_pago, monto_recibido, descuento = 0, propina = 0, sesion_caja_id, usuario_id, cliente_id, puntos_canjear = 0, cupon_codigo, mesa_sesion_id = null, origen = 'staff' }) {
```

Reemplazar el bloque de chequeo de mesa (líneas ~706-714) para omitir el bloqueo "Mesa ya ocupada" cuando ya se validó una sesión activa (caso autoservicio):

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

En la creación del `Pedido` (líneas ~732-739), agregar los dos campos:

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

- [ ] **Step 6: Agregar `revertirPagosQrVencidos`**

Cerca de `_revertirPagoQr` (línea ~565), agregar:

```javascript
// Barre pagos QR vencidos sin depender de que alguien esté consultando su
// estado activamente (ver backend/src/jobs/expirarPagosQr.job.js) — mismo
// camino que usa consultarEstadoPagoQr cuando detecta un vencido al pollear.
async function revertirPagosQrVencidos() {
  const vencidos = await PagoQr.findAll({ where: { estado: 'pendiente', expires_at: { [Op.lt]: new Date() } } });
  let revertidos = 0;
  for (const pagoQr of vencidos) {
    await _revertirPagoQr(pagoQr, 'expirado');
    revertidos++;
  }
  return { revertidos };
}
```

Agregar `revertirPagosQrVencidos` al `module.exports` final del archivo.

- [ ] **Step 7: Correr el test para verificar que pasa**

Run: `npm test -- mesa_sesiones_ventas.test.js`
Expected: PASS (3 tests).

- [ ] **Step 8: Correr la suite completa de ventas para verificar que no se rompió nada existente**

Run: `npm test -- ventas.test.js`
Expected: PASS (todos los tests existentes siguen pasando — en particular, ningún test existente abre dos pedidos seguidos en la misma mesa sin liberar la primera, así que el nuevo chequeo de sesión no debería afectarlos).

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/ventas/ventas.service.js backend/tests/mesa_sesiones_ventas.test.js
git commit -m "feat(ventas): integrar sesión de mesa, chequeo de choque y revertirPagosQrVencidos"
```

---

### Task 5: Módulo backend `autoservicio` — menú público, crear pedido, estado de pago

**Files:**
- Create: `backend/src/modules/autoservicio/autoservicio.service.js`
- Create: `backend/src/modules/autoservicio/autoservicio.controller.js`
- Create: `backend/src/modules/autoservicio/autoservicio.routes.js`
- Modify: `backend/src/app.js`
- Test: `backend/tests/autoservicio.test.js`

**Interfaces:**
- Consumes: `mesasService.obtenerMesaPorCodigoQr/obtenerSesionActiva` (Task 3), `ventasService.crearCompleta/consultarEstadoPagoQr` (Task 4/existente), `productosService.listarProductos` (existente).
- Produces: `GET /api/v1/autoservicio/mesa/:codigo_qr`, `POST /api/v1/autoservicio/mesa/:codigo_qr/pedido`, `GET /api/v1/autoservicio/mesa/:codigo_qr/pedido/:pedido_id/estado` — consumidos por Task 8 (frontend).

- [ ] **Step 1: Escribir el test**

```javascript
// backend/tests/autoservicio.test.js
const request = require('supertest');
const app = require('../src/app');
const { Sucursal, Area, Mesa, MesaSesion } = require('../src/models');

describe('Autoservicio API', () => {
  it('GET .../mesa/:codigo_qr con código inexistente → 404', async () => {
    const res = await request(app).get('/api/v1/autoservicio/mesa/no-existe-123');
    expect(res.status).toBe(404);
  });

  describe('con una mesa real', () => {
    let sucursal, area, mesa;

    beforeAll(async () => {
      sucursal = await Sucursal.create({ nombre: 'Sucursal Autoservicio Test' });
      area = await Area.create({ nombre: 'Area Autoservicio Test', sucursal_id: sucursal.id });
      mesa = await Mesa.create({ area_id: area.id, nombre: 'Mesa Autoservicio Test', codigo_qr: 'test-qr-001' });
    });

    afterAll(async () => {
      await MesaSesion.destroy({ where: { mesa_id: mesa.id } });
      await Mesa.destroy({ where: { id: mesa.id } });
      await Area.destroy({ where: { id: area.id } });
      await Sucursal.destroy({ where: { id: sucursal.id } });
    });

    it('mesa sin sesión activa → 409 al pedir el menú', async () => {
      const res = await request(app).get(`/api/v1/autoservicio/mesa/${mesa.codigo_qr}`);
      expect(res.status).toBe(409);
    });

    it('mesa con sesión activa → devuelve el menú', async () => {
      await MesaSesion.create({ mesa_id: mesa.id, sucursal_id: sucursal.id, abierta_por: 'staff' });
      const res = await request(app).get(`/api/v1/autoservicio/mesa/${mesa.codigo_qr}`);
      expect(res.status).toBe(200);
      expect(res.body.datos.mesa.id).toBe(mesa.id);
      expect(Array.isArray(res.body.datos.productos)).toBe(true);
    });

    it('crear pedido sin caja abierta en la sucursal → 409', async () => {
      const res = await request(app)
        .post(`/api/v1/autoservicio/mesa/${mesa.codigo_qr}/pedido`)
        .send({ items: [{ producto_id: 1, cantidad: 1 }] });
      expect(res.status).toBe(409);
    });

    it('crear pedido sin items → 400', async () => {
      const res = await request(app)
        .post(`/api/v1/autoservicio/mesa/${mesa.codigo_qr}/pedido`)
        .send({ items: [] });
      expect(res.status).toBe(400);
    });
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npm test -- autoservicio.test.js`
Expected: FAIL con 404 en todos (la ruta `/api/v1/autoservicio` todavía no existe).

- [ ] **Step 3: Implementar `autoservicio.service.js`**

```javascript
// backend/src/modules/autoservicio/autoservicio.service.js
const { SesionCaja } = require('../../models');
const mesasService = require('../mesas/mesas.service');
const ventasService = require('../ventas/ventas.service');
const { listarProductos } = require('../productos/productos.service');

async function _mesaConSesionActiva(codigo_qr) {
  const mesa = await mesasService.obtenerMesaPorCodigoQr(codigo_qr);
  const sesion = await mesasService.obtenerSesionActiva(mesa.id);
  if (!sesion) {
    throw Object.assign(
      new Error('Esta mesa no está habilitada para pedir ahora. Llamá al mozo o cajero.'),
      { status: 409 }
    );
  }
  return { mesa, sesion };
}

async function obtenerMenu(codigo_qr) {
  const { mesa } = await _mesaConSesionActiva(codigo_qr);
  const alcance = { sucursal_id: mesa.area.sucursal_id, acceso_todas: false };
  const productos = await listarProductos({ solo_vendibles: true, solo_disponibles: true }, alcance);
  return { mesa: { id: mesa.id, nombre: mesa.nombre }, productos };
}

async function crearPedido(codigo_qr, { items }) {
  const { mesa, sesion } = await _mesaConSesionActiva(codigo_qr);

  const sesionCaja = await SesionCaja.findOne({ where: { sucursal_id: mesa.area.sucursal_id, estado: 'abierta' } });
  if (!sesionCaja) {
    throw Object.assign(new Error('El local no está tomando pedidos por autoservicio en este momento.'), { status: 409 });
  }

  return ventasService.crearCompleta({
    tipo: 'mesa',
    mesa_id: mesa.id,
    items,
    metodo_pago: 'qr',
    sesion_caja_id: sesionCaja.id,
    usuario_id: sesionCaja.usuario_id,
    cliente_id: null,
    mesa_sesion_id: sesion.id,
    origen: 'autoservicio',
  });
}

async function consultarEstadoPedido(codigo_qr, pedido_id) {
  const { sesion } = await _mesaConSesionActiva(codigo_qr);
  const resultado = await ventasService.consultarEstadoPagoQr(pedido_id, null);
  if (resultado.pedido.mesa_sesion_id !== sesion.id) {
    // Evita que alguien consulte el estado de un pedido ajeno probando ids
    // al azar — solo se puede consultar un pedido de la sesión activa
    // resuelta por ESTE código QR.
    throw Object.assign(new Error('Pedido no encontrado'), { status: 404 });
  }
  return resultado;
}

module.exports = { obtenerMenu, crearPedido, consultarEstadoPedido };
```

- [ ] **Step 4: Implementar `autoservicio.controller.js`**

```javascript
// backend/src/modules/autoservicio/autoservicio.controller.js
const svc = require('./autoservicio.service');

async function obtenerMenu(req, res, next) {
  try { res.json({ ok: true, datos: await svc.obtenerMenu(req.params.codigo_qr) }); }
  catch (err) { next(err); }
}

async function crearPedido(req, res, next) {
  try {
    const { items } = req.body;
    if (!items || !items.length) return res.status(400).json({ ok: false, mensaje: 'items es requerido' });
    res.status(201).json({ ok: true, datos: await svc.crearPedido(req.params.codigo_qr, { items }) });
  } catch (err) { next(err); }
}

async function estadoPedido(req, res, next) {
  try { res.json({ ok: true, datos: await svc.consultarEstadoPedido(req.params.codigo_qr, req.params.pedido_id) }); }
  catch (err) { next(err); }
}

module.exports = { obtenerMenu, crearPedido, estadoPedido };
```

- [ ] **Step 5: Implementar `autoservicio.routes.js` (sin middleware de auth — es público a propósito)**

```javascript
// backend/src/modules/autoservicio/autoservicio.routes.js
const { Router } = require('express');
const ctrl = require('./autoservicio.controller');

const router = Router();

router.get('/mesa/:codigo_qr', ctrl.obtenerMenu);
router.post('/mesa/:codigo_qr/pedido', ctrl.crearPedido);
router.get('/mesa/:codigo_qr/pedido/:pedido_id/estado', ctrl.estadoPedido);

module.exports = router;
```

- [ ] **Step 6: Montar el router en `app.js`**

Agregar el require junto a los demás routers, y `app.use('/api/v1/autoservicio', autoservicioRoutes);` junto a las otras líneas `app.use('/api/v1/...')`.

- [ ] **Step 7: Correr el test para verificar que pasa**

Run: `npm test -- autoservicio.test.js`
Expected: PASS (5 tests).

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/autoservicio backend/src/app.js backend/tests/autoservicio.test.js
git commit -m "feat(autoservicio): endpoints públicos de menú, pedido y estado de pago"
```

---

### Task 6: Job de expiración de pagos QR abandonados

**Files:**
- Create: `backend/src/jobs/expirarPagosQr.job.js`
- Modify: `backend/src/server.js`
- Test: `backend/tests/expirar_pagos_qr.job.test.js`

**Interfaces:**
- Consumes: `ventasService.revertirPagosQrVencidos()` (Task 4).
- Produces: `expirarPagosQrVencidos()` exportado desde `expirarPagosQr.job.js`.

- [ ] **Step 1: Escribir el test**

```javascript
// backend/tests/expirar_pagos_qr.job.test.js
const bcrypt = require('bcryptjs');
const { Sucursal, Area, Mesa, Rol, Usuario, Caja, SesionCaja, Pedido, PagoQr } = require('../src/models');
const { expirarPagosQrVencidos } = require('../src/jobs/expirarPagosQr.job');

describe('Job: expirar pagos QR vencidos', () => {
  let sucursalId, pedidoId;

  beforeAll(async () => {
    const sucursal = await Sucursal.create({ nombre: 'Sucursal ExpiraQr Test' });
    sucursalId = sucursal.id;
    const area = await Area.create({ nombre: 'Area ExpiraQr Test', sucursal_id: sucursalId });
    const mesa = await Mesa.create({ area_id: area.id, nombre: 'Mesa ExpiraQr Test' });
    const rol = await Rol.findOne({ where: { nombre: 'Cajero' } });
    const hash = await bcrypt.hash('clave123', 10);
    const usuario = await Usuario.create({ rol_id: rol.id, nombre: 'ExpiraQr Test', email: 'expiraqr-test@restaurante.com', contrasena: hash });
    const caja = await Caja.create({ sucursal_id: sucursalId, nombre: 'Caja ExpiraQr Test' });
    const sesionCaja = await SesionCaja.create({ usuario_id: usuario.id, sucursal_id: sucursalId, caja_id: caja.id, monto_apertura: 0 });
    const pedido = await Pedido.create({
      sucursal_id: sucursalId, mesa_id: mesa.id, usuario_id: usuario.id, sesion_caja_id: sesionCaja.id,
      tipo: 'mesa', estado: 'pendiente_pago', total: 25,
    });
    pedidoId = pedido.id;
    await PagoQr.create({
      pedido_id: pedidoId, sucursal_id: sucursalId, order_id: `pedido_${pedidoId}_1`,
      estado: 'pendiente', estado_previo: 'pendiente', monto_neto: 25,
      expires_at: new Date(Date.now() - 60000),
    });
  });

  afterAll(async () => {
    await PagoQr.destroy({ where: { pedido_id: pedidoId } });
    await Pedido.destroy({ where: { id: pedidoId } });
    await Sucursal.destroy({ where: { id: sucursalId } });
  });

  it('revierte pagos QR pendientes ya vencidos', async () => {
    const { revertidos } = await expirarPagosQrVencidos();
    expect(revertidos).toBeGreaterThanOrEqual(1);

    const pagoQr = await PagoQr.findOne({ where: { pedido_id: pedidoId } });
    expect(pagoQr.estado).toBe('expirado');
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npm test -- expirar_pagos_qr.job.test.js`
Expected: FAIL — `Cannot find module '../src/jobs/expirarPagosQr.job'`.

- [ ] **Step 3: Implementar el job**

```javascript
// backend/src/jobs/expirarPagosQr.job.js
const { revertirPagosQrVencidos } = require('../modules/ventas/ventas.service');

async function expirarPagosQrVencidos() {
  return revertirPagosQrVencidos();
}

module.exports = { expirarPagosQrVencidos };
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npm test -- expirar_pagos_qr.job.test.js`
Expected: PASS.

- [ ] **Step 5: Programar el job en `server.js`**

Agregar el require junto al de `cumpleanos.job`:

```javascript
const { expirarPagosQrVencidos } = require('./jobs/expirarPagosQr.job');
```

Agregar la función wrapper junto a `_correrJobCumpleanos`:

```javascript
function _correrJobExpirarPagosQr() {
  expirarPagosQrVencidos()
    .then(({ revertidos }) => { if (revertidos > 0) console.log(`Pagos QR vencidos revertidos: ${revertidos}`); })
    .catch(err => console.error('Error revirtiendo pagos QR vencidos:', err));
}
```

Agregar la programación junto a `cron.schedule('0 8 * * *', ...)`, cada 5 minutos (no depende de hora de negocio, corre siempre):

```javascript
    cron.schedule('*/5 * * * *', _correrJobExpirarPagosQr);
```

- [ ] **Step 6: Verificar que el servidor sigue arrancando**

Run: `npm test -- salud` (o cualquier test que golpee `GET /api/v1/salud`, ej. reusar `mesa_sesiones.model.test.js`)
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/jobs/expirarPagosQr.job.js backend/src/server.js backend/tests/expirar_pagos_qr.job.test.js
git commit -m "feat(jobs): barrido periódico de pagos QR vencidos cada 5 minutos"
```

---

### Task 7: Socket.IO — aviso en vivo de pedido autoservicio confirmado

**Files:**
- Modify: `backend/src/modules/ventas/ventas.service.js`
- Test: `backend/tests/autoservicio_socket.test.js`

**Interfaces:**
- Produces: evento `restaurante:autoservicio_confirmado` (payload `{ pedido_id, mesa, monto }`), emitido a la sala `sucursal:<id>` — consumido por Task 10 (frontend).

- [ ] **Step 1: Escribir el test (mockeando el módulo de socket para espiar `emitir`)**

```javascript
// backend/tests/autoservicio_socket.test.js
jest.mock('../src/socket', () => ({ emitir: jest.fn(), init: jest.fn() }));
const { emitir } = require('../src/socket');
const bcrypt = require('bcryptjs');
const { Sucursal, Area, Mesa, MesaSesion, Rol, Usuario, Caja, SesionCaja, Pedido, PagoQr } = require('../src/models');
const { procesarWebhookPagoQr } = require('../src/modules/ventas/ventas.service');

describe('Socket: pedido autoservicio confirmado', () => {
  let pedidoId, orderId, sucursalId;

  beforeAll(async () => {
    const sucursal = await Sucursal.create({ nombre: 'Sucursal Socket Autoservicio Test' });
    sucursalId = sucursal.id;
    const area = await Area.create({ nombre: 'Area Socket Autoservicio Test', sucursal_id: sucursalId });
    const mesa = await Mesa.create({ area_id: area.id, nombre: 'Mesa Socket Autoservicio Test' });
    const sesionMesa = await MesaSesion.create({ mesa_id: mesa.id, sucursal_id: sucursalId, abierta_por: 'autoservicio' });
    const rol = await Rol.findOne({ where: { nombre: 'Cajero' } });
    const hash = await bcrypt.hash('clave123', 10);
    const usuario = await Usuario.create({ rol_id: rol.id, nombre: 'Socket Autoservicio Test', email: 'socket-autoservicio-test@restaurante.com', contrasena: hash });
    const caja = await Caja.create({ sucursal_id: sucursalId, nombre: 'Caja Socket Autoservicio Test' });
    const sesionCaja = await SesionCaja.create({ usuario_id: usuario.id, sucursal_id: sucursalId, caja_id: caja.id, monto_apertura: 0 });
    const pedido = await Pedido.create({
      sucursal_id: sucursalId, mesa_id: mesa.id, mesa_sesion_id: sesionMesa.id, origen: 'autoservicio',
      usuario_id: usuario.id, sesion_caja_id: sesionCaja.id, tipo: 'mesa', estado: 'pendiente_pago', total: 30,
    });
    pedidoId = pedido.id;
    orderId = `pedido_${pedidoId}_1`;
    await PagoQr.create({
      pedido_id: pedidoId, sucursal_id: sucursalId, order_id: orderId,
      estado: 'pendiente', estado_previo: 'pendiente', monto_neto: 30,
      expires_at: new Date(Date.now() + 30 * 60000),
    });
  });

  afterAll(async () => {
    await PagoQr.destroy({ where: { pedido_id: pedidoId } });
    await Pedido.destroy({ where: { id: pedidoId } });
    await Sucursal.destroy({ where: { id: sucursalId } });
  });

  it('emite restaurante:autoservicio_confirmado al confirmarse el pago', async () => {
    await procesarWebhookPagoQr({ event: 'payment.completed', order_id: orderId });

    const eventos = emitir.mock.calls.map(c => c[0]);
    expect(eventos).toContain('restaurante:autoservicio_confirmado');

    const llamadaAutoservicio = emitir.mock.calls.find(c => c[0] === 'restaurante:autoservicio_confirmado');
    expect(llamadaAutoservicio[1]).toMatchObject({ pedido_id: pedidoId, monto: 30 });
    expect(llamadaAutoservicio[2]).toBe(sucursalId);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npm test -- autoservicio_socket.test.js`
Expected: FAIL — `eventos` no contiene `'restaurante:autoservicio_confirmado'`.

- [ ] **Step 3: Emitir el evento en `_confirmarPagoQr`**

En `_confirmarPagoQr` (línea ~606-608), después del `emitir('restaurante:actualizar', ...)` existente:

```javascript
  const completado = await obtener(pedidoId);
  emitir('restaurante:actualizar', { tipo: 'pedido_cobrado' }, completado.sucursal_id);
  if (completado.origen === 'autoservicio') {
    emitir('restaurante:autoservicio_confirmado', {
      pedido_id: completado.id,
      mesa: completado.mesa?.nombre ?? null,
      monto: parseFloat(completado.total),
    }, completado.sucursal_id);
  }
  await _emitirImpresion(completado, 'qr', 0, completado.sucursal_id);
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npm test -- autoservicio_socket.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/ventas/ventas.service.js backend/tests/autoservicio_socket.test.js
git commit -m "feat(socket): avisar en vivo cuando se confirma un pedido de autoservicio"
```

---

### Task 8: Frontend — página pública de autoservicio (`/m/:codigo`)

**Files:**
- Create: `frontend/src/api/autoservicio.js`
- Create: `frontend/src/pages/autoservicio/AutoservicioPage.jsx`
- Modify: `frontend/src/router/index.jsx`

**Interfaces:**
- Consumes: `GET/POST /api/v1/autoservicio/mesa/:codigo_qr...` (Task 5), `getConfiguracionPublica` (existente, para nombre/logo del negocio).
- Produces: ruta pública `/m/:codigo`, sin layout ni login.

- [ ] **Step 1: Cliente de API**

```javascript
// frontend/src/api/autoservicio.js
import api from './cliente';

export const getMenuAutoservicio = (codigo) =>
  api.get(`/autoservicio/mesa/${codigo}`).then(r => r.data.datos);

export const crearPedidoAutoservicio = (codigo, items) =>
  api.post(`/autoservicio/mesa/${codigo}/pedido`, { items }).then(r => r.data.datos);

export const getEstadoPedidoAutoservicio = (codigo, pedidoId) =>
  api.get(`/autoservicio/mesa/${codigo}/pedido/${pedidoId}/estado`).then(r => r.data.datos);
```

- [ ] **Step 2: Página pública — menú, carrito y flujo de pago**

```jsx
// frontend/src/pages/autoservicio/AutoservicioPage.jsx
import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Plus, Minus, ShoppingCart, X, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { getMenuAutoservicio, crearPedidoAutoservicio, getEstadoPedidoAutoservicio } from '../../api/autoservicio';
import { getConfiguracionPublica, logoSrc } from '../../api/configuracion';

const bs = (n) => `Bs ${parseFloat(n || 0).toFixed(2)}`;

export default function AutoservicioPage() {
  const { codigo } = useParams();
  const [carrito, setCarrito] = useState([]); // [{ producto, opcion_ids, cantidad }]
  const [mostrarCarrito, setMostrarCarrito] = useState(false);
  const [pedido, setPedido] = useState(null); // { pedido, pago_qr } luego de confirmar

  const { data: config } = useQuery({ queryKey: ['configuracion-publica'], queryFn: getConfiguracionPublica });
  const { data: menu, isLoading, isError, error } = useQuery({
    queryKey: ['autoservicio-menu', codigo],
    queryFn: () => getMenuAutoservicio(codigo),
    retry: false,
  });

  const totalCarrito = useMemo(
    () => carrito.reduce((s, l) => s + l.producto.precio * l.cantidad, 0),
    [carrito]
  );

  const agregarAlCarrito = (producto) => {
    setCarrito((c) => [...c, { producto, opcion_ids: [], cantidad: 1 }]);
  };

  const quitarDelCarrito = (idx) => setCarrito((c) => c.filter((_, i) => i !== idx));

  const crear = useMutation({
    mutationFn: () => crearPedidoAutoservicio(codigo, carrito.map(l => ({
      producto_id: l.producto.id, cantidad: l.cantidad, opcion_ids: l.opcion_ids,
    }))),
    onSuccess: (datos) => setPedido(datos),
  });

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  if (isError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertCircle className="w-10 h-10 text-muted-foreground" />
        <p className="text-foreground font-medium">
          {error?.response?.data?.mensaje ?? 'Esta mesa no está habilitada para pedir ahora.'}
        </p>
        <p className="text-sm text-muted-foreground">Llamá al mozo o cajero para que te ayude.</p>
      </div>
    );
  }

  if (pedido) {
    return <EsperaPago codigo={codigo} pedido={pedido} onNuevoPedido={() => { setPedido(null); setCarrito([]); }} />;
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="flex items-center gap-3 p-4 border-b border-border bg-card sticky top-0 z-10">
        {config?.logo && <img src={logoSrc(config.logo)} alt="" className="w-10 h-10 rounded-lg object-contain" />}
        <div>
          <p className="font-bold text-foreground">{config?.nombre_negocio ?? 'Menú'}</p>
          <p className="text-xs text-muted-foreground">{menu.mesa.nombre}</p>
        </div>
      </header>

      <div className="p-4 space-y-3">
        {menu.productos.map((p) => (
          <div key={p.id} className="bg-card border border-border rounded-xl p-3.5 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="font-medium text-foreground truncate">{p.nombre}</p>
              <p className="text-sm text-muted-foreground">{bs(p.precio)}</p>
            </div>
            <button
              onClick={() => agregarAlCarrito(p)}
              className="p-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      {carrito.length > 0 && (
        <button
          onClick={() => setMostrarCarrito(true)}
          className="fixed bottom-4 left-4 right-4 flex items-center justify-between px-5 py-3.5 rounded-xl bg-primary text-primary-foreground font-semibold shadow-lg"
        >
          <span className="flex items-center gap-2"><ShoppingCart className="w-5 h-5" /> {carrito.length} ítem{carrito.length !== 1 ? 's' : ''}</span>
          <span>{bs(totalCarrito)}</span>
        </button>
      )}

      {mostrarCarrito && (
        <div className="fixed inset-0 z-20 flex items-end bg-black/50">
          <div className="w-full bg-card rounded-t-2xl p-4 space-y-3 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-foreground">Tu pedido</h2>
              <button onClick={() => setMostrarCarrito(false)}><X className="w-5 h-5 text-muted-foreground" /></button>
            </div>
            {carrito.map((l, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-foreground">{l.producto.nombre} x{l.cantidad}</span>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">{bs(l.producto.precio * l.cantidad)}</span>
                  <button onClick={() => quitarDelCarrito(i)}><Minus className="w-4 h-4 text-destructive" /></button>
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between font-bold text-foreground pt-2 border-t border-border">
              <span>Total</span><span>{bs(totalCarrito)}</span>
            </div>
            {crear.isError && (
              <p className="text-sm text-destructive">{crear.error?.response?.data?.mensaje ?? 'No se pudo crear el pedido.'}</p>
            )}
            <button
              onClick={() => crear.mutate()}
              disabled={crear.isPending}
              className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-60"
            >
              {crear.isPending ? 'Enviando...' : 'Pagar con QR'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function EsperaPago({ codigo, pedido, onNuevoPedido }) {
  const { data: estado } = useQuery({
    queryKey: ['autoservicio-estado', pedido.pedido.id],
    queryFn: () => getEstadoPedidoAutoservicio(codigo, pedido.pedido.id),
    refetchInterval: (query) => (query.state.data?.estado === 'pendiente' ? 3000 : false),
  });

  const estadoActual = estado?.estado ?? 'pendiente';

  if (estadoActual === 'completado') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-6 text-center">
        <CheckCircle2 className="w-14 h-14 text-emerald-500" />
        <p className="text-lg font-bold text-foreground">¡Pago confirmado!</p>
        <p className="text-sm text-muted-foreground">Tu pedido ya está en cocina.</p>
        <button onClick={onNuevoPedido} className="mt-4 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-medium">
          Pedir algo más
        </button>
      </div>
    );
  }

  if (estadoActual === 'expirado' || estadoActual === 'fallido' || estadoActual === 'cancelado') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertCircle className="w-14 h-14 text-destructive" />
        <p className="text-lg font-bold text-foreground">El pago no se completó</p>
        <button onClick={onNuevoPedido} className="mt-4 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-medium">
          Volver a intentar
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-lg font-bold text-foreground">Escaneá el QR con tu app del banco</p>
      {pedido.pago_qr?.qr_code && (
        <img src={pedido.pago_qr.qr_code} alt="QR de pago" className="w-56 h-56 rounded-xl border border-border" />
      )}
      <p className="text-2xl font-bold text-foreground">{bs(pedido.pago_qr?.monto_total)}</p>
      <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Esperando confirmación...</p>
    </div>
  );
}
```

- [ ] **Step 3: Registrar la ruta pública**

En `frontend/src/router/index.jsx`, importar el componente junto a `LoginPage`:

```javascript
import AutoservicioPage from '../pages/autoservicio/AutoservicioPage';
```

Y agregar la ruta al mismo nivel que `/login` (fuera de `RutaProtegida`), antes del array de rutas protegidas:

```javascript
    { path: '/login', element: <LoginPage /> },
    { path: '/m/:codigo', element: <AutoservicioPage /> },
```

- [ ] **Step 4: Verificar manualmente**

Run: `cd frontend && npm run build`
Expected: build sin errores.

Con el backend corriendo, crear una mesa de prueba con `codigo_qr` conocido (vía `crearMesa` o directo en la BD), abrir una sesión con `abrirSesion` desde la consola de Node o iniciando una venta normal en esa mesa desde el POS, y visitar `http://localhost:5173/m/<codigo_qr>` — debe mostrar el menú.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/autoservicio.js frontend/src/pages/autoservicio/AutoservicioPage.jsx frontend/src/router/index.jsx
git commit -m "feat(autoservicio): página pública de pedido por QR en mesa"
```

---

### Task 9: Frontend — ver e imprimir el código QR de cada mesa

**Files:**
- Modify: `frontend/package.json` (nueva dependencia `qrcode`)
- Modify: `frontend/src/pages/configuracion/tabs/TabMesas.jsx`

**Interfaces:**
- Consumes: `mesa.codigo_qr` (ya viaja en la respuesta de `GET /mesas` desde Task 3, sin cambios de API).

- [ ] **Step 1: Instalar la librería de generación de QR**

```bash
cd frontend && npm install qrcode
```

- [ ] **Step 2: Agregar un botón "Ver QR" por mesa y un modal que lo muestra/imprime**

En `frontend/src/pages/configuracion/tabs/TabMesas.jsx`, importar arriba:

```javascript
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { QrCode, Printer } from 'lucide-react';
```

(La línea `import { useState } from 'react';` existente se reemplaza por la de arriba, que suma `useEffect`.)

Agregar, junto a `EstadoBadge` al final del archivo, un componente para el modal del QR:

```javascript
function ModalCodigoQr({ mesa, onClose }) {
  const [dataUrl, setDataUrl] = useState(null);
  const url = `${window.location.origin}/m/${mesa.codigo_qr}`;

  useEffect(() => {
    QRCode.toDataURL(url, { width: 320, margin: 1 }).then(setDataUrl);
  }, [url]);

  return (
    <Modal titulo={`QR — ${mesa.nombre}`} onClose={onClose}>
      <div className="flex flex-col items-center gap-4">
        {dataUrl ? (
          <img src={dataUrl} alt={`QR de ${mesa.nombre}`} className="w-64 h-64" id="qr-imprimir" />
        ) : (
          <div className="w-64 h-64 flex items-center justify-center text-muted-foreground">Generando...</div>
        )}
        <p className="text-xs text-muted-foreground break-all text-center">{url}</p>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium"
        >
          <Printer className="w-4 h-4" /> Imprimir
        </button>
      </div>
    </Modal>
  );
}
```

En el componente principal `TabMesas`, agregar el estado y el botón junto a los de editar/eliminar (tanto en la tarjeta móvil como en la fila de la tabla de escritorio):

```javascript
  const [modalQr, setModalQr] = useState(null); // null | mesa
```

Botón (agregar junto al de `Pencil` en ambos bloques, móvil y escritorio):

```jsx
<button onClick={() => setModalQr(mesa)} title="Ver código QR" className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
  <QrCode className="w-3.5 h-3.5" />
</button>
```

Y renderizar el modal junto a los otros modales del componente:

```jsx
{modalQr && <ModalCodigoQr mesa={modalQr} onClose={() => setModalQr(null)} />}
```

- [ ] **Step 3: Verificar manualmente**

Run: `cd frontend && npm run build`
Expected: build sin errores. En el navegador, entrar a Configuración → Mesas, abrir "Ver código QR" en una mesa y confirmar que se ve la imagen del QR y que apunta a `/m/<codigo_qr>` de esa mesa.

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/pages/configuracion/tabs/TabMesas.jsx
git commit -m "feat(mesas): ver e imprimir el código QR de autoservicio de cada mesa"
```

---

### Task 10: Frontend — aviso en vivo de pedidos autoservicio para el staff

**Files:**
- Create: `frontend/src/components/layout/AvisoAutoservicio.jsx`
- Modify: `frontend/src/components/layout/Layout.jsx`

**Interfaces:**
- Consumes: evento de socket `restaurante:autoservicio_confirmado` (Task 7), `frontend/src/socket.js` (singleton existente).

- [ ] **Step 1: Componente de aviso (mismo patrón de toast usado en otras páginas de este proyecto)**

```jsx
// frontend/src/components/layout/AvisoAutoservicio.jsx
import { useEffect, useState } from 'react';
import { ShoppingBag } from 'lucide-react';
import socket from '../../socket';

export default function AvisoAutoservicio() {
  const [aviso, setAviso] = useState(null);

  useEffect(() => {
    function onConfirmado(datos) {
      setAviso(datos);
      setTimeout(() => setAviso(null), 6000);
    }
    socket.on('restaurante:autoservicio_confirmado', onConfirmado);
    return () => socket.off('restaurante:autoservicio_confirmado', onConfirmado);
  }, []);

  if (!aviso) return null;

  return (
    <div
      className="fixed top-5 right-5 z-[100] px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white bg-violet-600 flex items-center gap-2"
      style={{ animation: 'toastIn .25s ease both' }}
    >
      <style>{`@keyframes toastIn { from { opacity:0; transform:translateX(20px); } to { opacity:1; transform:translateX(0); } }`}</style>
      <ShoppingBag className="w-4 h-4" />
      Autoservicio — {aviso.mesa ?? 'Mesa'}: Bs {parseFloat(aviso.monto || 0).toFixed(2)}
    </div>
  );
}
```

- [ ] **Step 2: Montarlo en `Layout.jsx`**

```javascript
import AvisoAutoservicio from './AvisoAutoservicio';
```

Agregar `<AvisoAutoservicio />` junto a `<BotonCocinaPendiente />` dentro del `return` de `Layout`.

- [ ] **Step 3: Verificar manualmente**

Run: `cd frontend && npm run build`
Expected: build sin errores. Con el backend corriendo, disparar manualmente el evento desde una consola de Node conectada al mismo proceso (o completar un pedido de autoservicio real de punta a punta) y confirmar que el aviso aparece en cualquier pantalla del staff logueado.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/layout/AvisoAutoservicio.jsx frontend/src/components/layout/Layout.jsx
git commit -m "feat(staff): aviso en vivo de pedidos autoservicio confirmados"
```

---

### Task 11: Frontend — filtro de origen en el reporte de Ventas

**Files:**
- Modify: `frontend/src/pages/reportes/tabs/TabVentas.jsx`

**Interfaces:**
- Consumes: `v.origen` (ya viaja en cada pedido del reporte de ventas — `Pedido` incluye la columna sin necesitar cambios en `reportes.service.js`, porque `ventas()` en ese servicio no restringe atributos del `Pedido` base, ver `backend/src/modules/reportes/reportes.service.js`).

- [ ] **Step 1: Agregar el filtro de origen**

En `TabVentas.jsx`, agregar el estado junto a `filtroTipo`:

```javascript
  const [filtroOrigen, setFiltroOrigen] = useState('todos');
```

En el `useMemo` de `filtrado`, agregar la condición junto a la de `filtroTipo`:

```javascript
    if (filtroOrigen !== 'todos') {
      base = base.filter(v => (v.origen || 'staff') === filtroOrigen);
    }
```

(y agregar `filtroOrigen` a las dependencias del `useMemo`).

Agregar el `<select>` en el bloque de filtros, junto al de "Tipo de venta":

```jsx
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Origen</label>
            <select value={filtroOrigen} onChange={e => setFiltroOrigen(e.target.value)}
              className="px-3 py-2 text-sm rounded-xl border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
              <option value="todos">Todos</option>
              <option value="staff">Tomado por staff</option>
              <option value="autoservicio">Autoservicio</option>
            </select>
          </div>
```

- [ ] **Step 2: Reflejarlo en el PDF exportado**

En la función `exportar`, agregar el origen al subtítulo (junto a `tipoVentaLabel`) y una columna más:

```javascript
  const origenLabel = filtroOrigen === 'todos' ? 'Staff y autoservicio' : (filtroOrigen === 'autoservicio' ? 'Autoservicio' : 'Tomado por staff');
```

Sumar `· ${origenLabel}` al `subtitulo`, y `'Origen'` a `columnas` con `(v.origen === 'autoservicio' ? 'Autoservicio' : 'Staff')` en cada fila de `filas`.

- [ ] **Step 3: Verificar manualmente**

Run: `cd frontend && npm run build`
Expected: build sin errores. En el navegador, entrar a Reportes → Ventas y confirmar que el filtro de Origen aparece y filtra correctamente (los pedidos existentes, todos con `origen` por defecto `'staff'`, deben seguir apareciendo con "Todos" y con "Tomado por staff").

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/reportes/tabs/TabVentas.jsx
git commit -m "feat(reportes): filtro de origen (staff/autoservicio) en el reporte de ventas"
```

---

## Verificación final

- [ ] `cd backend && npm test` — toda la suite pasa, incluyendo los archivos nuevos de esta feature.
- [ ] `cd frontend && npm run build` — build sin errores.
- [ ] Flujo manual completo en dev: crear una mesa (genera `codigo_qr`), abrir una venta en esa mesa desde el POS (abre la sesión), abrir `/m/<codigo_qr>` en otra pestaña/celular, armar un pedido, pagar con el sandbox de CodePay, confirmar que aparece en cocina y que el aviso en vivo se dispara en la pantalla del staff.
