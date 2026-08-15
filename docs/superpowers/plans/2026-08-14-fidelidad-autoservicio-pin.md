# Fidelidad en autoservicio (CI + PIN) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a customer in autoservicio create a PIN (verified by email), log in with CI+PIN, see their order history, redeem loyalty points at checkout, and change their PIN — while the existing "earn points by CI alone, no PIN" flow keeps working unchanged.

**Architecture:** A new anonymous backend module (`clientePublico`) issues a JWT (`{ cliente_id, tipo: 'cliente' }`, same secret the staff login already uses, 180-day expiry) once a customer proves their PIN — either by verifying it directly, or by completing a one-time email-code confirmation the first time they set one. Two new Cliente columns hold the active PIN hash and a lockout counter; a small side table holds a PIN creation attempt until its email code is confirmed or it expires. The existing silent "CI only, sum points" flow in `autoservicio.service.js` is untouched; redemption is wired in as an additive, token-gated path.

**Tech Stack:** Node/Express/Sequelize (MySQL/MariaDB), bcryptjs, jsonwebtoken, nodemailer (new dependency), React/Vite frontend with zustand+persist, @tanstack/react-query.

**Spec:** docs/superpowers/specs/2026-08-14-fidelidad-autoservicio-pin-design.md

## Global Constraints

- PIN is exactly 4 digits. Lockout after 5 wrong PIN attempts, for 5 minutes (`pin_bloqueado_hasta`), counter resets to 0 on a successful login.
- Email verification code is 6 digits, expires 10 minutes after creation, max 5 wrong-code attempts before the customer must request a new code.
- Session token: JWT `{ cliente_id, tipo: 'cliente' }`, signed with the existing `process.env.JWT_SECRET`, `expiresIn: '180d'`.
- Earning points by CI alone (no PIN) must keep working exactly as today — no new friction on that path.
- Redeeming points (`puntos_canjear`) in autoservicio is only ever honored when the request carries a **valid** cliente token — never from `numero_documento` alone, even if sent in the body.
- Only the cajero (staff) can reset a customer's PIN (Configuración → Clientes) — there is no customer-facing "forgot PIN" flow.
- Once logged in with a verified PIN, the customer's own name and points balance ARE shown (this is a deliberate exception to the "no personal data shown" rule of the CI-only flow, confirmed with the user).
- SMTP: `mail.codewave.com.bo`, port 587, STARTTLS, credentials go in `backend/.env` only (never committed).

---

### Task 1: Data model — Cliente PIN columns, verification table, dependency, env vars

**Files:**
- Create: `backend/database/migrations/039_clientes_pin.sql`
- Modify: `backend/src/models/Cliente.js`
- Create: `backend/src/models/ClientePinVerificacion.js`
- Modify: `backend/src/models/index.js`
- Modify: `backend/package.json` (add `nodemailer`)
- Modify: `backend/.env.example`
- Modify: `backend/.env` (local only, not committed — real SMTP credentials)

**Interfaces:**
- Produces: `Cliente.pin_hash` (STRING|null), `Cliente.pin_intentos_fallidos` (INTEGER), `Cliente.pin_bloqueado_hasta` (DATE|null); model `ClientePinVerificacion` with fields `{ id, cliente_id, pin_hash, email, codigo_hash, intentos, expira_en, creado_en }`, exported from `backend/src/models/index.js` as `ClientePinVerificacion`.

- [ ] **Step 1: Write the migration**

```sql
-- backend/database/migrations/039_clientes_pin.sql
-- PIN de cliente para autoservicio (canje de puntos, historial). Ver
-- docs/superpowers/specs/2026-08-14-fidelidad-autoservicio-pin-design.md

ALTER TABLE clientes
  ADD COLUMN pin_hash VARCHAR(255) NULL AFTER puntos,
  ADD COLUMN pin_intentos_fallidos INT NOT NULL DEFAULT 0 AFTER pin_hash,
  ADD COLUMN pin_bloqueado_hasta DATETIME NULL AFTER pin_intentos_fallidos;

CREATE TABLE cliente_pin_verificaciones (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cliente_id INT UNSIGNED NOT NULL,
  pin_hash VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  codigo_hash VARCHAR(255) NOT NULL,
  intentos INT NOT NULL DEFAULT 0,
  expira_en DATETIME NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY cliente_id (cliente_id),
  FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Step 2: Apply the migration to the local dev database**

Run: `mysql -u root bd_codeculinary < backend/database/migrations/039_clientes_pin.sql`
Expected: no output (success). If `mysql` isn't on PATH, use the same MySQL client the project already uses locally.

- [ ] **Step 3: Add the columns to the `Cliente` model**

Edit `backend/src/models/Cliente.js` — add after the `puntos` field:

```javascript
  puntos: { type: DataTypes.INTEGER, defaultValue: 0 },
  pin_hash: { type: DataTypes.STRING(255), allowNull: true },
  pin_intentos_fallidos: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  pin_bloqueado_hasta: { type: DataTypes.DATE, allowNull: true },
```

- [ ] **Step 4: Create the `ClientePinVerificacion` model**

```javascript
// backend/src/models/ClientePinVerificacion.js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Fila transitoria: alguien pidió crear un PIN para este cliente y está
// esperando que confirme el código de 6 dígitos que le mandamos por email.
// Se borra al confirmarse o queda vencida (ver clientePublico.service.js).
// cliente_id es único — una solicitud nueva reemplaza cualquier pendiente
// anterior de ese mismo cliente.
const ClientePinVerificacion = sequelize.define('ClientePinVerificacion', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  cliente_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, unique: true },
  pin_hash: { type: DataTypes.STRING(255), allowNull: false },
  email: { type: DataTypes.STRING(255), allowNull: false },
  codigo_hash: { type: DataTypes.STRING(255), allowNull: false },
  intentos: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  expira_en: { type: DataTypes.DATE, allowNull: false },
}, {
  tableName: 'cliente_pin_verificaciones',
  createdAt: 'creado_en',
  updatedAt: false,
});

module.exports = ClientePinVerificacion;
```

- [ ] **Step 5: Register the model in `models/index.js`**

Add the require near the other model requires (right after `const Cliente = require('./Cliente');`):

```javascript
const ClientePinVerificacion = require('./ClientePinVerificacion');
```

Add `ClientePinVerificacion` to the final `module.exports` object (next to `Cliente`):

```javascript
  Cliente, ClientePinVerificacion,
```

- [ ] **Step 6: Add `nodemailer` to `package.json`**

Edit `backend/package.json`, in `"dependencies"`, add (keep alphabetical order with the surrounding entries):

```json
    "node-cron": "^4.6.0",
    "nodemailer": "^9.0.5",
    "sequelize": "^6.37.8",
```

- [ ] **Step 7: Install the dependency**

Run: `cd backend && npm install`
Expected: `nodemailer` appears in `node_modules` and `package-lock.json` is updated.

- [ ] **Step 8: Add SMTP variables to `.env.example` (placeholders, not real values)**

Append to `backend/.env.example`:

```
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=noreply@codewave.com.bo
```

- [ ] **Step 9: Add the real SMTP variables to the local `backend/.env` (gitignored, never commit)**

Append to `backend/.env`:

```
SMTP_HOST=mail.codewave.com.bo
SMTP_PORT=587
SMTP_USER=0sdxkHbYEkjP0GcJMMxo78FJ
SMTP_PASS=0sdxkHbYEkjP0GcJMMxo78FJ
SMTP_FROM=noreply@codewave.com.bo
```

- [ ] **Step 10: Verify the app still boots and existing tests still pass**

Run: `cd backend && npm test -- autoservicio.test.js clientes.test.js`
Expected: same pass counts as before this task (no new tests yet — this task is model/schema only). If any test now fails to even load the app, check `models/index.js` for a syntax error in the edit.

- [ ] **Step 11: Commit**

```bash
git add backend/database/migrations/039_clientes_pin.sql backend/src/models/Cliente.js backend/src/models/ClientePinVerificacion.js backend/src/models/index.js backend/package.json backend/package-lock.json backend/.env.example
git commit -m "feat(fidelidad): columnas de PIN en Cliente y tabla de verificacion pendiente"
```

(Do not `git add backend/.env` — it's gitignored and holds real credentials.)

---

### Task 2: Email client (nodemailer wrapper)

**Files:**
- Create: `backend/src/integrations/email/email.client.js`
- Test: `backend/tests/email.client.test.js`

**Interfaces:**
- Consumes: `process.env.SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM`.
- Produces: `enviarCodigoPin({ to, codigo })` — `async function`, returns `Promise<void>`, throws `Object.assign(new Error(...), { status: 502 })` on any transport failure. Consumed by Task 4.

- [ ] **Step 1: Write the failing test**

```javascript
// backend/tests/email.client.test.js
const nodemailerMock = { sendMail: jest.fn().mockResolvedValue({}) };
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => nodemailerMock),
}));

const nodemailer = require('nodemailer');
const { enviarCodigoPin } = require('../src/integrations/email/email.client');

