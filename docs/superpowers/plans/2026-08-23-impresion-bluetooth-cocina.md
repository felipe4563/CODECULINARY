# Impresión Bluetooth en cocina + estado de agentes — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la comanda de cocina se imprima sola en modo Bluetooth para pedidos de autoservicio (sin cajero vendiendo), y que se pueda ver desde el Dashboard si el agente de impresión física de cada caja está conectado.

**Architecture:** Una pantalla nueva de staff escucha `print:cocina` por socket y dispara Bluetooth ella misma, opt-in vía `Configuracion.cocina_pantalla_dedicada` para no duplicar tickets en locales que hoy imprimen todo desde un solo dispositivo. En paralelo, `print-agent/agent.js` se identifica al conectar; `backend/src/socket.js` lleva un mapa en memoria de agentes conectados y lo expone por API + evento de socket para un widget en el Dashboard.

**Tech Stack:** Node/Express/Sequelize/MySQL (backend), React/Vite + Zustand + TanStack Query (frontend), socket.io / socket.io-client, RawBT (ESC/POS vía URL scheme).

**Spec:** `docs/superpowers/specs/2026-08-23-impresion-bluetooth-cocina-design.md`

## Global Constraints

- Backend tests: `cd backend && npx jest <archivo> --runInBand`. Usar identificadores de fixtures con sufijo `Date.now()` (nunca hardcodeados) — un test con email/nombre fijo deja basura que rompe corridas futuras (ver historial de este repo).
- Frontend no tiene test runner (`vitest`/`@testing-library` no están instalados) — cada tarea de frontend se verifica con `npx eslint <archivo>` + `npm run build`, sin tests automatizados.
- Todas las claves de `Configuracion` son filas de la tabla `configuraciones` (`clave`, `valor`), no columnas — seguir el patrón de migraciones anteriores (`024_fidelidad.sql`).
- El patrón `alcance` (`{ sucursal_id, acceso_todas }`) ya lo usan todos los módulos staff — sacarlo de `req.usuario` en el controller, nunca inventar uno nuevo.
- No tocar `frontend/src/utils/escpos.js` ni `frontend/src/utils/rawbt.js` — ya soportan exactamente el payload que emite `_emitirImpresion`, no hace falta cambiarlos.

---

### Task 1: Config `cocina_pantalla_dedicada` viaja en el payload de impresión

**Files:**
- Create: `backend/database/migrations/041_impresion_dedicada.sql`
- Modify: `backend/src/modules/ventas/ventas.service.js:469` (lista de claves que lee `_emitirImpresion`)
- Test: `backend/tests/impresion_ticket.test.js`

**Interfaces:**
- Produces: `datosCocina.config.cocina_pantalla_dedicada` (`'true'`/`'false'`/`undefined`), disponible en cualquier lugar que reciba el payload de `print:cocina` (Task 6, Task 8 lo consumen).

- [ ] **Step 1: Migración**

```sql
-- backend/database/migrations/041_impresion_dedicada.sql
INSERT INTO configuraciones (clave, valor) VALUES ('cocina_pantalla_dedicada', 'false')
  ON DUPLICATE KEY UPDATE valor = valor;
```

- [ ] **Step 2: Aplicar la migración a la base local de desarrollo**

```bash
cd backend && node -e "
require('dotenv').config();
const sequelize = require('./src/config/database');
const fs = require('fs');
sequelize.query(fs.readFileSync('database/migrations/041_impresion_dedicada.sql', 'utf8'))
  .then(() => console.log('OK'))
  .catch(e => console.log('ERR', e.message))
  .finally(() => process.exit());
"
```

- [ ] **Step 3: Escribir el test (falla primero)**

```js
// backend/tests/impresion_ticket.test.js
jest.mock('../src/socket', () => ({ emitir: jest.fn(), init: jest.fn(), estadoAgentes: jest.fn() }));
const { emitir } = require('../src/socket');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../src/app');
const {
  Sucursal, Area, Mesa, Categoria, Producto, ProductoStockSucursal,
  Usuario, Rol, Caja, SesionCaja, Pedido, RegistroInventario, LibroCaja, Configuracion,
} = require('../src/models');

describe('_emitirImpresion — cocina_pantalla_dedicada viaja en el payload', () => {
  let sucursal, usuario, token, sesionCaja, caja, producto, mesa;
  let configFlujoOriginal, configPantallaOriginal;

  beforeAll(async () => {
    const timestamp = Date.now();
    sucursal = await Sucursal.create({ nombre: `Sucursal Impresion Ticket Test ${timestamp}` });
    const area = await Area.create({ nombre: `Area Impresion Ticket Test ${timestamp}`, sucursal_id: sucursal.id });
    mesa = await Mesa.create({ area_id: area.id, nombre: 'Mesa Impresion Ticket Test' });

    const categoria = await Categoria.create({ nombre: `Categoria Impresion Ticket Test ${timestamp}` });
    producto = await Producto.create({ categoria_id: categoria.id, nombre: `Producto Impresion Ticket Test ${timestamp}`, precio: 10, stock: 0 });
    await ProductoStockSucursal.create({ producto_id: producto.id, sucursal_id: sucursal.id, stock: 5 });

    const rol = await Rol.findOne({ where: { nombre: 'Cajero' } });
    const hash = await bcrypt.hash('clave123', 10);
    usuario = await Usuario.create({ rol_id: rol.id, nombre: `Impresion Ticket Test ${timestamp}`, email: `impresion-ticket-test-${timestamp}@restaurante.com`, contrasena: hash });
    await usuario.addSucursal(sucursal);

    const login = await request(app).post('/api/v1/auth/login').send({ email: usuario.email, contrasena: 'clave123' });
    token = login.body.datos.token;

    caja = await Caja.create({ sucursal_id: sucursal.id, nombre: 'Caja Impresion Ticket Test', modo_impresion: 'bluetooth' });
    sesionCaja = await SesionCaja.create({ usuario_id: usuario.id, sucursal_id: sucursal.id, caja_id: caja.id, monto_apertura: 0 });

    configFlujoOriginal = await Configuracion.findOne({ where: { clave: 'flujo_cocina' } });
    configPantallaOriginal = await Configuracion.findOne({ where: { clave: 'cocina_pantalla_dedicada' } });
    await Configuracion.upsert({ clave: 'flujo_cocina', valor: 'fisico' });
    await Configuracion.upsert({ clave: 'cocina_pantalla_dedicada', valor: 'true' });
  });

  afterAll(async () => {
    if (configFlujoOriginal) await Configuracion.upsert({ clave: 'flujo_cocina', valor: configFlujoOriginal.valor });
    else await Configuracion.destroy({ where: { clave: 'flujo_cocina' } });
    if (configPantallaOriginal) await Configuracion.upsert({ clave: 'cocina_pantalla_dedicada', valor: configPantallaOriginal.valor });
    else await Configuracion.destroy({ where: { clave: 'cocina_pantalla_dedicada' } });

    await Pedido.destroy({ where: { usuario_id: usuario.id } });
    await RegistroInventario.destroy({ where: { usuario_id: usuario.id } });
    await LibroCaja.destroy({ where: { usuario_id: usuario.id } });
    await SesionCaja.destroy({ where: { id: sesionCaja.id } });
    await Caja.destroy({ where: { id: caja.id } });
    await Usuario.destroy({ where: { id: usuario.id } });
  });

  it('print:cocina lleva cocina_pantalla_dedicada en config, y la respuesta HTTP también', async () => {
    emitir.mockClear();
    const res = await request(app)
      .post('/api/v1/ventas/completa')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'llevar', metodo_pago: 'efectivo', monto_recibido: 10, sesion_caja_id: sesionCaja.id,
        items: [{ producto_id: producto.id, cantidad: 1 }],
      });

    expect(res.status).toBe(201);
    expect(res.body.datos.datos_impresion.cocina.config.cocina_pantalla_dedicada).toBe('true');

    const llamadaCocina = emitir.mock.calls.find((c) => c[0] === 'print:cocina');
    expect(llamadaCocina).toBeDefined();
    expect(llamadaCocina[1].config.cocina_pantalla_dedicada).toBe('true');
  });
});
```

- [ ] **Step 4: Correr el test para verificar que falla**

Run: `cd backend && npx jest tests/impresion_ticket.test.js --runInBand`
Expected: FAIL — `llamadaCocina[1].config.cocina_pantalla_dedicada` es `undefined`.

- [ ] **Step 5: Agregar la clave a `_emitirImpresion`**

En `backend/src/modules/ventas/ventas.service.js:469`, la línea actual es:

```js
  const cfgRows = await Configuracion.findAll({ where: { clave: ['nombre_negocio', 'simbolo_moneda', 'direccion', 'telefono', 'flujo_cocina', 'cocina_destino', 'logo'] } });
```

Cambiarla a:

```js
  const cfgRows = await Configuracion.findAll({ where: { clave: ['nombre_negocio', 'simbolo_moneda', 'direccion', 'telefono', 'flujo_cocina', 'cocina_destino', 'cocina_pantalla_dedicada', 'logo'] } });
```

- [ ] **Step 6: Correr el test para verificar que pasa**