describe('email.client', () => {
  beforeEach(() => {
    nodemailerMock.sendMail.mockClear();
    nodemailerMock.sendMail.mockResolvedValue({});
  });

  it('manda el código al destinatario con el remitente configurado', async () => {
    await enviarCodigoPin({ to: 'cliente@example.com', codigo: '123456' });

    expect(nodemailer.createTransport).toHaveBeenCalled();
    expect(nodemailerMock.sendMail).toHaveBeenCalledTimes(1);
    const llamada = nodemailerMock.sendMail.mock.calls[0][0];
    expect(llamada.to).toBe('cliente@example.com');
    expect(llamada.text).toContain('123456');
  });

  it('si sendMail falla, propaga un error con status 502', async () => {
    nodemailerMock.sendMail.mockRejectedValue(new Error('conexión rechazada'));

    await expect(enviarCodigoPin({ to: 'x@example.com', codigo: '000000' }))
      .rejects.toMatchObject({ status: 502 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest email.client.test.js -v`
Expected: FAIL — `Cannot find module '../src/integrations/email/email.client'`

- [ ] **Step 3: Write the implementation**

```javascript
// backend/src/integrations/email/email.client.js
const nodemailer = require('nodemailer');

let _transporter = null;
function _obtenerTransporter() {
  if (_transporter) return _transporter;
  _transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: false, // STARTTLS sobre el puerto 587, no TLS implícito
    requireTLS: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return _transporter;
}

async function enviarCodigoPin({ to, codigo }) {
  try {
    await _obtenerTransporter().sendMail({
      from: process.env.SMTP_FROM,
      to,
      subject: 'Tu código para activar tu PIN',
      text: `Tu código para activar tu PIN es: ${codigo}\n\nVence en 10 minutos. Si no pediste esto, ignorá este mensaje.`,
    });
  } catch {
    throw Object.assign(new Error('No se pudo enviar el código por email. Intentá de nuevo.'), { status: 502 });
  }
}

module.exports = { enviarCodigoPin };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest email.client.test.js -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/integrations/email/email.client.js backend/tests/email.client.test.js
git commit -m "feat(fidelidad): cliente de email (nodemailer) para el codigo de verificacion del PIN"
```

---

### Task 3: Mover la resolución de cliente por CI a `clientesService` (refactor, sin cambio de comportamiento)

**Files:**
- Modify: `backend/src/modules/clientes/clientes.service.js`
- Modify: `backend/src/modules/autoservicio/autoservicio.service.js`
- Test: `backend/tests/autoservicio.test.js` (no new tests — this task must not change any existing test's outcome)

**Interfaces:**
- Produces: `clientesService.resolverOCrearPorDocumento(numero_documento)` — `async function`, returns `Promise<number|null>` (a `Cliente.id`, or `null` if the document is blank, matches nobody, or the Personas API call fails). Consumed by Task 4 (`estado`, `solicitarPin`) and already by Task-3-modified `autoservicio.service.js`.

- [ ] **Step 1: Move the function into `clientes.service.js`**

Edit `backend/src/modules/clientes/clientes.service.js` — add near the bottom, before `module.exports`:

```javascript
// Resuelve un Cliente por CI, creándolo si no existe (vía la API de
// Personas) — usado tanto por el flujo silencioso de "sumar puntos con
// solo CI" en autoservicio como por el flujo de creación de PIN. Nunca
// lanza: si el documento está vacío, no matchea con nadie en la API de
// Personas, o esa API falla (red, 502), devuelve null — el llamador decide
// qué hacer con eso (en autoservicio, seguir sin cliente_id; en el flujo de
// PIN, cortar con un error propio).
async function resolverOCrearPorDocumento(numero_documento) {
  const doc = (numero_documento || '').trim();
  if (!doc) return null;

  try {
    const existente = await Cliente.findOne({ where: { numero_documento: doc } });
    if (existente) return existente.id;

    const persona = await buscarPorDocumento(doc);
    if (!persona) return null;

    const creado = await Cliente.create({
      nombre: persona.nombre || 'Cliente',
      numero_documento: persona.numero_documento || doc,
      fecha_nacimiento: persona.fecha_nacimiento || null,
    });
    return creado.id;
  } catch {
    return null;
  }
}
```

Update the final `module.exports` line to include it:

```javascript
module.exports = { listar, obtener, crear, actualizar, buscarPorDocumento, buscarPorNombre, buscarPorCodigo, resolverOCrearPorDocumento };
```

- [ ] **Step 2: Update `autoservicio.service.js` to use it instead of its own private copy**

Edit `backend/src/modules/autoservicio/autoservicio.service.js`:

Remove the `Cliente` import (no longer used directly in this file) and the whole `_resolverClientePorDocumento` function. Change:

```javascript
const { SesionCaja, Pedido, Producto, Cliente } = require('../../models');
```

to:

```javascript
const { SesionCaja, Pedido, Producto } = require('../../models');
```

Delete this entire block (the `_resolverClientePorDocumento` function and its comment):

```javascript
// Identificación opcional y silenciosa del cliente por CI, para que el
// pedido sume puntos de fidelidad como cualquier venta con cliente_id (esa
// parte ya funciona sola en ventasService — acá solo se resuelve el id).
// Nunca bloquea el pedido: si el documento está vacío, no matchea con nadie
// en la API de Personas, o esa API falla (red, 502), se sigue de largo sin
// cliente_id — el cliente nunca ve un error por esto, es opcional.
async function _resolverClientePorDocumento(numero_documento) {
  const doc = (numero_documento || '').trim();
  if (!doc) return null;

  try {
    const existente = await Cliente.findOne({ where: { numero_documento: doc } });
    if (existente) return existente.id;

    const persona = await clientesService.buscarPorDocumento(doc);
    if (!persona) return null;

    const creado = await Cliente.create({
      nombre: persona.nombre || 'Cliente',
      numero_documento: persona.numero_documento || doc,
      fecha_nacimiento: persona.fecha_nacimiento || null,
    });
    return creado.id;
  } catch {
    return null;
  }
}
```

In `crearPedido`, change:

```javascript
  const cliente_id = await _resolverClientePorDocumento(numero_documento);
```

to:

```javascript
  const cliente_id = await clientesService.resolverOCrearPorDocumento(numero_documento);
```

- [ ] **Step 3: Run the existing autoservicio test suite to confirm behavior is unchanged**

Run: `cd backend && npx jest autoservicio.test.js -v`
Expected: PASS, same 22 tests as before this task (the three `numero_documento en el pedido` tests must still pass unchanged — they exercise this exact code path).

- [ ] **Step 4: Run the full backend suite as a regression check**

Run: `cd backend && npm test`
Expected: same pass/fail counts as the pre-existing baseline (no new failures introduced).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/clientes/clientes.service.js backend/src/modules/autoservicio/autoservicio.service.js
git commit -m "refactor(fidelidad): mover resolverOCrearPorDocumento a clientesService, reutilizable"
```

---

### Task 4: Flujo de creación de PIN — `estado`, `solicitar`, `confirmar`

**Files:**
- Create: `backend/src/modules/clientePublico/clientePublico.service.js`
- Create: `backend/src/modules/clientePublico/clientePublico.controller.js`
- Create: `backend/src/modules/clientePublico/clientePublico.routes.js`
- Modify: `backend/src/app.js` (mount the new router)
- Test: `backend/tests/clientePublico.test.js`

**Interfaces:**
- Consumes: `clientesService.resolverOCrearPorDocumento` (Task 3), `enviarCodigoPin` from `../../integrations/email/email.client` (Task 2), models `Cliente`, `ClientePinVerificacion` (Task 1).
- Produces: `POST /api/v1/cliente/estado` `{ numero_documento }` → `{ tiene_pin }`. `POST /api/v1/cliente/pin/solicitar` `{ numero_documento, pin, email }` → `{ ok: true }`. `POST /api/v1/cliente/pin/confirmar` `{ numero_documento, codigo }` → `{ token }`. Service functions `estado(numero_documento)`, `solicitarPin({ numero_documento, pin, email })`, `confirmarPin({ numero_documento, codigo })` and the token helper `emitirToken(cliente_id)` — all consumed by Task 5 (`verificar`) and Task 6 (`cambiarPin`, `perfil`).

- [ ] **Step 1: Write the failing tests**

```javascript
// backend/tests/clientePublico.test.js
jest.mock('../src/integrations/email/email.client', () => ({
  enviarCodigoPin: jest.fn().mockResolvedValue(),
}));

const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const { Cliente, ClientePinVerificacion } = require('../src/models');
const { enviarCodigoPin } = require('../src/integrations/email/email.client');

describe('Cliente público — PIN', () => {
  let cliente;

  beforeEach(async () => {
    enviarCodigoPin.mockClear();
    const timestamp = Date.now();
    cliente = await Cliente.create({ nombre: 'Test PIN', numero_documento: `pin-${timestamp}` });
  });

  afterEach(async () => {
    await ClientePinVerificacion.destroy({ where: { cliente_id: cliente.id } });
    await Cliente.destroy({ where: { id: cliente.id } });
  });

  describe('POST /api/v1/cliente/estado', () => {
    it('CI sin PIN → tiene_pin: false, y crea el Cliente si no existía', async () => {
      const timestamp = Date.now();
      const res = await request(app)
        .post('/api/v1/cliente/estado')
        .send({ numero_documento: `nuevo-${timestamp}` });

      expect(res.status).toBe(200);
      expect(res.body.datos).toEqual({ tiene_pin: false });

      const creado = await Cliente.findOne({ where: { numero_documento: `nuevo-${timestamp}` } });
      expect(creado).not.toBeNull();
      await Cliente.destroy({ where: { id: creado.id } });
    });

    it('CI con PIN ya activo → tiene_pin: true', async () => {
      await cliente.update({ pin_hash: await bcrypt.hash('1234', 10) });

      const res = await request(app)
        .post('/api/v1/cliente/estado')
        .send({ numero_documento: cliente.numero_documento });

      expect(res.status).toBe(200);
      expect(res.body.datos).toEqual({ tiene_pin: true });
    });
  });

  describe('POST /api/v1/cliente/pin/solicitar', () => {
    it('PIN inválido (no 4 dígitos) → 400', async () => {
      const res = await request(app)
        .post('/api/v1/cliente/pin/solicitar')
        .send({ numero_documento: cliente.numero_documento, pin: '12', email: 'a@b.com' });

      expect(res.status).toBe(400);
    });

    it('email inválido → 400', async () => {
      const res = await request(app)
        .post('/api/v1/cliente/pin/solicitar')
        .send({ numero_documento: cliente.numero_documento, pin: '1234', email: 'no-es-email' });

      expect(res.status).toBe(400);
    });

    it('CI que ya tiene PIN activo → 409', async () => {
      await cliente.update({ pin_hash: await bcrypt.hash('1234', 10) });

      const res = await request(app)
        .post('/api/v1/cliente/pin/solicitar')
        .send({ numero_documento: cliente.numero_documento, pin: '5678', email: 'a@b.com' });

      expect(res.status).toBe(409);
    });

    it('caso feliz: crea la verificación pendiente y manda el código por email', async () => {
      const res = await request(app)
        .post('/api/v1/cliente/pin/solicitar')
        .send({ numero_documento: cliente.numero_documento, pin: '1234', email: 'cliente@example.com' });

      expect(res.status).toBe(200);
      expect(res.body.datos).toEqual({ ok: true });
      expect(enviarCodigoPin).toHaveBeenCalledTimes(1);
      expect(enviarCodigoPin.mock.calls[0][0].to).toBe('cliente@example.com');

      const pendiente = await ClientePinVerificacion.findOne({ where: { cliente_id: cliente.id } });
      expect(pendiente).not.toBeNull();
      expect(pendiente.email).toBe('cliente@example.com');
    });

    it('una segunda solicitud reemplaza la verificación pendiente anterior', async () => {
      await request(app).post('/api/v1/cliente/pin/solicitar')
        .send({ numero_documento: cliente.numero_documento, pin: '1111', email: 'primero@example.com' });
      await request(app).post('/api/v1/cliente/pin/solicitar')
        .send({ numero_documento: cliente.numero_documento, pin: '2222', email: 'segundo@example.com' });

      const filas = await ClientePinVerificacion.findAll({ where: { cliente_id: cliente.id } });
      expect(filas.length).toBe(1);
      expect(filas[0].email).toBe('segundo@example.com');
    });
  });

  describe('POST /api/v1/cliente/pin/confirmar', () => {
    async function solicitar(numero_documento, pin, email) {
      await request(app).post('/api/v1/cliente/pin/solicitar').send({ numero_documento, pin, email });
      const enviado = enviarCodigoPin.mock.calls[enviarCodigoPin.mock.calls.length - 1][0];
      return enviado.codigo;
    }

    it('sin verificación pendiente → 400', async () => {
      const res = await request(app)
        .post('/api/v1/cliente/pin/confirmar')
        .send({ numero_documento: cliente.numero_documento, codigo: '000000' });

      expect(res.status).toBe(400);
    });

    it('código incorrecto → 400 e incrementa intentos', async () => {
      await solicitar(cliente.numero_documento, '1234', 'a@b.com');

      const res = await request(app)
        .post('/api/v1/cliente/pin/confirmar')
        .send({ numero_documento: cliente.numero_documento, codigo: '999999' });

      expect(res.status).toBe(400);
      const pendiente = await ClientePinVerificacion.findOne({ where: { cliente_id: cliente.id } });
      expect(pendiente.intentos).toBe(1);
    });

    it('código vencido → 400', async () => {
      const codigo = await solicitar(cliente.numero_documento, '1234', 'a@b.com');
      await ClientePinVerificacion.update(
        { expira_en: new Date(Date.now() - 60_000) },
        { where: { cliente_id: cliente.id } }
      );

      const res = await request(app)
        .post('/api/v1/cliente/pin/confirmar')
        .send({ numero_documento: cliente.numero_documento, codigo });

      expect(res.status).toBe(400);
    });

    it('5 intentos fallidos seguidos → 429', async () => {
      await solicitar(cliente.numero_documento, '1234', 'a@b.com');
      for (let i = 0; i < 5; i++) {
        await request(app).post('/api/v1/cliente/pin/confirmar')
          .send({ numero_documento: cliente.numero_documento, codigo: '000000' });
      }

      const res = await request(app)
        .post('/api/v1/cliente/pin/confirmar')
        .send({ numero_documento: cliente.numero_documento, codigo: '000000' });

      expect(res.status).toBe(429);
    });

    it('código correcto → activa el PIN, guarda el email, borra el pendiente y devuelve un token', async () => {
      const codigo = await solicitar(cliente.numero_documento, '1234', 'confirmado@example.com');

      const res = await request(app)
        .post('/api/v1/cliente/pin/confirmar')
        .send({ numero_documento: cliente.numero_documento, codigo });

      expect(res.status).toBe(200);
      expect(res.body.datos.token).toBeDefined();

      const payload = jwt.verify(res.body.datos.token, process.env.JWT_SECRET);
      expect(payload.cliente_id).toBe(cliente.id);
      expect(payload.tipo).toBe('cliente');

      const actualizado = await Cliente.findByPk(cliente.id);
      expect(actualizado.pin_hash).not.toBeNull();
      expect(actualizado.email).toBe('confirmado@example.com');
      expect(await bcrypt.compare('1234', actualizado.pin_hash)).toBe(true);

      const pendiente = await ClientePinVerificacion.findOne({ where: { cliente_id: cliente.id } });
      expect(pendiente).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest clientePublico.test.js -v`
Expected: FAIL — `Cannot find module '../src/app'` resolving routes, or 404s (route doesn't exist yet).

- [ ] **Step 3: Write `clientePublico.service.js`**

```javascript
// backend/src/modules/clientePublico/clientePublico.service.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Cliente, ClientePinVerificacion } = require('../../models');
const clientesService = require('../clientes/clientes.service');
const { enviarCodigoPin } = require('../../integrations/email/email.client');

const CODIGO_EXPIRA_MINUTOS = 10;
const CODIGO_INTENTOS_MAX = 5;
const PIN_REGEX = /^\d{4}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function emitirToken(cliente_id) {
  return jwt.sign({ cliente_id, tipo: 'cliente' }, process.env.JWT_SECRET, { expiresIn: '180d' });
}

function _generarCodigo() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function _resolverCliente(numero_documento) {
  const cliente_id = await clientesService.resolverOCrearPorDocumento(numero_documento);
  if (!cliente_id) {
    throw Object.assign(new Error('No se pudo identificar ese CI. Verificá el número.'), { status: 404 });
  }
  return Cliente.findByPk(cliente_id);
}

async function estado(numero_documento) {
  const cliente = await _resolverCliente(numero_documento);
  return { tiene_pin: !!cliente.pin_hash };
}

async function solicitarPin({ numero_documento, pin, email }) {
  if (!PIN_REGEX.test(pin || '')) {
    throw Object.assign(new Error('El PIN debe ser de 4 dígitos'), { status: 400 });
  }
  if (!EMAIL_REGEX.test(email || '')) {
    throw Object.assign(new Error('Email inválido'), { status: 400 });
  }

  const cliente = await _resolverCliente(numero_documento);
  if (cliente.pin_hash) {
    throw Object.assign(new Error('Este CI ya tiene un PIN configurado'), { status: 409 });
  }

  const codigo = _generarCodigo();
  const [pin_hash, codigo_hash] = await Promise.all([
    bcrypt.hash(pin, 10),
    bcrypt.hash(codigo, 10),
  ]);

  await ClientePinVerificacion.destroy({ where: { cliente_id: cliente.id } });
  await ClientePinVerificacion.create({
    cliente_id: cliente.id,
    pin_hash,
    email,
    codigo_hash,
    intentos: 0,
    expira_en: new Date(Date.now() + CODIGO_EXPIRA_MINUTOS * 60_000),
  });

  await enviarCodigoPin({ to: email, codigo });
  return { ok: true };
}

async function confirmarPin({ numero_documento, codigo }) {
  const cliente = await _resolverCliente(numero_documento);
  const pendiente = await ClientePinVerificacion.findOne({ where: { cliente_id: cliente.id } });

  if (!pendiente || pendiente.expira_en < new Date()) {
    if (pendiente) await pendiente.destroy();
    throw Object.assign(new Error('Código vencido, pedí uno nuevo'), { status: 400 });
  }
  if (pendiente.intentos >= CODIGO_INTENTOS_MAX) {
    throw Object.assign(new Error('Demasiados intentos, pedí un código nuevo'), { status: 429 });
  }

  const coincide = await bcrypt.compare(String(codigo || ''), pendiente.codigo_hash);
  if (!coincide) {
    await pendiente.update({ intentos: pendiente.intentos + 1 });
    throw Object.assign(new Error('Código incorrecto'), { status: 400 });
  }

  await cliente.update({ pin_hash: pendiente.pin_hash, email: pendiente.email });
  await pendiente.destroy();

  return { token: emitirToken(cliente.id) };
}

module.exports = { estado, solicitarPin, confirmarPin, emitirToken };
```

- [ ] **Step 4: Write `clientePublico.controller.js`**

```javascript
// backend/src/modules/clientePublico/clientePublico.controller.js
const svc = require('./clientePublico.service');

async function estado(req, res, next) {
  try {
    if (!req.body.numero_documento) return res.status(400).json({ ok: false, mensaje: 'numero_documento es requerido' });
    res.json({ ok: true, datos: await svc.estado(req.body.numero_documento) });
  } catch (err) { next(err); }
}

async function solicitarPin(req, res, next) {
  try { res.json({ ok: true, datos: await svc.solicitarPin(req.body) }); }
  catch (err) { next(err); }
}

async function confirmarPin(req, res, next) {
  try { res.json({ ok: true, datos: await svc.confirmarPin(req.body) }); }
  catch (err) { next(err); }
}

module.exports = { estado, solicitarPin, confirmarPin };
```

- [ ] **Step 5: Write `clientePublico.routes.js`**

```javascript
// backend/src/modules/clientePublico/clientePublico.routes.js
const { Router } = require('express');
const ctrl = require('./clientePublico.controller');

const router = Router();

router.post('/estado', ctrl.estado);
router.post('/pin/solicitar', ctrl.solicitarPin);
router.post('/pin/confirmar', ctrl.confirmarPin);

module.exports = router;
```

- [ ] **Step 6: Mount the router in `app.js`**

Edit `backend/src/app.js` — add the require near `autoservicioRoutes`:

```javascript
const clientePublicoRoutes = require('./modules/clientePublico/clientePublico.routes');
```

Add the mount line near `app.use('/api/v1/autoservicio', autoservicioRoutes);`:

```javascript
app.use('/api/v1/cliente', clientePublicoRoutes);
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd backend && npx jest clientePublico.test.js -v`
Expected: PASS (all tests in this file so far)

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/clientePublico backend/src/app.js backend/tests/clientePublico.test.js
git commit -m "feat(fidelidad): flujo de creacion de PIN con verificacion por email"
```

---

### Task 5: Login con CI + PIN (`verificar`) con bloqueo temporal

**Files:**
- Modify: `backend/src/modules/clientePublico/clientePublico.service.js`
- Modify: `backend/src/modules/clientePublico/clientePublico.controller.js`
- Modify: `backend/src/modules/clientePublico/clientePublico.routes.js`
- Test: `backend/tests/clientePublico.test.js`

**Interfaces:**
- Consumes: `emitirToken` (from this same file, Task 4), `Cliente` model.
- Produces: `POST /api/v1/cliente/pin/verificar` `{ numero_documento, pin }` → `{ token }`; service function `verificarPin({ numero_documento, pin })`.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/clientePublico.test.js`, inside the top-level `describe('Cliente público — PIN', ...)` block, after the `confirmar` describe:

```javascript
  describe('POST /api/v1/cliente/pin/verificar', () => {
    beforeEach(async () => {
      await cliente.update({ pin_hash: await bcrypt.hash('4321', 10) });
    });

    it('sin PIN configurado (otro cliente) → 409', async () => {
      const timestamp = Date.now();
      const sinPin = await Cliente.create({ nombre: 'Sin PIN', numero_documento: `sinpin-${timestamp}` });

      const res = await request(app)
        .post('/api/v1/cliente/pin/verificar')
        .send({ numero_documento: sinPin.numero_documento, pin: '0000' });

      expect(res.status).toBe(409);
      await Cliente.destroy({ where: { id: sinPin.id } });
    });

    it('PIN correcto → 200 con token y resetea el contador de intentos', async () => {
      await cliente.update({ pin_intentos_fallidos: 2 });

      const res = await request(app)
        .post('/api/v1/cliente/pin/verificar')
        .send({ numero_documento: cliente.numero_documento, pin: '4321' });

      expect(res.status).toBe(200);
      expect(res.body.datos.token).toBeDefined();
      const payload = jwt.verify(res.body.datos.token, process.env.JWT_SECRET);
      expect(payload.cliente_id).toBe(cliente.id);

      const actualizado = await Cliente.findByPk(cliente.id);
      expect(actualizado.pin_intentos_fallidos).toBe(0);
    });

    it('PIN incorrecto → 401 e incrementa el contador', async () => {
      const res = await request(app)
        .post('/api/v1/cliente/pin/verificar')
        .send({ numero_documento: cliente.numero_documento, pin: '0000' });

      expect(res.status).toBe(401);
      const actualizado = await Cliente.findByPk(cliente.id);
      expect(actualizado.pin_intentos_fallidos).toBe(1);
    });

    it('5 intentos fallidos seguidos → bloquea 5 minutos y resetea el contador', async () => {
      for (let i = 0; i < 5; i++) {
        await request(app).post('/api/v1/cliente/pin/verificar')
          .send({ numero_documento: cliente.numero_documento, pin: '0000' });
      }

      const actualizado = await Cliente.findByPk(cliente.id);
      expect(actualizado.pin_intentos_fallidos).toBe(0);
      expect(actualizado.pin_bloqueado_hasta).not.toBeNull();
      expect(actualizado.pin_bloqueado_hasta.getTime()).toBeGreaterThan(Date.now());
    });

    it('bloqueo vigente → 429 aunque el PIN sea correcto, sin tocar el contador', async () => {
      await cliente.update({ pin_bloqueado_hasta: new Date(Date.now() + 60_000), pin_intentos_fallidos: 0 });

      const res = await request(app)
        .post('/api/v1/cliente/pin/verificar')
        .send({ numero_documento: cliente.numero_documento, pin: '4321' });

      expect(res.status).toBe(429);
      const actualizado = await Cliente.findByPk(cliente.id);
      expect(actualizado.pin_intentos_fallidos).toBe(0);
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest clientePublico.test.js -v -t "verificar"`
Expected: FAIL — 404 (route doesn't exist).

- [ ] **Step 3: Add `verificarPin` to the service**

Add to `backend/src/modules/clientePublico/clientePublico.service.js`, near the top (after the other constants):

```javascript
const PIN_INTENTOS_MAX = 5;
const PIN_BLOQUEO_MINUTOS = 5;
```

Add the function, before `module.exports`:

```javascript
async function verificarPin({ numero_documento, pin }) {
  const cliente = await _resolverCliente(numero_documento);
  if (!cliente.pin_hash) {
    throw Object.assign(new Error('Este CI todavía no tiene un PIN configurado'), { status: 409 });
  }

  if (cliente.pin_bloqueado_hasta && cliente.pin_bloqueado_hasta > new Date()) {
    throw Object.assign(new Error('Demasiados intentos, esperá unos minutos y volvé a intentar'), { status: 429 });
  }

  const coincide = await bcrypt.compare(String(pin || ''), cliente.pin_hash);
  if (!coincide) {
    const intentos = cliente.pin_intentos_fallidos + 1;
    if (intentos >= PIN_INTENTOS_MAX) {
      await cliente.update({ pin_intentos_fallidos: 0, pin_bloqueado_hasta: new Date(Date.now() + PIN_BLOQUEO_MINUTOS * 60_000) });
    } else {
      await cliente.update({ pin_intentos_fallidos: intentos });
    }
    throw Object.assign(new Error('PIN incorrecto'), { status: 401 });
  }

  await cliente.update({ pin_intentos_fallidos: 0 });
  return { token: emitirToken(cliente.id) };
}
```

Update `module.exports`:

```javascript
module.exports = { estado, solicitarPin, confirmarPin, verificarPin, emitirToken };
```

- [ ] **Step 4: Add the controller and route**

Add to `backend/src/modules/clientePublico/clientePublico.controller.js`, before `module.exports`:

```javascript
async function verificarPin(req, res, next) {
  try { res.json({ ok: true, datos: await svc.verificarPin(req.body) }); }
  catch (err) { next(err); }
}
```

Update `module.exports`:

```javascript
module.exports = { estado, solicitarPin, confirmarPin, verificarPin };
```

Add to `backend/src/modules/clientePublico/clientePublico.routes.js`:

```javascript
router.post('/pin/verificar', ctrl.verificarPin);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npx jest clientePublico.test.js -v`
Expected: PASS (all tests in the file)

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/clientePublico backend/tests/clientePublico.test.js
git commit -m "feat(fidelidad): login por CI + PIN con bloqueo temporal tras intentos fallidos"
```

---

### Task 6: Middleware de sesión del cliente, cambiar PIN y perfil

**Files:**
- Create: `backend/src/middlewares/authCliente.js`
- Modify: `backend/src/modules/clientePublico/clientePublico.service.js`
- Modify: `backend/src/modules/clientePublico/clientePublico.controller.js`
- Modify: `backend/src/modules/clientePublico/clientePublico.routes.js`
- Test: `backend/tests/clientePublico.test.js`

**Interfaces:**
- Produces: `authCliente` (Express middleware, required — 401 if missing/invalid token, else sets `req.clienteId`), `authClienteOpcional` (Express middleware — sets `req.clienteId` if a valid token is present, otherwise calls `next()` without erroring). Both consumed here and by Task 7 (`authCliente`) and Task 8 (`authClienteOpcional`).
- Produces: `PUT /api/v1/cliente/pin` (requires `authCliente`) `{ pin_actual, pin_nuevo }` → `{ ok: true }`. `GET /api/v1/cliente/perfil` (requires `authCliente`) → `{ nombre, puntos }`.

- [ ] **Step 1: Write the failing tests**

Add near the top of `backend/tests/clientePublico.test.js`, after the existing `jest.mock` and requires:

```javascript
function tokenPara(clienteId) {
  return jwt.sign({ cliente_id: clienteId, tipo: 'cliente' }, process.env.JWT_SECRET, { expiresIn: '180d' });
}
```

Add a new `describe` block, as a sibling of the existing ones inside `describe('Cliente público — PIN', ...)`:

```javascript
  describe('PUT /api/v1/cliente/pin (cambiar) y GET /api/v1/cliente/perfil', () => {
    beforeEach(async () => {
      await cliente.update({ pin_hash: await bcrypt.hash('1111', 10), puntos: 42 });
    });

    it('GET /perfil sin token → 401', async () => {
      const res = await request(app).get('/api/v1/cliente/perfil');
      expect(res.status).toBe(401);
    });

    it('GET /perfil con token válido → nombre y puntos', async () => {
      const res = await request(app)
        .get('/api/v1/cliente/perfil')
        .set('Authorization', `Bearer ${tokenPara(cliente.id)}`);

      expect(res.status).toBe(200);
      expect(res.body.datos).toEqual({ nombre: cliente.nombre, puntos: 42 });
    });

    it('PUT /pin sin token → 401', async () => {
      const res = await request(app)
        .put('/api/v1/cliente/pin')
        .send({ pin_actual: '1111', pin_nuevo: '2222' });
      expect(res.status).toBe(401);
    });

    it('PUT /pin con pin_actual incorrecto → 401, no cambia nada', async () => {
      const res = await request(app)
        .put('/api/v1/cliente/pin')
        .set('Authorization', `Bearer ${tokenPara(cliente.id)}`)
        .send({ pin_actual: '0000', pin_nuevo: '2222' });

      expect(res.status).toBe(401);
      const actualizado = await Cliente.findByPk(cliente.id);
      expect(await bcrypt.compare('1111', actualizado.pin_hash)).toBe(true);
    });

    it('PUT /pin con pin_actual correcto → cambia el PIN', async () => {
      const res = await request(app)
        .put('/api/v1/cliente/pin')
        .set('Authorization', `Bearer ${tokenPara(cliente.id)}`)
        .send({ pin_actual: '1111', pin_nuevo: '2222' });

      expect(res.status).toBe(200);
      const actualizado = await Cliente.findByPk(cliente.id);
      expect(await bcrypt.compare('2222', actualizado.pin_hash)).toBe(true);
    });

    it('token inválido → 401', async () => {
      const res = await request(app)
        .get('/api/v1/cliente/perfil')
        .set('Authorization', 'Bearer token-basura');
      expect(res.status).toBe(401);
    });

    it('token de staff (tipo distinto) no sirve acá → 401', async () => {
      const tokenStaff = jwt.sign({ id: 1, sucursal_id: null }, process.env.JWT_SECRET, { expiresIn: '1h' });
      const res = await request(app)
        .get('/api/v1/cliente/perfil')
        .set('Authorization', `Bearer ${tokenStaff}`);
      expect(res.status).toBe(401);
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest clientePublico.test.js -v -t "cambiar"`
Expected: FAIL — 404s (routes don't exist).

- [ ] **Step 3: Write the middleware**

```javascript
// backend/src/middlewares/authCliente.js
const jwt = require('jsonwebtoken');

function _payloadDesdeHeader(req) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) return null;
  try {
    const payload = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
    return payload.tipo === 'cliente' ? payload : null;
  } catch {
    return null;
  }
}

// Requerida: sin token válido de tipo 'cliente', corta con 401.
function authCliente(req, res, next) {
  const payload = _payloadDesdeHeader(req);
  if (!payload) return res.status(401).json({ ok: false, mensaje: 'Token requerido' });
  req.clienteId = payload.cliente_id;
  next();
}

// Opcional: si hay un token válido de tipo 'cliente', adjunta req.clienteId;
// si no hay token, o es inválido, sigue de largo sin cortar (usada en el
// pedido de autoservicio, que es anónimo por defecto — ver Task 8).
function authClienteOpcional(req, res, next) {
  const payload = _payloadDesdeHeader(req);
  if (payload) req.clienteId = payload.cliente_id;
  next();
}

module.exports = { authCliente, authClienteOpcional };
```

- [ ] **Step 4: Add `cambiarPin` and `perfil` to the service**

Add to `backend/src/modules/clientePublico/clientePublico.service.js`, before `module.exports`:

```javascript
async function cambiarPin(cliente_id, { pin_actual, pin_nuevo }) {
  if (!PIN_REGEX.test(pin_nuevo || '')) {
    throw Object.assign(new Error('El PIN nuevo debe ser de 4 dígitos'), { status: 400 });
  }
  const cliente = await Cliente.findByPk(cliente_id);
  const coincide = cliente?.pin_hash && await bcrypt.compare(String(pin_actual || ''), cliente.pin_hash);
  if (!coincide) {
    throw Object.assign(new Error('El PIN actual no coincide'), { status: 401 });
  }
  await cliente.update({ pin_hash: await bcrypt.hash(pin_nuevo, 10) });
  return { ok: true };
}

async function perfil(cliente_id) {
  const cliente = await Cliente.findByPk(cliente_id, { attributes: ['nombre', 'puntos'] });
  if (!cliente) throw Object.assign(new Error('Cliente no encontrado'), { status: 404 });
  return { nombre: cliente.nombre, puntos: cliente.puntos };
}
```

Update `module.exports`:

```javascript
module.exports = { estado, solicitarPin, confirmarPin, verificarPin, cambiarPin, perfil, emitirToken };
```

- [ ] **Step 5: Add the controller functions and routes**

Add to `backend/src/modules/clientePublico/clientePublico.controller.js`, before `module.exports`:

```javascript
async function cambiarPin(req, res, next) {
  try { res.json({ ok: true, datos: await svc.cambiarPin(req.clienteId, req.body) }); }
  catch (err) { next(err); }
}

async function perfil(req, res, next) {
  try { res.json({ ok: true, datos: await svc.perfil(req.clienteId) }); }
  catch (err) { next(err); }
}
```

Update `module.exports`:

```javascript
module.exports = { estado, solicitarPin, confirmarPin, verificarPin, cambiarPin, perfil };
```

Update `backend/src/modules/clientePublico/clientePublico.routes.js` — add the `authCliente` import and the two new routes:

```javascript
const { Router } = require('express');
const ctrl = require('./clientePublico.controller');
const { authCliente } = require('../../middlewares/authCliente');

const router = Router();

router.post('/estado', ctrl.estado);
router.post('/pin/solicitar', ctrl.solicitarPin);
router.post('/pin/confirmar', ctrl.confirmarPin);
router.post('/pin/verificar', ctrl.verificarPin);
router.put('/pin', authCliente, ctrl.cambiarPin);
router.get('/perfil', authCliente, ctrl.perfil);

module.exports = router;
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && npx jest clientePublico.test.js -v`
Expected: PASS (all tests in the file)

- [ ] **Step 7: Commit**

```bash
git add backend/src/middlewares/authCliente.js backend/src/modules/clientePublico backend/tests/clientePublico.test.js
git commit -m "feat(fidelidad): sesion de cliente (JWT), cambiar PIN y perfil autenticado"
```

---

### Task 7: Historial de pedidos del cliente

**Files:**
- Modify: `backend/src/modules/ventas/ventas.service.js`
- Modify: `backend/src/modules/clientePublico/clientePublico.service.js`
- Modify: `backend/src/modules/clientePublico/clientePublico.controller.js`
- Modify: `backend/src/modules/clientePublico/clientePublico.routes.js`
- Test: `backend/tests/clientePublico.test.js`

**Interfaces:**
- Consumes: `ventasService.listar` (extended here with a `cliente_id` filter).
- Produces: `GET /api/v1/cliente/pedidos` (requires `authCliente`) → array of pedidos of that `cliente_id`, most recent first, `estado: 'completado'` only.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/clientePublico.test.js`, needs `Pedido, Sucursal, Area, Mesa, Categoria, Producto, DetallePedido, SesionCaja, Caja, Rol, Usuario` — update the requires at the top of the file:

```javascript
const { Cliente, ClientePinVerificacion, Pedido, Sucursal, Area, Mesa, Categoria, Producto, SesionCaja, Caja, Rol, Usuario } = require('../src/models');
```

Add a new `describe`, sibling of the others:

```javascript
  describe('GET /api/v1/cliente/pedidos (historial)', () => {
    // Nota: NO reutiliza el `cliente` del beforeEach de nivel superior — el
    // orden relativo entre un beforeAll anidado y un beforeEach del describe
    // padre no es algo en lo que valga la pena confiar. Este bloque crea su
    // propio cliente, autocontenido.
    let sucursal, area, mesa, categoria, producto, usuario, caja, sesionCaja, clienteHistorial, otroCliente, pedidoDeEsteCliente, pedidoDeOtroCliente;

    beforeAll(async () => {
      const timestamp = Date.now();
      sucursal = await Sucursal.create({ nombre: `Sucursal Historial Test ${timestamp}` });
      area = await Area.create({ nombre: `Area Historial Test ${timestamp}`, sucursal_id: sucursal.id });
      mesa = await Mesa.create({ area_id: area.id, nombre: 'Mesa Historial Test' });
      categoria = await Categoria.create({ nombre: `Categoria Historial Test ${timestamp}` });
      producto = await Producto.create({ categoria_id: categoria.id, nombre: `Producto Historial Test ${timestamp}`, precio: 10, stock: 0 });

      const rol = await Rol.findOne({ where: { nombre: 'Cajero' } });
      usuario = await Usuario.create({ rol_id: rol.id, nombre: `Historial Test ${timestamp}`, email: `historial-test-${timestamp}@restaurante.com`, contrasena: 'x' });
      caja = await Caja.create({ sucursal_id: sucursal.id, nombre: 'Caja Historial Test' });
      sesionCaja = await SesionCaja.create({ usuario_id: usuario.id, sucursal_id: sucursal.id, caja_id: caja.id, monto_apertura: 0 });

      clienteHistorial = await Cliente.create({ nombre: 'Cliente Historial', numero_documento: `hist-${timestamp}` });
      otroCliente = await Cliente.create({ nombre: 'Otro Cliente', numero_documento: `otro-${timestamp}` });

      pedidoDeEsteCliente = await Pedido.create({
        mesa_id: mesa.id, tipo: 'mesa', usuario_id: usuario.id, cliente_id: clienteHistorial.id,
        sesion_caja_id: sesionCaja.id, sucursal_id: sucursal.id, estado: 'completado', total: 10,
      });
      pedidoDeOtroCliente = await Pedido.create({
        mesa_id: mesa.id, tipo: 'mesa', usuario_id: usuario.id, cliente_id: otroCliente.id,
        sesion_caja_id: sesionCaja.id, sucursal_id: sucursal.id, estado: 'completado', total: 20,
      });
    });

    afterAll(async () => {
      await Pedido.destroy({ where: { id: [pedidoDeEsteCliente.id, pedidoDeOtroCliente.id] } });
      await SesionCaja.destroy({ where: { id: sesionCaja.id } });
      await Caja.destroy({ where: { id: caja.id } });
      await Usuario.destroy({ where: { id: usuario.id } });
      await Cliente.destroy({ where: { id: [clienteHistorial.id, otroCliente.id] } });
      await Producto.destroy({ where: { id: producto.id } });
      await Categoria.destroy({ where: { id: categoria.id } });
      await Mesa.destroy({ where: { id: mesa.id } });
      await Area.destroy({ where: { id: area.id } });
      await Sucursal.destroy({ where: { id: sucursal.id } });
    });

    it('sin token → 401', async () => {
      const res = await request(app).get('/api/v1/cliente/pedidos');
      expect(res.status).toBe(401);
    });

    it('devuelve solo los pedidos de ese cliente_id, no los de otro cliente', async () => {
      const res = await request(app)
        .get('/api/v1/cliente/pedidos')
        .set('Authorization', `Bearer ${tokenPara(clienteHistorial.id)}`);

      expect(res.status).toBe(200);
      const ids = res.body.datos.map((p) => p.id);
      expect(ids).toContain(pedidoDeEsteCliente.id);
      expect(ids).not.toContain(pedidoDeOtroCliente.id);
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest clientePublico.test.js -v -t "historial"`
Expected: FAIL — 404 (route doesn't exist)

- [ ] **Step 3: Add a `cliente_id` filter to `ventasService.listar`**

Edit `backend/src/modules/ventas/ventas.service.js` — change:

```javascript
async function listar({ estado, mesa_id, sucursal_id, acceso_todas } = {}) {
  const where = {};
  if (estado) {
    where.estado = estado.includes(',') ? { [Op.in]: estado.split(',') } : estado;
  }
  if (mesa_id) where.mesa_id = mesa_id;
  if (!acceso_todas) where.sucursal_id = sucursal_id;
  return Pedido.findAll({ where, include: INCLUDE_PEDIDO_COMPLETO, order: [['creado_en', 'DESC']] });
}
```

to:

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

- [ ] **Step 4: Add `historial` to `clientePublico.service.js`**

Add near the top:

```javascript
const ventasService = require('../ventas/ventas.service');
```

Add before `module.exports`:

```javascript
async function historial(cliente_id) {
  return ventasService.listar({ cliente_id, estado: 'completado', acceso_todas: true });
}
```

Update `module.exports`:

```javascript
module.exports = { estado, solicitarPin, confirmarPin, verificarPin, cambiarPin, perfil, historial, emitirToken };
```

- [ ] **Step 5: Add the controller function and route**

Add to `backend/src/modules/clientePublico/clientePublico.controller.js`, before `module.exports` (note: this function is named `historial`, distinct from the existing `estado` function that also takes a CI — no naming collision):

```javascript
async function historial(req, res, next) {
  try { res.json({ ok: true, datos: await svc.historial(req.clienteId) }); }
  catch (err) { next(err); }
}
```

Update `module.exports`:

```javascript
module.exports = { estado, solicitarPin, confirmarPin, verificarPin, cambiarPin, perfil, historial };
```

Add to `backend/src/modules/clientePublico/clientePublico.routes.js`:

```javascript
router.get('/pedidos', authCliente, ctrl.historial);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && npx jest clientePublico.test.js -v`
Expected: PASS (all tests in the file)

- [ ] **Step 7: Run the full backend suite as a regression check**

Run: `cd backend && npm test`
Expected: same pass/fail baseline as before (the `listar` signature change is additive — existing callers that don't pass `cliente_id` are unaffected).

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/ventas/ventas.service.js backend/src/modules/clientePublico backend/tests/clientePublico.test.js
git commit -m "feat(fidelidad): historial de pedidos del cliente autenticado"
```

---

### Task 8: Canje de puntos en el pedido de autoservicio

**Files:**
- Modify: `backend/src/modules/autoservicio/autoservicio.routes.js`
- Modify: `backend/src/modules/autoservicio/autoservicio.controller.js`
- Modify: `backend/src/modules/autoservicio/autoservicio.service.js`
- Test: `backend/tests/autoservicio.test.js`

**Interfaces:**
- Consumes: `authClienteOpcional` (Task 6), `ventasService.crearCompleta` (already accepts `puntos_canjear`, unchanged).
- Produces: `crearPedido(codigo_qr, { items, cupon_codigo, numero_documento, puntos_canjear, clienteIdAutenticado })` in `autoservicio.service.js` — `puntos_canjear` is only forwarded to `crearCompleta` when `clienteIdAutenticado` is truthy; otherwise it's silently dropped and `cliente_id` falls back to the CI-only resolution.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/autoservicio.test.js` — needs `jwt` and `Cupon`-style fixtures. Add near the top:

```javascript
const jwt = require('jsonwebtoken');
```

Add a new `describe`, sibling of the existing ones, at the end of the file before the final closing `});`:

```javascript
  describe('canje de puntos en el pedido de autoservicio', () => {
    let sucursal, area, mesa, usuario, caja, clienteConPuntos;

    beforeAll(async () => {
      const timestamp = Date.now();
      sucursal = await Sucursal.create({ nombre: `Sucursal Autoservicio Canje Test ${timestamp}` });
      area = await Area.create({ nombre: `Area Autoservicio Canje Test ${timestamp}`, sucursal_id: sucursal.id });
      mesa = await Mesa.create({ area_id: area.id, nombre: 'Mesa Canje Test', codigo_qr: `cj-${timestamp}` });
      await MesaSesion.create({ mesa_id: mesa.id, sucursal_id: sucursal.id, abierta_por: 'staff' });

      const categoria = await Categoria.create({ nombre: `Categoria Autoservicio Canje Test ${timestamp}` });
      const producto = await Producto.create({ categoria_id: categoria.id, nombre: `Producto Autoservicio Canje Test ${timestamp}`, precio: 20, stock: 0 });
      await ProductoStockSucursal.create({ producto_id: producto.id, sucursal_id: sucursal.id, stock: 10 });
      mesa.productoId = producto.id;

      const rol = await Rol.findOne({ where: { nombre: 'Cajero' } });
      const hash = await bcrypt.hash('clave123', 10);
      usuario = await Usuario.create({ rol_id: rol.id, nombre: `Autoservicio Canje Test ${timestamp}`, email: `autoservicio-canje-test-${timestamp}@restaurante.com`, contrasena: hash });

      caja = await Caja.create({ sucursal_id: sucursal.id, nombre: 'Caja Autoservicio Canje Test' });
      await SesionCaja.create({ usuario_id: usuario.id, sucursal_id: sucursal.id, caja_id: caja.id, monto_apertura: 0 });

      clienteConPuntos = await Cliente.create({ nombre: 'Cliente Con Puntos', numero_documento: `pts-${timestamp}`, puntos: 1000 });
    });

    afterAll(async () => {
      const pedidosDeLaMesa = await Pedido.findAll({ where: { mesa_id: mesa.id }, attributes: ['id'] });
      const pedidoIds = pedidosDeLaMesa.map((p) => p.id);
      await PagoQr.destroy({ where: { pedido_id: { [Op.in]: pedidoIds } } });
      await DetallePedido.destroy({ where: { pedido_id: { [Op.in]: pedidoIds } } });
      await Pedido.destroy({ where: { mesa_id: mesa.id } });
      await SesionCaja.destroy({ where: { caja_id: caja.id } });
      await Caja.destroy({ where: { id: caja.id } });
      await Usuario.destroy({ where: { id: usuario.id } });
      await Cliente.destroy({ where: { id: clienteConPuntos.id } });
      await MesaSesion.destroy({ where: { mesa_id: mesa.id } });
      await Mesa.destroy({ where: { id: mesa.id } });
      await Area.destroy({ where: { id: area.id } });
      await Sucursal.destroy({ where: { id: sucursal.id } });
    });

    function tokenPara(clienteId) {
      return jwt.sign({ cliente_id: clienteId, tipo: 'cliente' }, process.env.JWT_SECRET, { expiresIn: '180d' });
    }

    it('sin token, puntos_canjear en el body se ignora (no baja el total ni pisa cliente_id)', async () => {
      const res = await request(app)
        .post(`/api/v1/autoservicio/mesa/${mesa.codigo_qr}/pedido`)
        .send({ items: [{ producto_id: mesa.productoId, cantidad: 1 }], puntos_canjear: 100, numero_documento: clienteConPuntos.numero_documento });

      expect(res.status).not.toBe(400);
      const pedido = await Pedido.findByPk(res.body.datos.pedido.id);
      // Sin token, cliente_id se resuelve igual por CI (comportamiento ya
      // existente), pero puntos_canjear no se aplica.
      expect(pedido.cliente_id).toBe(clienteConPuntos.id);
      expect(parseFloat(pedido.total)).toBe(20);
    });

    it('con token válido, puntos_canjear baja el total y usa el cliente_id del token', async () => {
      const res = await request(app)
        .post(`/api/v1/autoservicio/mesa/${mesa.codigo_qr}/pedido`)
        .set('Authorization', `Bearer ${tokenPara(clienteConPuntos.id)}`)
        .send({ items: [{ producto_id: mesa.productoId, cantidad: 1 }], puntos_canjear: 100 });

      // Mismo límite que el resto de esta suite: sin mock de CodePay, no se
      // afirma un status exacto de éxito (podría depender de la red), solo
      // que no fue rechazado como error de validación — y que el cliente_id
      // usado fue el del token, no uno resuelto por CI.
      expect(res.status).not.toBe(400);
      const pedido = await Pedido.findByPk(res.body.datos.pedido.id);
      expect(pedido.cliente_id).toBe(clienteConPuntos.id);
    });

    it('con token inválido, se comporta como si no hubiera token (no rompe el pedido)', async () => {
      const res = await request(app)
        .post(`/api/v1/autoservicio/mesa/${mesa.codigo_qr}/pedido`)
        .set('Authorization', 'Bearer token-basura')
        .send({ items: [{ producto_id: mesa.productoId, cantidad: 1 }] });

      expect(res.status).not.toBe(400);
      expect(res.status).not.toBe(401);
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest autoservicio.test.js -v -t "canje de puntos"`
Expected: FAIL — `puntos_canjear`/token not honored yet (the total won't reflect any redemption difference is not directly asserted, but the token-based `cliente_id` assertion in the second test will fail since `crearPedido` doesn't read `req.clienteId` yet).

- [ ] **Step 3: Wire `authClienteOpcional` into the route**

Edit `backend/src/modules/autoservicio/autoservicio.routes.js`:

```javascript
const { Router } = require('express');
const ctrl = require('./autoservicio.controller');
const { authClienteOpcional } = require('../../middlewares/authCliente');

const router = Router();

router.get('/mesa/:codigo_qr', ctrl.obtenerMenu);
router.post('/mesa/:codigo_qr/cupon/validar', ctrl.validarCupon);
router.post('/mesa/:codigo_qr/pedido', authClienteOpcional, ctrl.crearPedido);
router.get('/mesa/:codigo_qr/pedido/:pedido_id/estado', ctrl.estadoPedido);

module.exports = router;
```

- [ ] **Step 4: Update the controller to pass `req.clienteId` through**

Edit `backend/src/modules/autoservicio/autoservicio.controller.js`:

```javascript
async function crearPedido(req, res, next) {
  try {
    const { items, cupon_codigo, numero_documento, puntos_canjear } = req.body;
    const error = _validarItems(items);
    if (error) return res.status(400).json({ ok: false, mensaje: error });
    res.status(201).json({
      ok: true,
      datos: await svc.crearPedido(req.params.codigo_qr, {
        items, cupon_codigo, numero_documento, puntos_canjear, clienteIdAutenticado: req.clienteId,
      }),
    });
  } catch (err) { next(err); }
}
```

- [ ] **Step 5: Update the service to honor the authenticated client only**

Edit `backend/src/modules/autoservicio/autoservicio.service.js` — change:

```javascript
async function crearPedido(codigo_qr, { items, cupon_codigo, numero_documento }) {
  const { mesa, sesion } = await _mesaConSesionActiva(codigo_qr);
  const cliente_id = await clientesService.resolverOCrearPorDocumento(numero_documento);
```

to:

```javascript
async function crearPedido(codigo_qr, { items, cupon_codigo, numero_documento, puntos_canjear, clienteIdAutenticado }) {
  const { mesa, sesion } = await _mesaConSesionActiva(codigo_qr);
  // El cliente_id que gana puntos puede venir de un CI suelto (silencioso,
  // sin PIN) o de una sesión de cliente autenticada — la sesión manda si
  // está presente. Solo con sesión autenticada se permite canjear puntos:
  // sin eso, cualquiera podría mandar el CI de otro y gastarle los puntos
  // solo con saber ese número (ver spec de fidelidad).
  const cliente_id = clienteIdAutenticado || await clientesService.resolverOCrearPorDocumento(numero_documento);
  const puntosCanjearFinal = clienteIdAutenticado ? (puntos_canjear || 0) : 0;
```

Change the `ventasService.crearCompleta` call — add `puntos_canjear: puntosCanjearFinal,` right after `cliente_id,`:

```javascript
  return ventasService.crearCompleta({
    tipo: 'mesa',
    mesa_id: mesa.id,
    items,
    metodo_pago: 'qr',
    sesion_caja_id: sesionCaja.id,
    usuario_id: sesionCaja.usuario_id,
    cliente_id,
    puntos_canjear: puntosCanjearFinal,
    mesa_sesion_id: sesion.id,
    origen: 'autoservicio',
    // crearCompleta ya sabe validar y aplicar el cupón (misma lógica que usa
    // el cajero) — acá solo se deja pasar el código, sin reglas nuevas. Un
    // cupón "exclusivo de un cliente" o con límite por cliente sigue
    // fallando si no se identificó con CI (cliente_id null) — eso es
    // esperable, no un bug.
    cupon_codigo,
  });
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && npx jest autoservicio.test.js -v`
Expected: PASS (all tests in the file, including the pre-existing ones)

- [ ] **Step 7: Run the full backend suite as a regression check**

Run: `cd backend && npm test`
Expected: same pass/fail baseline as before this task.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/autoservicio backend/tests/autoservicio.test.js
git commit -m "feat(fidelidad): canje de puntos en autoservicio, solo con sesion de cliente valida"
```

---

### Task 9: Panel de staff — resetear PIN de un cliente

**Files:**
- Modify: `backend/src/modules/clientes/clientes.service.js`
- Modify: `backend/src/modules/clientes/clientes.controller.js`
- Modify: `backend/src/modules/clientes/clientes.routes.js`
- Modify: `frontend/src/api/clientes.js`
- Modify: `frontend/src/pages/clientes/ClientesPage.jsx`
- Test: `backend/tests/clientes.test.js`

**Interfaces:**
- Produces: `POST /api/v1/clientes/:id/resetear-pin` (staff, permiso `clientes.editar`) → `{ ok: true }`. `clientesService.listar`/`obtener` now strip `pin_hash`/`pin_intentos_fallidos`/`pin_bloqueado_hasta` from their output and add a `tiene_pin: boolean` field instead — this is a response-shape change consumed by the frontend in this same task.

- [ ] **Step 1: Write the failing backend tests**

Read `backend/tests/clientes.test.js` first (it's currently a 6-line smoke test) and add, keeping its existing test:

```javascript
const request = require('supertest');
const app = require('../src/app');
const bcrypt = require('bcryptjs');
const { Cliente, Rol, Usuario } = require('../src/models');

describe('Clientes API', () => {
  it('GET /api/v1/clientes sin token → 401', async () => {
    const res = await request(app).get('/api/v1/clientes');
    expect(res.status).toBe(401);
  });

  describe('con un usuario autenticado', () => {
    let usuario, token, cliente;

    beforeAll(async () => {
      const timestamp = Date.now();
      const rol = await Rol.findOne({ where: { nombre: 'Administrador' } });
      const hash = await bcrypt.hash('clave123', 10);
      usuario = await Usuario.create({ rol_id: rol.id, nombre: `Clientes Test ${timestamp}`, email: `clientes-test-${timestamp}@restaurante.com`, contrasena: hash, acceso_todas_sucursales: 1 });

      const login = await request(app).post('/api/v1/auth/login').send({ email: usuario.email, contrasena: 'clave123' });
      token = login.body.datos.token;

      cliente = await Cliente.create({ nombre: 'Cliente Reset Test', numero_documento: `reset-${timestamp}`, pin_hash: await bcrypt.hash('1234', 10) });
    });

    afterAll(async () => {
      await Cliente.destroy({ where: { id: cliente.id } });
      await Usuario.destroy({ where: { id: usuario.id } });
    });

    it('GET /api/v1/clientes no expone pin_hash y sí expone tiene_pin', async () => {
      const res = await request(app).get('/api/v1/clientes').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      const encontrado = res.body.datos.find((c) => c.id === cliente.id);
      expect(encontrado.pin_hash).toBeUndefined();
      expect(encontrado.tiene_pin).toBe(true);
    });

    it('POST /api/v1/clientes/:id/resetear-pin limpia el PIN', async () => {
      const res = await request(app)
        .post(`/api/v1/clientes/${cliente.id}/resetear-pin`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      const actualizado = await Cliente.findByPk(cliente.id);
      expect(actualizado.pin_hash).toBeNull();
      expect(actualizado.pin_intentos_fallidos).toBe(0);
      expect(actualizado.pin_bloqueado_hasta).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest clientes.test.js -v`
Expected: FAIL — `tiene_pin` undefined, `pin_hash` present, and 404 on the reset endpoint.

- [ ] **Step 3: Update `clientes.service.js`**

Change `listar` and `obtener` in `backend/src/modules/clientes/clientes.service.js`:

```javascript
function _sinPin(cliente) {
  const json = cliente.toJSON();
  json.tiene_pin = !!json.pin_hash;
  delete json.pin_hash;
  delete json.pin_intentos_fallidos;
  delete json.pin_bloqueado_hasta;
  return json;
}

async function listar({ buscar } = {}) {
  const where = {};
  if (buscar) {
    where[Op.or] = [
      { nombre: { [Op.like]: `%${buscar}%` } },
      { numero_documento: { [Op.like]: `%${buscar}%` } },
    ];
  }
  const clientes = await Cliente.findAll({ where, order: [['nombre', 'ASC']] });
  return clientes.map(_sinPin);
}

async function obtener(id) {
  const c = await Cliente.findByPk(id);
  if (!c) throw Object.assign(new Error('Cliente no encontrado'), { status: 404 });
  return _sinPin(c);
}
```

Add `resetearPin`, before `module.exports`:

```javascript
async function resetearPin(id) {
  const c = await Cliente.findByPk(id);
  if (!c) throw Object.assign(new Error('Cliente no encontrado'), { status: 404 });
  await c.update({ pin_hash: null, pin_intentos_fallidos: 0, pin_bloqueado_hasta: null });
  return { ok: true };
}
```

Update `module.exports`:

```javascript
module.exports = { listar, obtener, crear, actualizar, buscarPorDocumento, buscarPorNombre, buscarPorCodigo, resolverOCrearPorDocumento, resetearPin };
```

Note: `actualizar` calls `Cliente.findByPk` then `c.update(datos); return c;` — it returns the raw Sequelize instance, not through `_sinPin`. Leave `actualizar` as-is (staff editing their own change, not a listing) — out of scope for this task.

- [ ] **Step 4: Add the controller function and route**

Add to `backend/src/modules/clientes/clientes.controller.js`, before `module.exports`:

```javascript
async function resetearPin(req, res, next) {
  try { res.json({ ok: true, datos: await svc.resetearPin(req.params.id) }); }
  catch (err) { next(err); }
}
```

Update `module.exports`:

```javascript
module.exports = { listar, obtener, crear, actualizar, buscarDocumento, buscarNombre, buscarCodigo, resetearPin };
```

Add to `backend/src/modules/clientes/clientes.routes.js`, after the `PUT /:id` route:

```javascript
router.post('/:id/resetear-pin', verificarPermiso('clientes', 'editar'), ctrl.resetearPin);
```

- [ ] **Step 5: Run backend tests to verify they pass**

Run: `cd backend && npx jest clientes.test.js -v`
Expected: PASS (all tests in the file)

- [ ] **Step 6: Run the full backend suite as a regression check**

Run: `cd backend && npm test`
Expected: same pass/fail baseline as before this task, except check specifically that no other test relied on `listar`/`obtener` returning `pin_hash`-shaped raw Sequelize instances (they didn't exist before this task, so nothing should).

- [ ] **Step 7: Add the frontend API call**

Add to `frontend/src/api/clientes.js`:

```javascript
export const resetearPinCliente = (id) =>
  api.post(`/clientes/${id}/resetear-pin`).then(r => r.data.datos);
```

- [ ] **Step 8: Add the "Resetear PIN" button to `ClientesPage.jsx`**

Edit `frontend/src/pages/clientes/ClientesPage.jsx`.

Update the import line to add `resetearPinCliente` and the `KeyRound` icon:

```javascript
import { getClientes, crearCliente, actualizarCliente, buscarClientePorDocumento, buscarClientesPorNombre, buscarClientePorCodigo, resetearPinCliente } from '../../api/clientes';
import {
  Users, Plus, Search, X, Edit2, Phone, Mail, MapPin,
  CreditCard, UserCircle, AlertTriangle, Star, Loader2, KeyRound,
} from 'lucide-react';
```

In `ModalCliente`, add a new prop `onResetearPin` and a button — change the function signature and the footer buttons:

```javascript
function ModalCliente({ cliente, onClose, onGuardar, loading, onResetearPin, reseteandoPin }) {
```

Add, right before the closing `<div className="flex gap-2 pt-1">` buttons block's opening (i.e. right after the `{error && (...)}` block and before `<div className="flex gap-2 pt-1">`):

```javascript
          {cliente?.tiene_pin && (
            <button
              type="button"
              onClick={() => onResetearPin(cliente.id)}
              disabled={reseteandoPin}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-400 text-sm font-medium hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors disabled:opacity-60"
            >
              <KeyRound className="w-4 h-4" />
              {reseteandoPin ? 'Reseteando...' : 'Resetear PIN de autoservicio'}
            </button>
          )}
```

In `ClientesPage`, add the mutation next to `mutEditar`:

```javascript
  const mutResetearPin = useMutation({
    mutationFn: resetearPinCliente,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clientes'] });
      mostrarToast('PIN reseteado — el cliente puede crear uno nuevo desde autoservicio');
    },
    onError: (e) => mostrarToast(e?.response?.data?.mensaje ?? 'Error al resetear el PIN', false),
  });
```

Update the `<ModalCliente ...>` usage to pass the new props:

```javascript
      {modal && (
        <ModalCliente
          cliente={modal === 'nuevo' ? null : modal}
          onClose={() => setModal(null)}
          onGuardar={handleGuardar}
          loading={isMutLoading}
          onResetearPin={mutResetearPin.mutate}
          reseteandoPin={mutResetearPin.isPending}
        />
      )}
```

- [ ] **Step 9: Manually verify in the browser**

Run: `cd frontend && npm run dev` (and `cd backend && npm run dev` if not already running)
Open Configuración → Clientes (or wherever `ClientesPage` is routed), edit a client that has `tiene_pin: true` (create one via the autoservicio PIN flow first, or set `pin_hash` manually in the DB for a quick check), confirm the "Resetear PIN de autoservicio" button appears, click it, confirm the toast appears and the button disappears after the list refetches (since `tiene_pin` is now `false`).
Expected: button visible only for clients with an active PIN; disappears after reset.

- [ ] **Step 10: Commit**

```bash
git add backend/src/modules/clientes backend/tests/clientes.test.js frontend/src/api/clientes.js frontend/src/pages/clientes/ClientesPage.jsx
git commit -m "feat(fidelidad): boton de staff para resetear el PIN de autoservicio de un cliente"
```

---

### Task 10: Frontend de autoservicio — identificarse, crear/cambiar PIN, historial, canje

**Files:**
- Create: `frontend/src/store/clienteAutoservicioStore.js`
- Create: `frontend/src/api/clientePublico.js`
- Modify: `frontend/src/api/configuracion.js`
- Modify: `backend/src/modules/configuracion/configuracion.service.js`
- Modify: `frontend/src/api/autoservicio.js`
- Modify: `frontend/src/pages/autoservicio/AutoservicioPage.jsx`

**Interfaces:**
- Consumes: every `clientePublico` endpoint from Tasks 4–7, `crearPedidoAutoservicio` (extended here with `puntosCanjear` and the stored token).
- Produces: `useClienteAutoservicioStore` (zustand+persist, `{ token, setToken(token), logout() }`, localStorage key `cliente-autoservicio`) — a self-contained store, no other file needs to know its shape beyond this hook.

- [ ] **Step 1: Expose the fidelidad flags in the public configuration**

Edit `backend/src/modules/configuracion/configuracion.service.js` — change:

```javascript
async function obtenerPublica() {
  const claves = ['nombre_negocio', 'logo', 'color_primario', 'color_secundario'];
```

to:

```javascript
async function obtenerPublica() {
  const claves = ['nombre_negocio', 'logo', 'color_primario', 'color_secundario', 'fidelidad_activa', 'fidelidad_canje_qr'];
```

- [ ] **Step 2: Run the existing configuracion tests to confirm nothing broke**

Run: `cd backend && npx jest configuracion.test.js -v`
Expected: PASS (this is an additive change to the returned key list; if this test file doesn't exist, skip this step and run `cd backend && npm test` instead as the regression check).

- [ ] **Step 3: Commit the backend piece separately**

```bash
git add backend/src/modules/configuracion/configuracion.service.js
git commit -m "feat(fidelidad): exponer flags de fidelidad en la configuracion publica"
```

- [ ] **Step 4: Create the client session store**

```javascript
// frontend/src/store/clienteAutoservicioStore.js
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Sesión del cliente en autoservicio (CI + PIN) — separada de todo lo
// demás: no es el login del staff, y no se comparte con el store de tema.
// Guarda solo el token; el nombre/puntos se piden en caliente vía
// /cliente/perfil cuando hace falta mostrarlos, para no cachear datos que
// puedan quedar viejos.
export const useClienteAutoservicioStore = create(
  persist(
    (set) => ({
      token: null,
      setToken: (token) => set({ token }),
      logout: () => set({ token: null }),
    }),
    { name: 'cliente-autoservicio' }
  )
);
```

- [ ] **Step 5: Create the API client**

```javascript
// frontend/src/api/clientePublico.js
import api from './cliente';
import { useClienteAutoservicioStore } from '../store/clienteAutoservicioStore';

function authHeader() {
  const token = useClienteAutoservicioStore.getState().token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export const estadoCliente = (numeroDocumento) =>
  api.post('/cliente/estado', { numero_documento: numeroDocumento }).then(r => r.data.datos);

export const solicitarPinCliente = (numeroDocumento, pin, email) =>
  api.post('/cliente/pin/solicitar', { numero_documento: numeroDocumento, pin, email }).then(r => r.data.datos);

export const confirmarPinCliente = (numeroDocumento, codigo) =>
  api.post('/cliente/pin/confirmar', { numero_documento: numeroDocumento, codigo }).then(r => r.data.datos);

export const verificarPinCliente = (numeroDocumento, pin) =>
  api.post('/cliente/pin/verificar', { numero_documento: numeroDocumento, pin }).then(r => r.data.datos);

export const cambiarPinCliente = (pinActual, pinNuevo) =>
  api.put('/cliente/pin', { pin_actual: pinActual, pin_nuevo: pinNuevo }, { headers: authHeader() }).then(r => r.data.datos);

export const perfilCliente = () =>
  api.get('/cliente/perfil', { headers: authHeader() }).then(r => r.data.datos);

export const historialCliente = () =>
  api.get('/cliente/pedidos', { headers: authHeader() }).then(r => r.data.datos);
```

- [ ] **Step 6: Extend `crearPedidoAutoservicio` to send the token and `puntos_canjear`**

Edit `frontend/src/api/autoservicio.js` — change:

```javascript
export const crearPedidoAutoservicio = (codigo, items, cuponCodigo, numeroDocumento) =>
  api.post(`/autoservicio/mesa/${codigo}/pedido`, {
    items, cupon_codigo: cuponCodigo || undefined, numero_documento: numeroDocumento || undefined,
  }).then(r => r.data.datos);
```

to:

```javascript
import { useClienteAutoservicioStore } from '../store/clienteAutoservicioStore';

export const crearPedidoAutoservicio = (codigo, items, cuponCodigo, numeroDocumento, puntosCanjear) => {
  const token = useClienteAutoservicioStore.getState().token;
  return api.post(
    `/autoservicio/mesa/${codigo}/pedido`,
    { items, cupon_codigo: cuponCodigo || undefined, numero_documento: numeroDocumento || undefined, puntos_canjear: puntosCanjear || undefined },
    token ? { headers: { Authorization: `Bearer ${token}` } } : undefined
  ).then(r => r.data.datos);
};
```

(Add the `import` line at the top of the file, next to the existing `import api from './cliente';`.)

- [ ] **Step 7: Build the "Mi cuenta" UI in `AutoservicioPage.jsx`**

Edit `frontend/src/pages/autoservicio/AutoservicioPage.jsx`.

Add imports (extend the existing `lucide-react` import and add the new ones):

```javascript
import { Plus, Minus, ShoppingCart, X, Loader2, CheckCircle2, AlertCircle, Package, Sun, Moon, User, Star, History, LogOut, KeyRound } from 'lucide-react';
import {
  getMenuAutoservicio, crearPedidoAutoservicio, validarCuponAutoservicio, getEstadoPedidoAutoservicio,
} from '../../api/autoservicio';
import {
  estadoCliente, solicitarPinCliente, confirmarPinCliente, verificarPinCliente,
  cambiarPinCliente, perfilCliente, historialCliente,
} from '../../api/clientePublico';
import { useClienteAutoservicioStore } from '../../store/clienteAutoservicioStore';
```

Add state and the account sheet toggle, right after the existing state declarations (after `const { modo, toggleModo } = useTemaAutoservicio();`):

```javascript
  const [mostrarCuenta, setMostrarCuenta] = useState(false);
  const [puntosACanjear, setPuntosACanjear] = useState(0);
  const { token } = useClienteAutoservicioStore();
```

Add the fidelidad-config-driven redemption check right after the `totalConDescuento` line:

```javascript
  const puedeCanjear = token && config?.fidelidad_activa === 'true' && config?.fidelidad_canje_qr === 'true';
  const { data: perfil } = useQuery({
    queryKey: ['cliente-perfil'],
    queryFn: perfilCliente,
    enabled: !!token,
  });
  // No hay una vista previa del descuento en Bs acá: el valor de cada punto
  // (Configuracion.valor_punto_bs) no está expuesto en la config pública, y
  // el backend ya recalcula todo dentro de crearCompleta/iniciarPagoQr — el
  // cliente ve el monto final recién en la pantalla del QR de pago.
```

Update the `crear` mutation to send `puntosACanjear`:

```javascript
  const crear = useMutation({
    mutationFn: () => crearPedidoAutoservicio(codigo, itemsParaBackend(), cuponCodigo.trim(), ciCliente.trim(), puedeCanjear ? puntosACanjear : 0),
    onSuccess: (datos) => setPedido(datos),
  });
```

Add the "Mi cuenta" button to the header, right after the theme toggle button (before the header's closing `</header>`):

```javascript
        <button
          onClick={() => setMostrarCuenta(true)}
          title="Mi cuenta"
          className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
        >
          <User className="w-5 h-5" />
        </button>
```

Add the redemption control in the cart sheet, right after the "¿Tenés CI registrado?" block and before `{crear.isError && (`:

```javascript
            {puedeCanjear && perfil?.puntos > 0 && (
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Usar puntos ({perfil.puntos} disponibles)
                </label>
                <input
                  type="number"
                  min={0}
                  max={perfil.puntos}
                  value={puntosACanjear}
                  onChange={(e) => setPuntosACanjear(Math.max(0, Math.min(perfil.puntos, parseInt(e.target.value, 10) || 0)))}
                  placeholder="0"
                  className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            )}
```

Add the `<CuentaSheet>` render, right after the cart sheet's closing (right before the final `</div>` that closes the page's root `<div className="min-h-screen ...">`):

```javascript
      {mostrarCuenta && (
        <CuentaSheet onClose={() => setMostrarCuenta(false)} />
      )}
```

Add the `CuentaSheet` component at the bottom of the file, after `function ToggleTema()`:

```javascript
function CuentaSheet({ onClose }) {
  const { token, setToken, logout } = useClienteAutoservicioStore();
  const [vista, setVista] = useState('inicio'); // inicio | pin | codigo | historial | cambiar-pin
  const [numeroDocumento, setNumeroDocumento] = useState('');
  const [pin, setPin] = useState('');
  const [email, setEmail] = useState('');
  const [codigo, setCodigo] = useState('');
  const [pinNuevo, setPinNuevo] = useState('');
  const [pinActual, setPinActual] = useState('');
  const [error, setError] = useState('');

  const { data: perfil } = useQuery({ queryKey: ['cliente-perfil'], queryFn: perfilCliente, enabled: !!token });
  const { data: historial = [] } = useQuery({ queryKey: ['cliente-historial'], queryFn: historialCliente, enabled: !!token && vista === 'historial' });

  const consultarEstado = useMutation({
    mutationFn: () => estadoCliente(numeroDocumento.trim()),
    onSuccess: (datos) => { setError(''); setVista(datos.tiene_pin ? 'ingresar-pin' : 'crear-pin'); },
    onError: (e) => setError(e?.response?.data?.mensaje ?? 'No se pudo verificar ese CI'),
  });

  const login = useMutation({
    mutationFn: () => verificarPinCliente(numeroDocumento.trim(), pin.trim()),
    onSuccess: (datos) => { setToken(datos.token); setError(''); setVista('inicio'); },
    onError: (e) => setError(e?.response?.data?.mensaje ?? 'PIN incorrecto'),
  });

  const solicitar = useMutation({
    mutationFn: () => solicitarPinCliente(numeroDocumento.trim(), pin.trim(), email.trim()),
    onSuccess: () => { setError(''); setVista('codigo'); },
    onError: (e) => setError(e?.response?.data?.mensaje ?? 'No se pudo enviar el código'),
  });

  const confirmar = useMutation({
    mutationFn: () => confirmarPinCliente(numeroDocumento.trim(), codigo.trim()),
    onSuccess: (datos) => { setToken(datos.token); setError(''); setVista('inicio'); },
    onError: (e) => setError(e?.response?.data?.mensaje ?? 'Código incorrecto'),
  });

  const cambiar = useMutation({
    mutationFn: () => cambiarPinCliente(pinActual.trim(), pinNuevo.trim()),
    onSuccess: () => { setError(''); setPinActual(''); setPinNuevo(''); setVista('inicio'); },
    onError: (e) => setError(e?.response?.data?.mensaje ?? 'No se pudo cambiar el PIN'),
  });

  const inputCls = 'w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring';
  const botonCls = 'w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-60';

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/50" onClick={onClose}>
      <div className="w-full max-w-md mx-auto bg-card rounded-t-2xl p-4 space-y-3 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-foreground flex items-center gap-2"><User className="w-4 h-4" /> Mi cuenta</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-muted-foreground" /></button>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {token && vista === 'inicio' && (
          <div className="space-y-3">
            <div className="rounded-xl bg-primary/10 p-3">
              <p className="font-semibold text-foreground">{perfil?.nombre}</p>
              <p className="text-sm text-primary flex items-center gap-1 mt-0.5"><Star className="w-3.5 h-3.5" /> {perfil?.puntos ?? 0} puntos</p>
            </div>
            <button onClick={() => setVista('historial')} className="w-full flex items-center gap-2 py-2.5 px-3 rounded-lg hover:bg-accent transition-colors text-sm text-foreground">
              <History className="w-4 h-4" /> Ver historial de pedidos
            </button>
            <button onClick={() => setVista('cambiar-pin')} className="w-full flex items-center gap-2 py-2.5 px-3 rounded-lg hover:bg-accent transition-colors text-sm text-foreground">
              <KeyRound className="w-4 h-4" /> Cambiar PIN
            </button>
            <button onClick={() => { logout(); onClose(); }} className="w-full flex items-center gap-2 py-2.5 px-3 rounded-lg hover:bg-accent transition-colors text-sm text-destructive">
              <LogOut className="w-4 h-4" /> Cerrar sesión
            </button>
          </div>
        )}

        {!token && vista === 'inicio' && (
          <div className="space-y-3">
            <label className="block text-xs font-medium text-muted-foreground">Tu número de CI</label>
            <input value={numeroDocumento} onChange={(e) => setNumeroDocumento(e.target.value)} placeholder="Número de CI" className={inputCls} />
            <button onClick={() => consultarEstado.mutate()} disabled={!numeroDocumento.trim() || consultarEstado.isPending} className={botonCls}>
              {consultarEstado.isPending ? 'Verificando...' : 'Continuar'}
            </button>
          </div>
        )}

        {vista === 'ingresar-pin' && (
          <div className="space-y-3">
            <label className="block text-xs font-medium text-muted-foreground">Ingresá tu PIN</label>
            <input value={pin} onChange={(e) => setPin(e.target.value)} placeholder="••••" maxLength={4} className={inputCls} />
            <button onClick={() => login.mutate()} disabled={pin.trim().length !== 4 || login.isPending} className={botonCls}>
              {login.isPending ? 'Ingresando...' : 'Ingresar'}
            </button>
          </div>
        )}

        {vista === 'crear-pin' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Todavía no tenés un PIN. Creá uno para poder canjear puntos y ver tu historial.</p>
            <label className="block text-xs font-medium text-muted-foreground">Elegí un PIN de 4 dígitos</label>
            <input value={pin} onChange={(e) => setPin(e.target.value)} placeholder="••••" maxLength={4} className={inputCls} />
            <label className="block text-xs font-medium text-muted-foreground">Tu email (para confirmar)</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo@ejemplo.com" className={inputCls} />
            <button onClick={() => solicitar.mutate()} disabled={pin.trim().length !== 4 || !email.trim() || solicitar.isPending} className={botonCls}>
              {solicitar.isPending ? 'Enviando...' : 'Crear PIN'}
            </button>
          </div>
        )}

        {vista === 'codigo' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Te mandamos un código a tu email. Ingresalo acá (vence en 10 minutos):</p>
            <input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Código de 6 dígitos" maxLength={6} className={inputCls} />
            <button onClick={() => confirmar.mutate()} disabled={codigo.trim().length !== 6 || confirmar.isPending} className={botonCls}>
              {confirmar.isPending ? 'Confirmando...' : 'Confirmar'}
            </button>
          </div>
        )}

        {vista === 'cambiar-pin' && (
          <div className="space-y-3">
            <label className="block text-xs font-medium text-muted-foreground">PIN actual</label>
            <input value={pinActual} onChange={(e) => setPinActual(e.target.value)} placeholder="••••" maxLength={4} className={inputCls} />
            <label className="block text-xs font-medium text-muted-foreground">PIN nuevo</label>
            <input value={pinNuevo} onChange={(e) => setPinNuevo(e.target.value)} placeholder="••••" maxLength={4} className={inputCls} />
            <button onClick={() => cambiar.mutate()} disabled={pinActual.trim().length !== 4 || pinNuevo.trim().length !== 4 || cambiar.isPending} className={botonCls}>
              {cambiar.isPending ? 'Guardando...' : 'Cambiar PIN'}
            </button>
          </div>
        )}

        {vista === 'historial' && (
          <div className="space-y-2">
            {historial.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Todavía no tenés pedidos.</p>
            ) : (
              historial.map((p) => (
                <div key={p.id} className="flex items-center justify-between text-sm border-b border-border pb-2">
                  <div>
                    <p className="text-foreground">{new Date(p.creado_en).toLocaleDateString('es-BO')}</p>
                    <p className="text-xs text-muted-foreground">{p.mesa?.nombre ?? p.tipo}</p>
                  </div>
                  <span className="font-medium text-foreground">{bs(p.total)}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Run the frontend build to catch syntax/type errors**

Run: `cd frontend && npm run build`
Expected: clean build, no errors.

- [ ] **Step 9: Manually verify in the browser**

Run: `cd backend && npm run dev` and `cd frontend && npm run dev` (if not already running). Open a mesa's autoservicio URL (`/m/:codigo` for a mesa with an open autoservicio session). Click the "Mi cuenta" icon, type a CI that has no PIN yet, create a PIN with a real email you can check, confirm the code arrives and the code screen accepts it, confirm you land back on "inicio" showing your name and 0 points. Add a product to the cart, confirm the CI-only field still works independently. If your test business has `fidelidad_canje_qr` enabled and the client has points (set some via Configuración → Clientes or a completed order), confirm the "Usar puntos" field appears in the cart once logged in.
Expected: full flow works end-to-end without console errors.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/store/clienteAutoservicioStore.js frontend/src/api/clientePublico.js frontend/src/api/configuracion.js frontend/src/api/autoservicio.js frontend/src/pages/autoservicio/AutoservicioPage.jsx
git commit -m "feat(fidelidad): UI de autoservicio para PIN, historial y canje de puntos"
```

---

## Final regression check

- [ ] Run: `cd backend && npm test`
  Expected: same pre-existing baseline failures as before this plan (35, per the session's established baseline), all new tests from Tasks 1–9 passing, no new failures.
- [ ] Run: `cd frontend && npm run build`
  Expected: clean build.