Run: `cd backend && npx jest tests/impresion_ticket.test.js --runInBand`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
cd backend && git add database/migrations/041_impresion_dedicada.sql src/modules/ventas/ventas.service.js tests/impresion_ticket.test.js
git commit -m "feat(impresion): cocina_pantalla_dedicada viaja en el payload de impresión"
```

---

### Task 2: El agente físico se identifica al conectar

**Files:**
- Modify: `print-agent/agent.js:199-217`

**Interfaces:**
- Produces: evento de socket `agente:conectado` con `{ sucursal_id, caja_id }` — lo consume Task 3.

- [ ] **Step 1: Agregar el emit en el handler `connect`**

En `print-agent/agent.js`, dentro de `socket.on('connect', () => { ... })` (línea 199), justo después de la línea `console.log(\`[${ts()}] ✓ Conectado (id: ${socket.id})\`);`, agregar:

```js
  socket.emit('agente:conectado', { sucursal_id: config.sucursal_id || null, caja_id: config.caja_id || null });
```

El bloque completo queda:

```js
socket.on('connect', () => {
  console.log(`[${ts()}] ✓ Conectado (id: ${socket.id})`);
  socket.emit('agente:conectado', { sucursal_id: config.sucursal_id || null, caja_id: config.caja_id || null });
  if (config.sucursal_id) {
    socket.emit('unirse_sucursal', config.sucursal_id);
    console.log(`[${ts()}] → Unido a la sala de la sucursal ${config.sucursal_id} (comandas de cocina)`);
  } else {
    console.log(`[${ts()}] ⚠ config.json no tiene sucursal_id — este agente NO recibirá ningún evento de impresión hasta que se configure`);
  }
  if (config.caja_id) {
    socket.emit('unirse_caja', config.caja_id);
    console.log(`[${ts()}] → Unido a la sala de la caja ${config.caja_id} (tickets de venta)`);
  } else {
    console.log(`[${ts()}] ⚠ config.json no tiene caja_id — el ticket de venta por socket (respaldo) solo llegará si esta es la única caja de la sucursal`);
  }
});
```

- [ ] **Step 2: Verificación manual**

`print-agent` no tiene suite de tests (script standalone que abre impresoras Windows reales — no es unitariamente testeable sin hardware). Verificar leyendo el diff: el emit va antes de los `console.log` de sala, no cambia ningún comportamiento existente, solo agrega una línea. Confirmar con `node -c print-agent/agent.js` que el archivo sigue siendo JS válido.

```bash
node -c "D:\TODO\SISTEMAS\CODE-COLINARY\print-agent\agent.js"
```
Expected: sin salida (sin errores de sintaxis).

- [ ] **Step 3: Commit**

```bash
git add print-agent/agent.js
git commit -m "feat(print-agent): el agente se identifica al conectar por socket"
```

---

### Task 3: `socket.js` rastrea agentes conectados

**Files:**
- Modify: `backend/src/socket.js`
- Test: `backend/tests/socket_agentes.test.js`
- Modify: `backend/package.json` (devDependency `socket.io-client`)

**Interfaces:**
- Consumes: evento `agente:conectado` (Task 2).
- Produces: `estadoAgentes()` — función exportada, sin argumentos, devuelve `Array<{ sucursal_id: number, caja_id: number|null, conectado_en: number }>` con TODOS los agentes actualmente conectados (a cualquier sucursal). La usa Task 4.
- Produces: evento de socket `agente:estado` emitido a la sala `sucursal:<id>` con `{ caja_id: number|null, conectado: boolean }` cada vez que un agente se conecta o desconecta. Lo consume Task 5 (Dashboard).

- [ ] **Step 1: Instalar `socket.io-client` como devDependency**

```bash
cd backend && npm install --save-dev socket.io-client
```

- [ ] **Step 2: Escribir el test (falla primero)**

```js
// backend/tests/socket_agentes.test.js
const http = require('http');
const { io: ioClient } = require('socket.io-client');
const { init, estadoAgentes } = require('../src/socket');

describe('socket.js — estado de agentes de impresión', () => {
  let server, port, clientes = [];

  beforeAll((done) => {
    server = http.createServer();
    init(server);
    server.listen(0, () => { port = server.address().port; done(); });
  });

  afterEach(() => {
    clientes.forEach((c) => c.disconnect());
    clientes = [];
  });

  afterAll((done) => {
    server.close(done);
  });

  function conectarCliente() {
    return new Promise((resolve) => {
      const c = ioClient(`http://127.0.0.1:${port}`, { transports: ['websocket'], reconnection: false });
      clientes.push(c);
      c.on('connect', () => resolve(c));
    });
  }

  it('agente:conectado registra el agente en estadoAgentes()', async () => {
    const cliente = await conectarCliente();
    cliente.emit('agente:conectado', { sucursal_id: 4242, caja_id: 77 });
    await new Promise((r) => setTimeout(r, 150));

    expect(estadoAgentes()).toContainEqual(expect.objectContaining({ sucursal_id: 4242, caja_id: 77 }));
  });

  it('al desconectarse el agente desaparece y se emite agente:estado con conectado:false', async () => {
    const agente = await conectarCliente();
    agente.emit('agente:conectado', { sucursal_id: 5151, caja_id: null });
    await new Promise((r) => setTimeout(r, 150));
    expect(estadoAgentes()).toContainEqual(expect.objectContaining({ sucursal_id: 5151, caja_id: null }));

    const observador = await conectarCliente();
    observador.emit('unirse_sucursal', 5151);
    await new Promise((r) => setTimeout(r, 150));

    const eventoPromise = new Promise((resolve) => observador.on('agente:estado', resolve));
    agente.disconnect();
    const evento = await eventoPromise;

    expect(evento).toEqual({ caja_id: null, conectado: false });
    expect(estadoAgentes().find((a) => a.sucursal_id === 5151)).toBeUndefined();
  });
});
```

- [ ] **Step 3: Correr el test para verificar que falla**

Run: `cd backend && npx jest tests/socket_agentes.test.js --runInBand`
Expected: FAIL — `estadoAgentes` no es una función exportada.

- [ ] **Step 4: Implementar el mapa de agentes en `socket.js`**

Reemplazar el archivo completo `backend/src/socket.js`:

```js
const { Server } = require('socket.io');

let _io = null;

// socket.id -> { sucursal_id, caja_id, conectado_en } — solo agentes de
// impresión física que se identificaron con 'agente:conectado' (ver
// print-agent/agent.js). Un navegador de staff normal nunca emite ese
// evento, así que nunca aparece acá.
const agentesConectados = new Map();

function init(server) {
  const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map(o => o.trim());

  _io = new Server(server, {
    cors: {
      // Acepta los orígenes configurados + el agente de impresión (sin origin)
      origin: (origin, cb) => {
        if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
        cb(new Error('socket.io CORS: ' + origin));
      },
      methods: ['GET', 'POST'],
    },
  });
  _io.on('connection', (socket) => {
    console.log('Socket conectado:', socket.id);
    socket.on('unirse_sucursal', (sucursal_id) => {
      if (sucursal_id) socket.join(`sucursal:${sucursal_id}`);
    });
    // Sala por caja: permite mandar el ticket de venta solo al agente de
    // impresión de la caja que hizo la venta, en vez de a todas las cajas
    // de la sucursal (ver print:caja en emitir()).
    socket.on('unirse_caja', (caja_id) => {
      if (caja_id) socket.join(`caja:${caja_id}`);
    });
    // El agente de impresión física se identifica apenas conecta (ver
    // print-agent/agent.js) — a diferencia de unirse_sucursal/unirse_caja
    // (que también usan pantallas de staff normales), esto es exclusivo
    // del agente, así que sirve para saber "está vivo" desde el backend.
    socket.on('agente:conectado', ({ sucursal_id, caja_id } = {}) => {
      if (!sucursal_id) return;
      agentesConectados.set(socket.id, { sucursal_id, caja_id: caja_id || null, conectado_en: Date.now() });
      emitir('agente:estado', { caja_id: caja_id || null, conectado: true }, sucursal_id);
    });
    socket.on('disconnect', () => {
      console.log('Socket desconectado:', socket.id);
      const info = agentesConectados.get(socket.id);
      if (info) {
        agentesConectados.delete(socket.id);
        emitir('agente:estado', { caja_id: info.caja_id, conectado: false }, info.sucursal_id);
      }
    });
  });
  return _io;
}

function emitir(evento, datos = {}, sucursal_id = null, caja_id = null) {
  if (!_io) return;
  if (caja_id) {
    _io.to(`caja:${caja_id}`).emit(evento, datos);
  } else if (sucursal_id) {
    _io.to(`sucursal:${sucursal_id}`).emit(evento, datos);
  } else {
    _io.emit(evento, datos);
  }
}

function estadoAgentes() {
  return Array.from(agentesConectados.values());
}

module.exports = { init, emitir, estadoAgentes };
```

- [ ] **Step 5: Correr el test para verificar que pasa**

Run: `cd backend && npx jest tests/socket_agentes.test.js --runInBand`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd backend && git add package.json package-lock.json src/socket.js tests/socket_agentes.test.js
git commit -m "feat(impresion): socket.js rastrea agentes de impresión conectados"
```

---

### Task 4: Endpoint `GET /impresion/estado-agentes`

**Files:**
- Create: `backend/src/modules/impresion/impresion.service.js`
- Create: `backend/src/modules/impresion/impresion.controller.js`
- Create: `backend/src/modules/impresion/impresion.routes.js`
- Modify: `backend/src/app.js`
- Test: `backend/tests/impresion_estado_agentes.test.js`

**Interfaces:**
- Consumes: `estadoAgentes()` de `backend/src/socket.js` (Task 3).
- Produces: `GET /api/v1/impresion/estado-agentes` → `{ ok: true, datos: [{ caja_id, caja_nombre, sucursal_id, sucursal_nombre, conectado }] }`. Solo incluye cajas con `modo_impresion: 'fisica'` y `activo: 1`. Lo consume Task 5 (frontend).

- [ ] **Step 1: Escribir el test (falla primero)**

```js
// backend/tests/impresion_estado_agentes.test.js
jest.mock('../src/socket', () => ({
  emitir: jest.fn(), init: jest.fn(),
  estadoAgentes: jest.fn(() => []),
}));
const { estadoAgentes } = require('../src/socket');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../src/app');
const { Sucursal, Caja, Usuario, Rol } = require('../src/models');

describe('GET /api/v1/impresion/estado-agentes', () => {
  let sucursal, cajaFisica, cajaBluetooth, usuario;
  let token;

  beforeAll(async () => {
    const timestamp = Date.now();
    sucursal = await Sucursal.create({ nombre: `Sucursal Impresion Estado Test ${timestamp}` });
    cajaFisica = await Caja.create({ sucursal_id: sucursal.id, nombre: 'Caja Fisica Estado Test', modo_impresion: 'fisica' });
    cajaBluetooth = await Caja.create({ sucursal_id: sucursal.id, nombre: 'Caja BT Estado Test', modo_impresion: 'bluetooth' });

    const rol = await Rol.findOne({ where: { nombre: 'Cajero' } });
    const hash = await bcrypt.hash('clave123', 10);
    usuario = await Usuario.create({ rol_id: rol.id, nombre: `Impresion Estado Test ${timestamp}`, email: `impresion-estado-test-${timestamp}@restaurante.com`, contrasena: hash });
    await usuario.addSucursal(sucursal);

    const login = await request(app).post('/api/v1/auth/login').send({ email: usuario.email, contrasena: 'clave123' });
    token = login.body.datos.token;
  });

  afterAll(async () => {
    await Usuario.destroy({ where: { id: usuario.id } });
    await Caja.destroy({ where: { sucursal_id: sucursal.id } });
    await Sucursal.destroy({ where: { id: sucursal.id } });
  });

  it('sin token → 401', async () => {
    const res = await request(app).get('/api/v1/impresion/estado-agentes');
    expect(res.status).toBe(401);
  });

  it('solo lista cajas físicas (nunca bluetooth), marcando conectado según estadoAgentes()', async () => {
    estadoAgentes.mockReturnValue([{ sucursal_id: sucursal.id, caja_id: cajaFisica.id, conectado_en: Date.now() }]);

    const res = await request(app)
      .get('/api/v1/impresion/estado-agentes')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const ids = res.body.datos.map((a) => a.caja_id);
    expect(ids).toContain(cajaFisica.id);
    expect(ids).not.toContain(cajaBluetooth.id);
    expect(res.body.datos.find((a) => a.caja_id === cajaFisica.id).conectado).toBe(true);
  });

  it('caja física sin agente conectado → conectado: false', async () => {
    estadoAgentes.mockReturnValue([]);

    const res = await request(app)
      .get('/api/v1/impresion/estado-agentes')
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.datos.find((a) => a.caja_id === cajaFisica.id).conectado).toBe(false);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd backend && npx jest tests/impresion_estado_agentes.test.js --runInBand`
Expected: FAIL — `Cannot GET /api/v1/impresion/estado-agentes` (404, ruta no existe).

- [ ] **Step 3: Crear el servicio**

```js
// backend/src/modules/impresion/impresion.service.js
const { Caja, Sucursal } = require('../../models');
const { estadoAgentes } = require('../../socket');

async function obtenerEstadoAgentes(alcance) {
  const where = { modo_impresion: 'fisica', activo: 1 };
  if (!alcance.acceso_todas) where.sucursal_id = alcance.sucursal_id;

  const cajas = await Caja.findAll({
    where,
    attributes: ['id', 'nombre', 'sucursal_id'],
    include: [{ model: Sucursal, as: 'sucursal', attributes: ['id', 'nombre'] }],
    order: [['sucursal_id', 'ASC'], ['nombre', 'ASC']],
  });

  const conectados = new Set(
    estadoAgentes().map((a) => a.caja_id).filter((id) => id != null)
  );

  return cajas.map((c) => ({
    caja_id: c.id,
    caja_nombre: c.nombre,
    sucursal_id: c.sucursal_id,
    sucursal_nombre: c.sucursal ? c.sucursal.nombre : null,
    conectado: conectados.has(c.id),
  }));
}

module.exports = { obtenerEstadoAgentes };
```

- [ ] **Step 4: Crear el controller**

```js
// backend/src/modules/impresion/impresion.controller.js
const svc = require('./impresion.service');

function _alcance(req) {
  return { sucursal_id: req.usuario.sucursal_id, acceso_todas: req.usuario.acceso_todas };
}

async function estadoAgentes(req, res, next) {
  try { res.json({ ok: true, datos: await svc.obtenerEstadoAgentes(_alcance(req)) }); }
  catch (err) { next(err); }
}

module.exports = { estadoAgentes };
```

- [ ] **Step 5: Crear las rutas**

```js
// backend/src/modules/impresion/impresion.routes.js
const { Router } = require('express');
const ctrl = require('./impresion.controller');
const auth = require('../../middlewares/auth');
const { verificarPermiso } = require('../../middlewares/permisos');

const router = Router();
router.use(auth);

router.get('/estado-agentes', verificarPermiso('caja', 'ver'), ctrl.estadoAgentes);

module.exports = router;
```

- [ ] **Step 6: Montar las rutas en `app.js`**

En `backend/src/app.js`, agregar el require junto a los demás (después de la línea 33, `const codepayWebhookRoutes = ...`):

```js
const impresionRoutes = require('./modules/impresion/impresion.routes');
```

Y montar la ruta junto a las demás `app.use('/api/v1/...')` (después de la línea 79, `app.use('/api/v1/cliente', clientePublicoRoutes);`):

```js
app.use('/api/v1/impresion', impresionRoutes);
```

- [ ] **Step 7: Correr el test para verificar que pasa**

Run: `cd backend && npx jest tests/impresion_estado_agentes.test.js --runInBand`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
cd backend && git add src/modules/impresion src/app.js tests/impresion_estado_agentes.test.js
git commit -m "feat(impresion): endpoint GET /impresion/estado-agentes"
```

---

### Task 5: Widget de estado de agentes en el Dashboard

**Files:**
- Create: `frontend/src/api/impresion.js`
- Create: `frontend/src/components/dashboard/EstadoAgentesImpresion.jsx`
- Modify: `frontend/src/pages/Dashboard.jsx`

**Interfaces:**
- Consumes: `GET /api/v1/impresion/estado-agentes` (Task 4), evento de socket `agente:estado` (Task 3).

- [ ] **Step 1: API wrapper**

```js
// frontend/src/api/impresion.js
import api from './cliente';

export const getEstadoAgentes = () =>
  api.get('/impresion/estado-agentes').then(r => r.data.datos);
```

- [ ] **Step 2: Componente del widget**

```jsx
// frontend/src/components/dashboard/EstadoAgentesImpresion.jsx
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer, CheckCircle2, AlertTriangle } from 'lucide-react';
import { getEstadoAgentes } from '../../api/impresion';
import socket from '../../socket';

export default function EstadoAgentesImpresion() {
  const qc = useQueryClient();
  const { data: agentes = [], isLoading } = useQuery({
    queryKey: ['estado-agentes'],
    queryFn: getEstadoAgentes,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  useEffect(() => {
    function onEstado() {
      qc.invalidateQueries({ queryKey: ['estado-agentes'] });
    }
    socket.on('agente:estado', onEstado);
    return () => socket.off('agente:estado', onEstado);
  }, [qc]);

  if (isLoading || agentes.length === 0) return null;

  return (
    <div className="bg-card rounded-2xl border border-border p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <Printer className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-foreground">Agentes de impresión</h3>
      </div>
      <div className="space-y-1.5">
        {agentes.map((a) => (
          <div key={a.caja_id} className="flex items-center justify-between text-xs gap-2">
            <span className="text-muted-foreground truncate">
              {a.sucursal_nombre ? `${a.sucursal_nombre} — ` : ''}{a.caja_nombre}
            </span>
            {a.conectado ? (
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium shrink-0">
                <CheckCircle2 className="w-3.5 h-3.5" /> Conectado
              </span>
            ) : (
              <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium shrink-0">
                <AlertTriangle className="w-3.5 h-3.5" /> Desconectado
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verificación con ESLint**

Run: `cd frontend && npx eslint src/api/impresion.js src/components/dashboard/EstadoAgentesImpresion.jsx`
Expected: sin errores.

- [ ] **Step 4: Wirearlo en `Dashboard.jsx`**

Agregar el import junto a los demás (después de la línea 13, `import { TrendingUp, ... } from 'lucide-react';`):

```js
import EstadoAgentesImpresion from '../components/dashboard/EstadoAgentesImpresion';
```

Y renderizarlo condicionado a `puedeVerCaja`, justo después del bloque de Stat cards (después del `</div>` que cierra `{/* ── Stat cards ── */}`, línea 536, y antes de `{/* ── Sin datos ── */}`):

```jsx
        {puedeVerCaja && <EstadoAgentesImpresion />}

```

- [ ] **Step 5: Build y lint completo**

Run: `cd frontend && npx eslint src/pages/Dashboard.jsx && npm run build`
Expected: sin errores, build exitoso.

- [ ] **Step 6: Verificación manual**

Con el backend corriendo y logueado como un usuario con `caja.ver`, abrir el Dashboard. Si no hay ninguna caja con `modo_impresion: 'fisica'` en la sucursal, el widget no debe aparecer (retorna `null`). Si hay al menos una, debe listarla como "Desconectado" (a menos que haya un agente real corriendo).

- [ ] **Step 7: Commit**

```bash
cd frontend && git add src/api/impresion.js src/components/dashboard/EstadoAgentesImpresion.jsx src/pages/Dashboard.jsx
git commit -m "feat(dashboard): widget de estado de agentes de impresión"
```

---

### Task 6: El dispositivo que vende deja de imprimir cocina cuando hay pantalla dedicada

**Files:**
- Modify: `frontend/src/utils/impresionLocal.js:37-71`

**Interfaces:**
- Consumes: `datosImpresion.cocina.config.cocina_pantalla_dedicada` (Task 1).

- [ ] **Step 1: Modificar `imprimirLocal()`**

En `frontend/src/utils/impresionLocal.js`, la función completa actual (línea 37) es:

```js
export function imprimirLocal(datosImpresion, { forzar = false } = {}) {
  if (!datosImpresion) return;
  const base = `http://127.0.0.1:${PUERTO_AGENTE_LOCAL}`;
  const qs = forzar ? '?forzar=1' : '';
  const cajaBT = datosImpresion.caja?.modo_impresion === 'bluetooth';
  const cocinaBT = datosImpresion.cocina?.modo_impresion === 'bluetooth';

  // Los dos tickets Bluetooth no se disparan juntos (ver por qué en
  // store/impresionStore.js) — se imprime caja y cocina queda pendiente de
  // un botón manual ("Imprimir cocina") para que la persona corte el papel
  // con calma antes de mandar el siguiente.
  if (cajaBT && cocinaBT) {
    imprimirBluetoothCaja(datosImpresion.caja).then(() => {
      useImpresionStore.getState().marcarCocinaPendiente(datosImpresion.cocina);
    });
  } else {
    if (datosImpresion.caja) {
      if (cajaBT) {
        imprimirBluetoothCaja(datosImpresion.caja);
      } else {
        postConTimeout(`${base}/imprimir/caja${qs}`, datosImpresion.caja).catch(() => {
          // Sin agente local en esta PC: no pasa nada, el socket.io del backend
          // ya mandó el mismo ticket como respaldo.
        });
      }
    }
    if (datosImpresion.cocina) {
      if (cocinaBT) {
        imprimirBluetoothCocina(datosImpresion.cocina);
      } else {
        postConTimeout(`${base}/imprimir/cocina${qs}`, datosImpresion.cocina).catch(() => {});
      }
    }
  }
}
```

Reemplazarla por:

```js
export function imprimirLocal(datosImpresion, { forzar = false } = {}) {
  if (!datosImpresion) return;
  const base = `http://127.0.0.1:${PUERTO_AGENTE_LOCAL}`;
  const qs = forzar ? '?forzar=1' : '';
  const cajaBT = datosImpresion.caja?.modo_impresion === 'bluetooth';
  const cocinaBT = datosImpresion.cocina?.modo_impresion === 'bluetooth';
  // Si hay una pantalla dedicada en cocina (ver PantallaCocinaImpresion.jsx),
  // esa pantalla es la única responsable de imprimir la comanda por
  // Bluetooth — el dispositivo que vendió no debe imprimirla también, o
  // sale duplicada. El flag viaja en el propio payload de cocina (lo agrega
  // el backend en _emitirImpresion), así que no hace falta otra consulta.
  const cocinaConPantallaDedicada = datosImpresion.cocina?.config?.cocina_pantalla_dedicada === 'true';

  // Los dos tickets Bluetooth no se disparan juntos (ver por qué en
  // store/impresionStore.js) — se imprime caja y cocina queda pendiente de
  // un botón manual ("Imprimir cocina") para que la persona corte el papel
  // con calma antes de mandar el siguiente.
  if (cajaBT && cocinaBT && !cocinaConPantallaDedicada) {
    imprimirBluetoothCaja(datosImpresion.caja).then(() => {
      useImpresionStore.getState().marcarCocinaPendiente(datosImpresion.cocina);
    });
  } else {
    if (datosImpresion.caja) {
      if (cajaBT) {
        imprimirBluetoothCaja(datosImpresion.caja);
      } else {
        postConTimeout(`${base}/imprimir/caja${qs}`, datosImpresion.caja).catch(() => {
          // Sin agente local en esta PC: no pasa nada, el socket.io del backend
          // ya mandó el mismo ticket como respaldo.
        });
      }
    }
    if (datosImpresion.cocina && !cocinaConPantallaDedicada) {
      if (cocinaBT) {
        imprimirBluetoothCocina(datosImpresion.cocina);
      } else {
        postConTimeout(`${base}/imprimir/cocina${qs}`, datosImpresion.cocina).catch(() => {});
      }
    }
  }
}
```

`reimprimirConFallback()` (unas líneas más abajo) **no se toca** — la reimpresión manual desde el botón "Imprimir de nuevo" sigue funcionando igual sin importar el flag.

- [ ] **Step 2: Verificación con ESLint y build**

Run: `cd frontend && npx eslint src/utils/impresionLocal.js && npm run build`
Expected: sin errores.

- [ ] **Step 3: Verificación manual (trazado de lógica, sin test automatizado)**

Confirmar leyendo el diff que:
- Con `cocina_pantalla_dedicada` ausente o `'false'`: el comportamiento es IDÉNTICO al de antes (ninguna rama nueva se activa).
- Con `cocina_pantalla_dedicada: 'true'` y `cocinaBT: true`: nunca se llama a `imprimirBluetoothCocina` ni a `marcarCocinaPendiente` desde acá — el ticket de caja se sigue imprimiendo normal.

- [ ] **Step 4: Commit**

```bash
cd frontend && git add src/utils/impresionLocal.js
git commit -m "fix(impresion): no duplicar cocina Bluetooth cuando hay pantalla dedicada"
```

---

### Task 7: Toggle de configuración en `TabFlujo.jsx`

**Files:**
- Modify: `frontend/src/pages/configuracion/tabs/TabFlujo.jsx`

**Interfaces:**
- Consumes: `getConfiguracion`/`actualizarConfiguracion` (ya existentes, sin cambios de firma).
- Produces: escribe la clave `cocina_pantalla_dedicada` vía `actualizarConfiguracion` (Task 1 ya la lee en el backend).

- [ ] **Step 1: Agregar el estado derivado**

En `frontend/src/pages/configuracion/tabs/TabFlujo.jsx`, después de la línea 17 (`const destinoActual = config.cocina_destino ?? 'centralizada';`), agregar:

```js
  const pantallaDedicadaActiva = config.cocina_pantalla_dedicada === 'true';
```

- [ ] **Step 2: Agregar la mutation**

Después del bloque `guardarDestino` (línea 35), agregar:

```js
  const guardarPantallaDedicada = useMutation({
    mutationFn: (activo) => actualizarConfiguracion({ cocina_pantalla_dedicada: activo ? 'true' : 'false' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['configuracion'] });
      setGuardado(true);
      setTimeout(() => setGuardado(false), 2500);
    },
  });
```

- [ ] **Step 3: Agregar el checkbox en el render**

El bloque que empieza en la línea 106 (`{flujoActual === 'fisico' && (`) termina en la línea 135 con `)}`. Justo antes de ese `)}` de cierre (después del `.map` de `opcionesDestino`), agregar:

```jsx
            <div className="pt-2 flex items-start gap-3">
              <input
                id="cocina-pantalla-dedicada"
                type="checkbox"
                checked={pantallaDedicadaActiva}
                onChange={(e) => puedeEditar && guardarPantallaDedicada.mutate(e.target.checked)}
                disabled={!puedeEditar || guardarPantallaDedicada.isPending}
                className="mt-0.5 w-4 h-4 rounded border-input"
              />
              <label htmlFor="cocina-pantalla-dedicada" className="text-xs text-muted-foreground leading-relaxed">
                <span className="font-semibold text-foreground">Pantalla dedicada en cocina (Bluetooth)</span> — si tu impresora de cocina es Bluetooth y usás la pantalla{' '}
                <code className="text-[11px] bg-muted px-1 py-0.5 rounded">/pantalla-cocina-impresion</code>{' '}
                en un dispositivo fijo, activá esto para que la comanda salga sola incluso en pedidos de autoservicio (sin cajero vendiendo). El dispositivo que vende deja de imprimir la comanda — queda solo en manos de esa pantalla.
              </label>
            </div>
```

- [ ] **Step 4: Verificación con ESLint y build**

Run: `cd frontend && npx eslint src/pages/configuracion/tabs/TabFlujo.jsx && npm run build`
Expected: sin errores.

- [ ] **Step 5: Verificación manual**

Ir a Configuración → Flujo Cocina, elegir "Ticket físico impreso", confirmar que aparece el checkbox nuevo debajo de "Destino del ticket de cocina", tildarlo, refrescar la página y confirmar que sigue tildado (persiste).

- [ ] **Step 6: Commit**

```bash
cd frontend && git add src/pages/configuracion/tabs/TabFlujo.jsx
git commit -m "feat(configuracion): toggle de pantalla dedicada de cocina Bluetooth"
```

---

### Task 8: Pantalla dedicada de cocina (`PantallaCocinaImpresion`)

**Files:**
- Create: `frontend/src/pages/cocina/PantallaCocinaImpresion.jsx`
- Modify: `frontend/src/router/index.jsx`
- Modify: `frontend/src/components/layout/Sidebar.jsx`

**Interfaces:**
- Consumes: evento de socket `print:cocina` (ya existente, emitido por `_emitirImpresion`), `imprimirBluetoothCocina` de `frontend/src/utils/rawbt.js` (ya existente, sin cambios).

- [ ] **Step 1: Crear la página**

```jsx
// frontend/src/pages/cocina/PantallaCocinaImpresion.jsx
import { useEffect, useRef, useState } from 'react';
import { Printer, AlertCircle } from 'lucide-react';
import { usePermisos } from '../../hooks/usePermisos';
import { imprimirBluetoothCocina } from '../../utils/rawbt';
import socket from '../../socket';

const TTL_DEDUP_MS = 5 * 60_000; // mismo criterio que print-agent/agent.js
const CLAVE_CAJA_LOCALSTORAGE = 'pantalla-cocina-caja-id';

function usarWakeLock() {
  useEffect(() => {
    let lock = null;
    async function pedir() {
      if (!('wakeLock' in navigator)) return;
      try { lock = await navigator.wakeLock.request('screen'); } catch { /* no bloqueante */ }
    }
    pedir();
    // Algunos navegadores sueltan el wake lock al perder foco — se vuelve a
    // pedir cuando la pestaña vuelve a estar visible.
    function onVisibilidad() {
      if (document.visibilityState === 'visible') pedir();
    }
    document.addEventListener('visibilitychange', onVisibilidad);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilidad);
      lock?.release?.().catch(() => {});
    };
  }, []);
}

export default function PantallaCocinaImpresion() {
  const { tienePermiso } = usePermisos();
  const puedeVer = tienePermiso('cocina', 'ver');
  const [cajaVinculada, setCajaVinculada] = useState(() => localStorage.getItem(CLAVE_CAJA_LOCALSTORAGE) || '');
  const [impresos, setImpresos] = useState([]); // [{ pedidoId, etiqueta, hora }], más reciente primero
  const dedupRef = useRef(new Map()); // pedidoId -> timestamp

  usarWakeLock();

  useEffect(() => {
    if (cajaVinculada) socket.emit('unirse_caja', Number(cajaVinculada));
  }, [cajaVinculada]);

  useEffect(() => {
    function limpiarVencidos() {
      const ahora = Date.now();
      for (const [id, t] of dedupRef.current) {
        if (ahora - t > TTL_DEDUP_MS) dedupRef.current.delete(id);
      }
    }

    function onPrintCocina(datos) {
      if (datos?.modo_impresion !== 'bluetooth') return;
      const pedidoId = datos.pedido?.id;
      if (!pedidoId) return;

      limpiarVencidos();
      if (dedupRef.current.has(pedidoId)) return;
      dedupRef.current.set(pedidoId, Date.now());

      imprimirBluetoothCocina(datos);

      const esLlevar = datos.pedido.tipo === 'llevar';
      const etiqueta = esLlevar
        ? `Para llevar — ${datos.pedido.nombre_cliente || 'Cliente'}`
        : (datos.pedido.mesa?.nombre || 'Mesa');
      const hora = new Date().toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' });
      setImpresos((prev) => [{ pedidoId, etiqueta, hora }, ...prev].slice(0, 30));
    }

    socket.on('print:cocina', onPrintCocina);
    return () => socket.off('print:cocina', onPrintCocina);
  }, []);

  if (!puedeVer) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
        <AlertCircle className="w-10 h-10" />
        <p className="font-medium">No tienes permiso para ver esta pantalla</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
          <Printer className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-foreground">Pantalla de cocina — impresión Bluetooth</h1>
          <p className="text-xs text-muted-foreground">Dejá esta pantalla abierta en el dispositivo con la impresora emparejada. Imprime sola cada comanda que llega.</p>
        </div>
      </div>

      <div className="bg-card rounded-2xl border border-border p-4 space-y-2 max-w-md">
        <label htmlFor="caja-vinculada" className="text-xs font-medium text-muted-foreground">
          Vincular a una caja específica (opcional — solo si tu negocio usa "cocina por caja")
        </label>
        <input
          id="caja-vinculada"
          type="number"
          min="1"
          value={cajaVinculada}
          onChange={(e) => {
            const valor = e.target.value;
            setCajaVinculada(valor);
            if (valor) localStorage.setItem(CLAVE_CAJA_LOCALSTORAGE, valor);
            else localStorage.removeItem(CLAVE_CAJA_LOCALSTORAGE);
          }}
          placeholder="ID de la caja"
          className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="bg-card rounded-2xl border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground mb-3">Comandas impresas</h2>
        {impresos.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Esperando comandas...</p>
        ) : (
          <div className="space-y-2">
            {impresos.map((item) => (
              <div key={item.pedidoId} className="flex items-center justify-between text-sm border-b border-border pb-2">
                <span className="text-foreground">Comanda #{item.pedidoId} — {item.etiqueta}</span>
                <span className="text-muted-foreground text-xs">{item.hora}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Agregar la ruta**

En `frontend/src/router/index.jsx`, agregar el import junto a los demás (después de la línea 20, `import CocinaPage from '../pages/cocina/CocinaPage';`):

```js
import PantallaCocinaImpresion from '../pages/cocina/PantallaCocinaImpresion';
```

Y la ruta, junto a `/cocina` (línea 60):

```jsx
            { path: '/cocina',                    element: <CocinaPage /> },
            { path: '/pantalla-cocina-impresion',  element: <PantallaCocinaImpresion /> },
```

- [ ] **Step 3: Agregar el link al Sidebar**

En `frontend/src/components/layout/Sidebar.jsx`, agregar `Printer` al import de íconos (línea 6-11):

```js
import {
  LayoutDashboard, UtensilsCrossed, Wallet, BookOpen,
  Package, Boxes, Truck, Users, UserCog, Shield, Settings, X,
  BarChart2, ChefHat, ChevronDown, ChevronRight, Building2, Landmark, Store, Grid3x3,
  Gift, Tag, Star, Ticket, Cake, Disc3, Wheat, Printer,
} from 'lucide-react';
```

Y el item de navegación, justo después de `/cocina` (línea 20):

```js
      { to: '/cocina',     label: 'Cocina',        Icono: ChefHat,         modulo: 'cocina',     accion: 'ver' },
      { to: '/pantalla-cocina-impresion', label: 'Pantalla Cocina (BT)', Icono: Printer, modulo: 'cocina', accion: 'ver' },
```

- [ ] **Step 4: Verificación con ESLint y build**

Run: `cd frontend && npx eslint src/pages/cocina/PantallaCocinaImpresion.jsx src/router/index.jsx src/components/layout/Sidebar.jsx && npm run build`
Expected: sin errores.

- [ ] **Step 5: Verificación manual**

Loguearse como usuario con permiso `cocina.ver`, ir a "Pantalla Cocina (BT)" desde el sidebar, confirmar que carga sin errores en consola. En un navegador de escritorio Chrome (que soporta `navigator.wakeLock`), confirmar en las DevTools → Application que no hay excepciones al pedir el wake lock. No hay forma de probar la impresión Bluetooth real sin un dispositivo Android + RawBT + impresora emparejada — documentar esa limitación, no bloqueante para este plan.

- [ ] **Step 6: Commit**

```bash
cd frontend && git add src/pages/cocina/PantallaCocinaImpresion.jsx src/router/index.jsx src/components/layout/Sidebar.jsx
git commit -m "feat(cocina): pantalla dedicada para impresión Bluetooth automática"
```
