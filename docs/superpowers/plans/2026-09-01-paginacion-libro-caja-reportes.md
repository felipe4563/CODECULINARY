# Paginación en Libro de Caja y Reportes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Paginar de verdad (LIMIT/OFFSET en SQL) los 5 listados que hoy traen el historial completo sin límite — Libro de Caja y los 4 reportes (Ventas, Compras, Inventario, Caja) — y mover a SQL los totales/filtros que hoy se calculan sumando arrays completos en el navegador.

**Architecture:** Cada endpoint de listado gana `pagina`/`limite` (con `limite=0` = sin límite, reservado para exportar PDF) y devuelve `{ filas, pagina, limite, total, total_paginas }` en vez de un array plano. Un endpoint `resumen` nuevo por módulo calcula totales y opciones de filtro con `SUM`/`COUNT`/`DISTINCT`. Los filtros que hoy se aplican en el navegador (tipo, cajero, método de pago, búsqueda, estado, origen) pasan a ser query params reales. En el frontend, un componente `<Paginacion>` reusable y el mismo patrón de dos `useQuery` (resumen + filas paginadas) se repite en los 6 componentes afectados.

**Tech Stack:** Node/Express/Sequelize (MariaDB), React/Vite, `@tanstack/react-query`.

**Spec:** `docs/superpowers/specs/2026-09-01-paginacion-libro-caja-reportes-design.md`

## Global Constraints

- Respuesta de todo endpoint de listado paginado: `{ ok: true, datos: { filas, pagina, limite, total, total_paginas } }`. `limite` default `20`, tope `100`, `limite=0` = sin límite (uso exclusivo del botón exportar).
- Respuesta de todo endpoint `resumen`: `{ ok: true, datos: { ...totales, filtros: { cajeros?, sucursales? } } }` — sin paginar, mismos filtros de fecha/tipo/etc. que el listado pero sin `pagina`/`limite`.
- El bloque `filtros.sucursales` solo se calcula/devuelve cuando `alcance.acceso_todas` es `true` (un usuario de una sola sucursal no necesita ese selector).
- Todo `where` construido a partir de query params del usuario respeta el patrón `alcance` existente: `{ sucursal_id, acceso_todas }` derivado de `req.usuario` en cada controller vía una función `_alcance(req)`.
- Cada función de servicio de reportes recibe `(filtros, alcance)` como dos argumentos separados — nunca un objeto combinado — para que un admin pueda filtrar por una sucursal puntual sin que se la pise el alcance.
- Frontend: no hay suite de tests de componentes en este proyecto — cada tarea de frontend se verifica con `npx eslint <archivo>` + `npm run build` (ambos desde `frontend/`) y, cuando se indique, una prueba manual concreta.
- Fixtures de tests de backend: usar `Date.now()` en emails/nombres únicos, nunca valores hardcodeados que puedan chocar entre corridas.

---

## Task 1: Componente `<Paginacion>` reusable (frontend)

**Files:**
- Create: `frontend/src/components/ui/Paginacion.jsx`

**Interfaces:**
- Produces: `export default function Paginacion({ pagina, totalPaginas, onCambiar })` — `pagina` (1-indexed), `totalPaginas` (entero ≥ 1), `onCambiar(nuevaPagina)`. No renderiza nada si `totalPaginas <= 1`.

- [ ] **Step 1: Crear el componente**

```jsx
// frontend/src/components/ui/Paginacion.jsx
import { ChevronLeft, ChevronRight } from 'lucide-react';

// Arma la lista de números de página a mostrar, con `null` como marcador
// de "..." — máximo 7 elementos visibles para que no se rompa en mobile.
function _paginasVisibles(pagina, totalPaginas) {
  if (totalPaginas <= 7) {
    return Array.from({ length: totalPaginas }, (_, i) => i + 1);
  }
  const set = new Set([1, totalPaginas, pagina, pagina - 1, pagina + 1]);
  const ordenadas = Array.from(set).filter(p => p >= 1 && p <= totalPaginas).sort((a, b) => a - b);
  const resultado = [];
  ordenadas.forEach((p, i) => {
    if (i > 0 && p - ordenadas[i - 1] > 1) resultado.push(null);
    resultado.push(p);
  });
  return resultado;
}

export default function Paginacion({ pagina, totalPaginas, onCambiar }) {
  if (!totalPaginas || totalPaginas <= 1) return null;
  const paginas = _paginasVisibles(pagina, totalPaginas);

  return (
    <div className="flex items-center justify-center gap-1 py-3">
      <button
        onClick={() => onCambiar(pagina - 1)}
        disabled={pagina <= 1}
        className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none"
        aria-label="Página anterior"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>

      {paginas.map((p, i) =>
        p === null ? (
          <span key={`ellipsis-${i}`} className="px-1.5 text-xs text-muted-foreground">…</span>
        ) : (
          <button
            key={p}
            onClick={() => onCambiar(p)}
            className={`min-w-[2rem] h-8 px-2 rounded-lg text-xs font-medium transition-colors ${
              p === pagina
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            }`}
          >
            {p}
          </button>
        )
      )}

      <button
        onClick={() => onCambiar(pagina + 1)}
        disabled={pagina >= totalPaginas}
        className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none"
        aria-label="Página siguiente"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verificar**

Run: `cd frontend && npx eslint src/components/ui/Paginacion.jsx`
Expected: sin salida (sin errores).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ui/Paginacion.jsx
git commit -m "feat(ui): componente Paginacion reusable"
```

---

## Task 2: Backend — Libro de Caja: paginación, resumen y filtros

**Files:**
- Modify: `backend/src/modules/libro_caja/libro_caja.service.js`
- Modify: `backend/src/modules/libro_caja/libro_caja.controller.js`
- Modify: `backend/src/modules/libro_caja/libro_caja.routes.js`
- Modify: `backend/tests/libro_caja.test.js`

**Interfaces:**
- Produces: `listar(filtros, alcance)` → `Promise<{ filas, pagina, limite, total, total_paginas }>`. `resumen(filtros, alcance)` → `Promise<{ total_ingresos, total_egresos, cantidad, filtros: { cajeros, sucursales? } }>`. Filtros nuevos aceptados por ambas: `tipo` (`'ingreso'|'egreso'`), `busqueda` (string). `listar` además acepta `pagina`, `limite`.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `backend/tests/libro_caja.test.js` (mismo `describe` existente de `GET /api/v1/libro-caja`, reutilizando el `login`/`token` de admin que ya arma el archivo):

```js
describe('paginación y resumen de libro-caja', () => {
  let idsCreados = [];

  beforeAll(async () => {
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
});
```

- [ ] **Step 2: Correr los tests para confirmar que fallan**

Run: `cd backend && npx jest tests/libro_caja.test.js -t "paginación y resumen" -v`
Expected: FAIL (el endpoint todavía no pagina, no existe `/resumen`, `res.body.datos` es un array).

- [ ] **Step 3: Reescribir `libro_caja.service.js`**

```js
// backend/src/modules/libro_caja/libro_caja.service.js
const { Op } = require('sequelize');
const { LibroCaja, SesionCaja, Usuario, Sucursal } = require('../../models');
const { emitir } = require('../../socket');

const INCLUDE_LB = [
  { model: SesionCaja, as: 'sesion_caja', attributes: ['id', 'estado', 'abierto_en'] },
  { model: Usuario, as: 'usuario', attributes: ['id', 'nombre'] },
];

const LIMITE_DEFAULT = 20;
const LIMITE_MAX = 100;

// Offset fijo de Bolivia: un datetime sin offset se parsea en la hora local
// del proceso de Node, que puede no coincidir con la del negocio (-04:00).
function _filtroFecha(desde, hasta) {
  if (!desde && !hasta) return {};
  const range = {};
  if (desde) range[Op.gte] = new Date(`${desde}T00:00:00-04:00`);
  if (hasta) range[Op.lte] = new Date(`${hasta}T23:59:59-04:00`);
  return { creado_en: range };
}

function _paginaLimite(filtros = {}) {
  const pagina = Math.max(parseInt(filtros.pagina, 10) || 1, 1);
  const limiteReq = filtros.limite === undefined ? LIMITE_DEFAULT : parseInt(filtros.limite, 10);
  const limite = limiteReq === 0 ? 0 : Math.min(Math.max(limiteReq || LIMITE_DEFAULT, 1), LIMITE_MAX);
  return { pagina, limite };
}

async function _verificarSesionEnAlcance(sesion_caja_id, alcance) {
  const sesion = await SesionCaja.findByPk(sesion_caja_id);
  if (!sesion) throw Object.assign(new Error('Sesión de caja no encontrada'), { status: 404 });
  if (alcance && !alcance.acceso_todas && sesion.sucursal_id !== alcance.sucursal_id) {
    throw Object.assign(new Error('Sesión de caja no encontrada'), { status: 404 });
  }
  return sesion;
}

async function _sesionIdsSucursal(sucursal_id) {
  const sesiones = await SesionCaja.findAll({ where: { sucursal_id }, attributes: ['id'] });
  return sesiones.map((s) => s.id);
}

// Arma el `where` compartido por listar() y resumen(). `sesion_caja_id`
// (cuando viene) reemplaza el filtro por alcance — ver comentario histórico
// más abajo sobre por qué el alcance se aplica con OR y no con un include.
async function _construirWhere(filtros, alcance) {
  const { sesion_caja_id, desde, hasta, tipo, busqueda } = filtros;
  const where = { ..._filtroFecha(desde, hasta) };
  if (tipo) where.tipo = tipo;

  if (sesion_caja_id) {
    where.sesion_caja_id = sesion_caja_id;
  } else {
    const condiciones = [];
    if (alcance && !alcance.acceso_todas) {
      // Filtrar por sucursal vía un `where` en el include de sesion_caja lo
      // convertiría en INNER JOIN, ocultando los movimientos sin sesión
      // (sesion_caja_id null, ej. compras recibidas o gastos "sin sesión").
      // En vez de eso, se arma la lista de sesiones de la sucursal y se
      // filtra a nivel de libro_caja con OR, dejando pasar también los sin
      // sesión.
      const sesionIds = await _sesionIdsSucursal(alcance.sucursal_id);
      condiciones.push({ [Op.or]: [{ sesion_caja_id: null }, { sesion_caja_id: { [Op.in]: sesionIds } }] });
    }
    if (busqueda) {
      const like = { [Op.like]: `%${busqueda}%` };
      condiciones.push({ [Op.or]: [{ concepto: like }, { metodo_pago: like }, { '$usuario.nombre$': like }] });
    }
    if (condiciones.length) where[Op.and] = condiciones;
  }

  return where;
}

async function listar(filtros = {}, alcance) {
  if (filtros.sesion_caja_id) await _verificarSesionEnAlcance(filtros.sesion_caja_id, alcance);
  const where = await _construirWhere(filtros, alcance);
  const { pagina, limite } = _paginaLimite(filtros);

  const { rows, count } = await LibroCaja.findAndCountAll({
    where,
    include: INCLUDE_LB,
    order: [['creado_en', 'DESC']],
    // La condición `$usuario.nombre$` de la búsqueda necesita el JOIN
    // resuelto en la MISMA consulta que aplica el LIMIT — el modo
    // subQuery automático de Sequelize (activo por defecto cuando hay
    // `limit` + includes) rompe esa referencia porque arma primero un
    // SELECT id ... LIMIT sin los joins.
    subQuery: false,
    distinct: true,
    ...(limite ? { limit: limite, offset: (pagina - 1) * limite } : {}),
  });

  return { filas: rows, pagina, limite, total: count, total_paginas: limite ? Math.ceil(count / limite) : 1 };
}

async function resumen(filtros = {}, alcance) {
  const where = await _construirWhere(filtros, alcance);
  const includeUsuario = [{ model: Usuario, as: 'usuario', attributes: [] }];

  const [totalIngresos, totalEgresos, cantidad, cajerosRaw] = await Promise.all([
    LibroCaja.sum('monto', { where: { ...where, tipo: 'ingreso' }, include: includeUsuario }),
    LibroCaja.sum('monto', { where: { ...where, tipo: 'egreso' }, include: includeUsuario }),
    LibroCaja.count({ where, include: includeUsuario, distinct: true, col: 'id' }),
    LibroCaja.findAll({
      where,
      include: [{ model: Usuario, as: 'usuario', attributes: ['id', 'nombre'] }],
      attributes: [],
      group: ['usuario.id', 'usuario.nombre'],
      raw: true,
    }),
  ]);

  const cajeros = cajerosRaw
    .map((f) => ({ id: f['usuario.id'], nombre: f['usuario.nombre'] }))
    .filter((c) => c.id != null);

  const filtrosResp = { cajeros };
  if (alcance && alcance.acceso_todas) {
    const sucursalesRaw = await LibroCaja.findAll({
      where,
      include: [{
        model: SesionCaja, as: 'sesion_caja', attributes: [], required: true,
        include: [{ model: Sucursal, as: 'sucursal', attributes: ['id', 'nombre'] }],
      }],
      attributes: [],
      group: ['sesion_caja.sucursal.id', 'sesion_caja.sucursal.nombre'],
      raw: true,
    });
    filtrosResp.sucursales = sucursalesRaw
      .map((f) => ({ id: f['sesion_caja.sucursal.id'], nombre: f['sesion_caja.sucursal.nombre'] }))
      .filter((s) => s.id != null);
  }

  return {
    total_ingresos: parseFloat(totalIngresos || 0),
    total_egresos: parseFloat(totalEgresos || 0),
    cantidad: cantidad || 0,
    filtros: filtrosResp,
  };
}

// `sesion_caja_id` es opcional: el libro de caja también sirve para anotar
// gastos/ingresos fuera de una sesión de caja abierta (ej. fuera de horario
// de atención) — no todo movimiento de plata pasa necesariamente por una
// caja registradora activa.
async function crear(usuario_id, { sesion_caja_id, tipo, concepto, monto, metodo_pago = 'efectivo' }, alcance) {
  if (!['ingreso', 'egreso'].includes(tipo)) throw Object.assign(new Error('tipo debe ser ingreso o egreso'), { status: 400 });
  if (sesion_caja_id) await _verificarSesionEnAlcance(sesion_caja_id, alcance);
  const entrada = await LibroCaja.create({ sesion_caja_id: sesion_caja_id || null, usuario_id, tipo, concepto, monto, metodo_pago });

  // El cierre de caja calcula "esperado en caja" restando sesion.total_gastos
  // (no sumando egresos del libro en vivo), así que un egreso en efectivo
  // cargado acá tiene que reflejarse ahí también — si no, el arqueo del
  // cierre no cuadra con el efectivo real que salió de la caja. Sin sesión
  // no hay nada que reconciliar (no afecta ningún arqueo).
  if (sesion_caja_id && tipo === 'egreso' && metodo_pago === 'efectivo') {
    await SesionCaja.increment('total_gastos', { by: parseFloat(monto), where: { id: sesion_caja_id } });
  }

  // Avisa a pantallas abiertas (ej. Dashboard) para que refresquen sin
  // esperar al polling — mismo patrón que ventas.service.js usa para ventas.
  emitir('restaurante:actualizar', { tipo: 'gasto_nuevo' }, alcance?.sucursal_id);

  return entrada;
}

module.exports = { listar, resumen, crear };
```

- [ ] **Step 4: Actualizar `libro_caja.controller.js` y `libro_caja.routes.js`**

```js
// backend/src/modules/libro_caja/libro_caja.controller.js
const svc = require('./libro_caja.service');

function _alcance(req) {
  return { sucursal_id: req.usuario.sucursal_id, acceso_todas: req.usuario.acceso_todas };
}

async function listar(req, res, next) {
  try { res.json({ ok: true, datos: await svc.listar(req.query, _alcance(req)) }); }
  catch (err) { next(err); }
}

async function resumen(req, res, next) {
  try { res.json({ ok: true, datos: await svc.resumen(req.query, _alcance(req)) }); }
  catch (err) { next(err); }
}

async function crear(req, res, next) {
  try {
    const { tipo, concepto, monto } = req.body;
    if (!tipo || !concepto || monto === undefined) {
      return res.status(400).json({ ok: false, mensaje: 'tipo, concepto y monto son requeridos' });
    }
    res.status(201).json({ ok: true, datos: await svc.crear(req.usuario.id, req.body, _alcance(req)) });
  } catch (err) { next(err); }
}

module.exports = { listar, resumen, crear };
```

```js
// backend/src/modules/libro_caja/libro_caja.routes.js
const { Router } = require('express');
const ctrl = require('./libro_caja.controller');
const auth = require('../../middlewares/auth');
const { verificarPermiso } = require('../../middlewares/permisos');

const router = Router();
router.use(auth);

router.get('/resumen', verificarPermiso('libro_caja', 'ver'), ctrl.resumen);
router.get('/', verificarPermiso('libro_caja', 'ver'), ctrl.listar);
router.post('/', verificarPermiso('libro_caja', 'crear'), ctrl.crear);

module.exports = router;
```

(La ruta `/resumen` va **antes** que `/` — no colisionan porque son rutas distintas, pero mantenerla primero es más claro de leer.)

- [ ] **Step 5: Correr los tests**

Run: `cd backend && npx jest tests/libro_caja.test.js -v`
Expected: PASS (todos, incluidos los preexistentes — la forma de la respuesta cambió de array a objeto, así que si algún test viejo asumía `res.body.datos` como array hay que ajustarlo a `res.body.datos.filas`).

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/libro_caja/ backend/tests/libro_caja.test.js
git commit -m "feat(libro-caja): paginacion, resumen y filtros server-side"
```

---

## Task 3: Frontend — Libro de Caja (`LibroCajaPage.jsx` + widget de Dashboard)

**Files:**
- Modify: `frontend/src/api/libroCaja.js`
- Modify: `frontend/src/pages/libro-caja/LibroCajaPage.jsx`
- Modify: `frontend/src/pages/Dashboard.jsx`

**Interfaces:**
- Consumes: `Paginacion` de `frontend/src/components/ui/Paginacion.jsx` (Task 1). Respuesta de `GET /libro-caja` y `GET /libro-caja/resumen` según Task 2.
- Produces: `getLibroCaja(params)` → `Promise<{ filas, pagina, limite, total, total_paginas }>`. `getResumenLibroCaja(params)` → `Promise<{ total_ingresos, total_egresos, cantidad, filtros }>`.

- [ ] **Step 1: `frontend/src/api/libroCaja.js`**

```js
import api from './cliente';

export const getLibroCaja = (params = {}) =>
  api.get('/libro-caja', { params }).then(r => r.data.datos);

export const getResumenLibroCaja = (params = {}) =>
  api.get('/libro-caja/resumen', { params }).then(r => r.data.datos);

export const crearMovimiento = (datos) =>
  api.post('/libro-caja', datos).then(r => r.data.datos);
```

- [ ] **Step 2: `LibroCajaPage.jsx` — reemplazar el bloque de datos/filtros**

El archivo importa `useState, useMemo` (línea 1) — agregar `getResumenLibroCaja` al import de la API y `Paginacion`:

```js
import { getLibroCaja, getResumenLibroCaja, crearMovimiento } from '../../api/libroCaja';
import Paginacion from '../../components/ui/Paginacion';
```

Reemplazar el bloque de estado y las queries (líneas 274–339 del archivo actual: desde `const [buscar, ...]` hasta el cierre de `totalEgresos`) por:

```js
  const [buscar,    setBuscar]    = useState('');
  const [buscarDebounced, setBuscarDebounced] = useState('');
  const [filtroTipo, setFiltroTipo] = useState('todos');   // todos | ingreso | egreso
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [pagina, setPagina] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [toast,     setToast]     = useState(null);

  // Debounce simple del buscador — evita un fetch por tecla.
  useEffect(() => {
    const t = setTimeout(() => setBuscarDebounced(buscar), 400);
    return () => clearTimeout(t);
  }, [buscar]);

  const filtrosApi = {
    desde: desde || undefined,
    hasta: hasta || undefined,
    tipo: filtroTipo === 'todos' ? undefined : filtroTipo,
    busqueda: buscarDebounced || undefined,
  };

  // Cambiar cualquier filtro vuelve a la página 1 — si no, se puede quedar
  // en "página 8 de 2" tras estrechar el filtro.
  useEffect(() => { setPagina(1); }, [filtroTipo, desde, hasta, buscarDebounced]);

  const { data: pagina_datos, isLoading } = useQuery({
    queryKey: ['libro-caja', filtrosApi, pagina],
    queryFn: () => getLibroCaja({ ...filtrosApi, pagina }),
  });
  const movimientos = pagina_datos?.filas ?? [];
  const totalPaginas = pagina_datos?.total_paginas ?? 1;

  const { data: resumen } = useQuery({
    queryKey: ['libro-caja-resumen', filtrosApi],
    queryFn: () => getResumenLibroCaja(filtrosApi),
  });

  const { data: cajas = [] } = useQuery({
    queryKey: ['cajas-estado-libro'],
    queryFn: () => getEstadoCajas(),
  });

  const { data: sesiones = [] } = useQuery({
    queryKey: ['sesiones-libro'],
    queryFn: getSesiones,
  });

  const totalIngresos = resumen?.total_ingresos ?? 0;
  const totalEgresos  = resumen?.total_egresos  ?? 0;
```

Agregar `useEffect` al import de React en la línea 1 (queda `import { useState, useEffect } from 'react';` — ya no hace falta `useMemo` acá si no se usa en otro lado del archivo; si el linter marca `useMemo` como no usado en algún otro punto, dejarlo solo si sigue en uso, sacarlo si no).

Todas las referencias a `filtrados` en el resto del archivo (contador "N registros", el estado vacío, el `.map()` de las tarjetas mobile y de la tabla desktop, y el pie "Totales (N registros)") pasan a usar `movimientos` en vez de `filtrados` (ya no hay filtrado client-side — el array que llega ya viene filtrado y paginado del backend). Agregar `<Paginacion pagina={pagina} totalPaginas={totalPaginas} onCambiar={setPagina} />` inmediatamente después del cierre del bloque que renderiza la tabla/tarjetas (antes del pie de totales, o después — visualmente donde quede mejor, pero siempre dentro del contenedor de la lista, no dentro del `<table>`).

- [ ] **Step 3: Arreglar el widget de Libro de Caja en `Dashboard.jsx`**

`Dashboard.jsx` línea 214-220 hoy pide `getLibroCaja` **sin ningún filtro de fecha** (todo el historial) y filtra egresos del período elegido (día/mes/año) en el navegador — con la respuesta paginada esto además dejaría de traer todo. Acotar el pedido al período elegido y pedir `limite=0` (esa consulta ya es angosta por fecha, no hace falta paginarla) en vez de usar la página por defecto:

```js
  // Rango de fechas ISO que cubre el período elegido en el selector
  // día/mes/año — mismo criterio que ya usan los reportes.
  const rangoLibroCaja = useMemo(() => {
    if (tipo === 'dia') return { desde: diaVal, hasta: diaVal };
    if (tipo === 'mes') {
      const [y, m] = mesVal.split('-').map(Number);
      const ultimoDia = new Date(y, m, 0).getDate();
      return { desde: `${mesVal}-01`, hasta: `${mesVal}-${String(ultimoDia).padStart(2, '0')}` };
    }
    return { desde: `${añoVal}-01-01`, hasta: `${añoVal}-12-31` };
  }, [tipo, diaVal, mesVal, añoVal]);

  const { data: movimientosCajaResp, isLoading: cvGastos } = useQuery({
    queryKey: ['libro-caja-dashboard', rangoLibroCaja],
    queryFn: () => getLibroCaja({ ...rangoLibroCaja, tipo: 'egreso', limite: 0 }),
    enabled: puedeVerGastos,
    refetchInterval: 5 * 60_000,
    staleTime: 30_000,
  });
  const movimientosCaja = movimientosCajaResp?.filas ?? [];
```

Con esto el filtro `tipo: 'egreso'` ya lo aplica el backend, así que el `egresosFiltrados` más abajo (línea ~270) ya no necesita el `if (m.tipo !== 'egreso') return false;` — se puede dejar así igual (es inofensivo, sigue siendo `true` siempre) o simplificarlo; dejarlo tal cual es la opción de menor riesgo, no es necesario tocar esa parte.

- [ ] **Step 4: Verificar**

Run: `cd frontend && npx eslint src/pages/libro-caja/LibroCajaPage.jsx src/pages/Dashboard.jsx src/api/libroCaja.js && npm run build`
Expected: sin errores de lint, build exitoso.

Prueba manual: levantar backend+frontend, entrar a Libro de Caja, crear más de 20 movimientos (o bajar el límite manualmente en la URL de red para probar), confirmar que aparece la paginación y que cambiar de página no reinicia el filtro de fecha/tipo/búsqueda. Confirmar que el Dashboard sigue mostrando el total de egresos del día/mes/año correctamente.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/libroCaja.js frontend/src/pages/libro-caja/LibroCajaPage.jsx frontend/src/pages/Dashboard.jsx
git commit -m "feat(libro-caja): consumir paginacion y resumen en el frontend"
```

---

## Task 4: Backend — corrección de alcance en reportes (controller + service)

Prerrequisito para las Tasks 5, 11, 13, 15 — sin esto ningún filtro `sucursal_id` elegido por un admin llega nunca al servicio. **Importante:** esta task tiene que dejar el controller y el service consistentes entre sí — el controller ya llama a cada función de servicio con `(filtros, alcance)` como dos argumentos separados, así que las 4 funciones existentes en `reportes.service.js` (`ventas`, `inventario`, `compras`, `caja`) tienen que aceptar esa misma firma en el mismo commit, si no el filtro por sucursal queda roto para todos (no solo para el admin) hasta que corran las tasks siguientes. Las Tasks 5/11/13/15 más adelante van a **reemplazar por completo** estas 4 funciones (agregándoles paginación) — lo que se escribe acá es la versión mínima, ya correcta, que dejan de base.

**Files:**
- Modify: `backend/src/modules/reportes/reportes.controller.js`
- Modify: `backend/src/modules/reportes/reportes.service.js`
- Modify: `backend/tests/reportes.test.js`

**Interfaces:**
- Produces: cada handler pasa `(req.query, _alcance(req))` como dos argumentos a su función de servicio — a partir de ahora `svc.ventas(filtros, alcance)`, `svc.inventario(filtros, alcance)`, `svc.compras(filtros, alcance)`, `svc.caja(filtros, alcance)` (ya no `{ ...req.query, ..._alcance(req) }` combinado). Cada función de servicio: si `!alcance.acceso_todas` fuerza `alcance.sucursal_id`; si `alcance.acceso_todas` y viene `filtros.sucursal_id`, filtra por esa; si no viene ninguna, trae todas las sucursales.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `backend/tests/reportes.test.js` (necesita un usuario admin con `acceso_todas: true` y datos en al menos dos sucursales distintas — revisar qué fixtures de sucursal ya arma el archivo antes de escribir esto; usar esas mismas sucursales/usuarios en vez de crear nuevas si ya existen):

```js
describe('alcance por sucursal en /api/v1/reportes/*', () => {
  test('un admin filtrando por sucursal_id en ventas recibe solo esa sucursal', async () => {
    // Requiere que existan pedidos completados en al menos dos sucursales
    // distintas dentro de los fixtures del archivo — si el archivo no las
    // tiene todavía, agregar el fixture mínimo (una sucursal + un pedido
    // completado en ella) antes de este test.
    const res = await request(app)
      .get(`/api/v1/reportes/ventas?sucursal_id=${sucursalBId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    const filas = Array.isArray(res.body.datos) ? res.body.datos : res.body.datos.filas;
    expect(filas.every(f => f.sucursal_id === sucursalBId || f.sucursal?.id === sucursalBId)).toBe(true);
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
```

- [ ] **Step 2: Correr el test para confirmar que falla**

Run: `cd backend && npx jest tests/reportes.test.js -t "alcance por sucursal" -v`
Expected: FAIL — hoy el filtro `sucursal_id` que manda el admin nunca llega al service (se lo pisa `_alcance(req)`), así que el primer test trae de todas las sucursales, no solo la B.

- [ ] **Step 3: Reescribir el controller**

```js
// backend/src/modules/reportes/reportes.controller.js
const svc = require('./reportes.service');

function _alcance(req) {
  return { sucursal_id: req.usuario.sucursal_id, acceso_todas: req.usuario.acceso_todas };
}

async function getVentas(req, res, next) {
  try { res.json({ ok: true, datos: await svc.ventas(req.query, _alcance(req)) }); } catch (e) { next(e); }
}

async function getVentasResumen(req, res, next) {
  try { res.json({ ok: true, datos: await svc.ventasResumen(req.query, _alcance(req)) }); } catch (e) { next(e); }
}

async function getVentasProductos(req, res, next) {
  try { res.json({ ok: true, datos: await svc.ventasProductos(req.query, _alcance(req)) }); } catch (e) { next(e); }
}

async function getVentasVariantes(req, res, next) {
  try { res.json({ ok: true, datos: await svc.ventasVariantes(req.query, _alcance(req)) }); } catch (e) { next(e); }
}

async function getInventario(req, res, next) {
  try { res.json({ ok: true, datos: await svc.inventario(req.query, _alcance(req)) }); } catch (e) { next(e); }
}

async function getInventarioResumen(req, res, next) {
  try { res.json({ ok: true, datos: await svc.inventarioResumen(req.query, _alcance(req)) }); } catch (e) { next(e); }
}

async function getCompras(req, res, next) {
  try { res.json({ ok: true, datos: await svc.compras(req.query, _alcance(req)) }); } catch (e) { next(e); }
}

async function getComprasResumen(req, res, next) {
  try { res.json({ ok: true, datos: await svc.comprasResumen(req.query, _alcance(req)) }); } catch (e) { next(e); }
}

async function getCaja(req, res, next) {
  try { res.json({ ok: true, datos: await svc.caja(req.query, _alcance(req)) }); } catch (e) { next(e); }
}

async function getCajaResumen(req, res, next) {
  try { res.json({ ok: true, datos: await svc.cajaResumen(req.query, _alcance(req)) }); } catch (e) { next(e); }
}

module.exports = {
  getVentas, getVentasResumen, getVentasProductos, getVentasVariantes,
  getInventario, getInventarioResumen,
  getCompras, getComprasResumen,
  getCaja, getCajaResumen,
};
```

Los handlers `*Resumen`/`getVentasProductos`/`getVentasVariantes` llaman funciones que todavía no existen en `reportes.service.js` — se agregan en las Tasks 5, 11, 13, 15. Node no valida en el `require` que esas propiedades existan (solo se rompería si se llegaran a invocar), así que el archivo carga bien igual. Las funciones `ventas`, `inventario`, `compras`, `caja` sí existen y **se actualizan en el Step 4** para no dejar roto el filtro de sucursal mientras tanto.

- [ ] **Step 4: Actualizar la firma y el filtro de sucursal en `reportes.service.js`**

Reemplazar las 4 funciones existentes (mismo `include`/lógica de cada una, solo cambia de dónde sale `sucursal_id`):

```js
async function ventas(filtros = {}, alcance = {}) {
  const { desde, hasta } = filtros;
  const where = { estado: 'completado', ...filtroFecha(desde, hasta) };
  if (!alcance.acceso_todas) where.sucursal_id = alcance.sucursal_id;
  else if (filtros.sucursal_id) where.sucursal_id = filtros.sucursal_id;
  return Pedido.findAll({
    where,
    include: [
      { model: Mesa,    as: 'mesa',    attributes: ['id', 'nombre'] },
      { model: Cliente, as: 'cliente', attributes: ['id', 'nombre'] },
      { model: Usuario, as: 'usuario', attributes: ['id', 'nombre'] },
      INCLUDE_SUCURSAL,
      {
        model: DetallePedido, as: 'detalles',
        include: [
          { model: Producto, as: 'producto', attributes: ['id', 'nombre'] },
          { model: Combo, as: 'combo', attributes: ['id', 'nombre'] },
          {
            model: Opcion, as: 'opciones', attributes: ['id', 'nombre'], through: { attributes: [] },
            include: [{ model: GrupoOpciones, as: 'grupo', attributes: ['id', 'nombre'] }],
          },
        ],
      },
    ],
    order: [['creado_en', 'DESC']],
  });
}

async function inventario(filtros = {}, alcance = {}) {
  const { desde, hasta } = filtros;
  const where = filtroFecha(desde, hasta);
  if (!alcance.acceso_todas) where.sucursal_id = alcance.sucursal_id;
  else if (filtros.sucursal_id) where.sucursal_id = filtros.sucursal_id;
  return RegistroInventario.findAll({
    where,
    include: [
      { model: Producto, as: 'producto', attributes: ['id', 'nombre', 'stock'] },
      { model: Usuario,  as: 'usuario',  attributes: ['id', 'nombre'] },
      INCLUDE_SUCURSAL,
    ],
    order: [['creado_en', 'DESC']],
  });
}

async function compras(filtros = {}, alcance = {}) {
  const { desde, hasta } = filtros;
  const where = filtroFecha(desde, hasta);
  if (!alcance.acceso_todas) where.sucursal_id = alcance.sucursal_id;
  else if (filtros.sucursal_id) where.sucursal_id = filtros.sucursal_id;
  return Compra.findAll({
    where,
    include: [
      { model: Proveedor, as: 'proveedor', attributes: ['id', 'nombre'] },
      { model: Usuario,   as: 'usuario',   attributes: ['id', 'nombre'] },
      INCLUDE_SUCURSAL,
    ],
    order: [['creado_en', 'DESC']],
  });
}

async function caja(filtros = {}, alcance = {}) {
  const { desde, hasta } = filtros;
  const includeSesion = {
    model: SesionCaja,
    as: 'sesion_caja',
    attributes: ['id'],
    include: [INCLUDE_SUCURSAL],
  };
  if (!alcance.acceso_todas) includeSesion.where = { sucursal_id: alcance.sucursal_id };
  else if (filtros.sucursal_id) includeSesion.where = { sucursal_id: filtros.sucursal_id };

  const registros = await LibroCaja.findAll({
    where: filtroFecha(desde, hasta),
    include: [
      { model: Usuario, as: 'usuario', attributes: ['id', 'nombre'] },
      includeSesion,
    ],
    order: [['creado_en', 'DESC']],
  });

  return registros.map(r => {
    const plano = r.toJSON();
    plano.sucursal = plano.sesion_caja?.sucursal ?? null;
    delete plano.sesion_caja;
    return plano;
  });
}

module.exports = { ventas, inventario, compras, caja };
```

(El `module.exports` queda igual que antes — Tasks 5, 6, 7, 11, 13, 15 le van sumando entradas a medida que agregan `ventasResumen`, `ventasProductos`, etc.)

- [ ] **Step 5: Correr el test**

Run: `cd backend && npx jest tests/reportes.test.js -t "alcance por sucursal" -v`
Expected: PASS.

- [ ] **Step 6: Correr toda la suite de reportes para confirmar que no se rompió nada existente**

Run: `cd backend && npx jest tests/reportes.test.js -v`
Expected: PASS (todos).

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/reportes/reportes.controller.js backend/src/modules/reportes/reportes.service.js backend/tests/reportes.test.js
git commit -m "fix(reportes): separar alcance de filtros de query para permitir filtrar por sucursal"
```

---

## Task 5: Backend — Reportes → Ventas: paginación, resumen y filtros

**Files:**
- Modify: `backend/src/modules/reportes/reportes.service.js`
- Modify: `backend/src/modules/reportes/reportes.routes.js`
- Modify: `backend/tests/reportes.test.js`

**Interfaces:**
- Consumes: `_alcance(req)` de Task 4 (ya pasa `filtros, alcance` como argumentos separados).
- Produces: `ventas(filtros, alcance)` → `Promise<{ filas, pagina, limite, total, total_paginas }>`. `ventasResumen(filtros, alcance)` → `Promise<{ total_ventas, ventas_efectivo, ventas_qr, cantidad, filtros: { cajeros, sucursales? } }>`. Filtros nuevos: `usuario_id`, `metodo_pago`, `tipo` (mesa/llevar), `origen` (staff/autoservicio), además de `pagina`/`limite`.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `backend/tests/reportes.test.js` (reutilizar el patrón de login/fixtures que ya use ese archivo — revisar el inicio del archivo para el `token`/`app` disponibles antes de escribir estos tests):

```js
describe('GET /api/v1/reportes/ventas — paginación, resumen y filtros', () => {
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
```

- [ ] **Step 2: Correr los tests para confirmar que fallan**

Run: `cd backend && npx jest tests/reportes.test.js -t "paginación, resumen y filtros" -v`
Expected: FAIL — `/reportes/ventas/resumen` no existe todavía, `res.body.datos` sigue siendo un array plano.

- [ ] **Step 3: Agregar a `reportes.service.js`**

El archivo ya tiene `filtroFecha`, `INCLUDE_SUCURSAL` y la función `ventas()` actual (a reemplazar) al principio. Reemplazar la función `ventas()` existente y agregar `ventasResumen`:

```js
const LIMITE_DEFAULT = 20;
const LIMITE_MAX = 100;

function _paginaLimite(filtros = {}) {
  const pagina = Math.max(parseInt(filtros.pagina, 10) || 1, 1);
  const limiteReq = filtros.limite === undefined ? LIMITE_DEFAULT : parseInt(filtros.limite, 10);
  const limite = limiteReq === 0 ? 0 : Math.min(Math.max(limiteReq || LIMITE_DEFAULT, 1), LIMITE_MAX);
  return { pagina, limite };
}

function _whereVentas(filtros, alcance) {
  const { desde, hasta, usuario_id, metodo_pago, tipo, origen } = filtros;
  const where = { estado: 'completado', ...filtroFecha(desde, hasta) };
  if (!alcance.acceso_todas) where.sucursal_id = alcance.sucursal_id;
  else if (filtros.sucursal_id) where.sucursal_id = filtros.sucursal_id;
  if (usuario_id) where.usuario_id = usuario_id;
  if (metodo_pago) where.metodo_pago = metodo_pago;
  if (tipo) where.tipo = tipo;
  if (origen) where.origen = origen;
  return where;
}

async function ventas(filtros = {}, alcance) {
  const where = _whereVentas(filtros, alcance);
  const { pagina, limite } = _paginaLimite(filtros);

  const { rows, count } = await Pedido.findAndCountAll({
    where,
    include: [
      { model: Mesa,    as: 'mesa',    attributes: ['id', 'nombre'] },
      { model: Cliente, as: 'cliente', attributes: ['id', 'nombre'] },
      { model: Usuario, as: 'usuario', attributes: ['id', 'nombre'] },
      INCLUDE_SUCURSAL,
      {
        model: DetallePedido, as: 'detalles',
        include: [
          { model: Producto, as: 'producto', attributes: ['id', 'nombre'] },
          { model: Combo, as: 'combo', attributes: ['id', 'nombre'] },
          {
            model: Opcion, as: 'opciones', attributes: ['id', 'nombre'], through: { attributes: [] },
            include: [{ model: GrupoOpciones, as: 'grupo', attributes: ['id', 'nombre'] }],
          },
        ],
      },
    ],
    order: [['creado_en', 'DESC']],
    distinct: true,
    ...(limite ? { limit: limite, offset: (pagina - 1) * limite } : {}),
  });

  return { filas: rows, pagina, limite, total: count, total_paginas: limite ? Math.ceil(count / limite) : 1 };
}

async function ventasResumen(filtros = {}, alcance) {
  const where = _whereVentas(filtros, alcance);

  const [totalVentas, ventasEfectivo, ventasQR, cantidad, cajerosRaw] = await Promise.all([
    Pedido.sum('total', { where }),
    Pedido.sum('total', { where: { ...where, metodo_pago: 'efectivo' } }),
    Pedido.sum('total', { where: { ...where, metodo_pago: 'qr' } }),
    Pedido.count({ where }),
    Pedido.findAll({
      where,
      include: [{ model: Usuario, as: 'usuario', attributes: ['id', 'nombre'] }],
      attributes: [],
      group: ['usuario.id', 'usuario.nombre'],
      raw: true,
    }),
  ]);

  const cajeros = cajerosRaw
    .map((f) => ({ id: f['usuario.id'], nombre: f['usuario.nombre'] }))
    .filter((c) => c.id != null);

  const filtrosResp = { cajeros };
  if (alcance.acceso_todas) {
    const sucursalesRaw = await Pedido.findAll({
      where, include: [INCLUDE_SUCURSAL], attributes: [],
      group: ['sucursal.id', 'sucursal.nombre'], raw: true,
    });
    filtrosResp.sucursales = sucursalesRaw
      .map((f) => ({ id: f['sucursal.id'], nombre: f['sucursal.nombre'] }))
      .filter((s) => s.id != null);
  }

  return {
    total_ventas: parseFloat(totalVentas || 0),
    ventas_efectivo: parseFloat(ventasEfectivo || 0),
    ventas_qr: parseFloat(ventasQR || 0),
    cantidad: cantidad || 0,
    filtros: filtrosResp,
  };
}
```

Al final del archivo, agregar `ventasResumen` (y, dejadas listas para las Tasks 6/7, no implementadas acá) al `module.exports` — por ahora solo agregar `ventasResumen`:

```js
module.exports = { ventas, ventasResumen, inventario, compras, caja };
```
(Las Tasks 6, 7, 11, 13, 15 vuelven a tocar esta línea de exports — está bien, cada task la deja consistente con lo que ya agregó.)

- [ ] **Step 4: Rutas**

`backend/src/modules/reportes/reportes.routes.js` — agregar la ruta de resumen **antes** de la ruta base de ventas (mismo motivo que en Task 2: legibilidad, no hay colisión real):

```js
router.get('/ventas/resumen', verificarPermiso('reportes', 'ver'), ctrl.getVentasResumen);
router.get('/ventas',         verificarPermiso('reportes', 'ver'), ctrl.getVentas);
router.get('/inventario',     verificarPermiso('reportes', 'ver'), ctrl.getInventario);
router.get('/compras',        verificarPermiso('reportes', 'ver'), ctrl.getCompras);
router.get('/caja',           verificarPermiso('reportes', 'ver'), ctrl.getCaja);
```

- [ ] **Step 5: Correr los tests**

Run: `cd backend && npx jest tests/reportes.test.js -v`
Expected: PASS. Si algún test preexistente de `/reportes/ventas` asumía `res.body.datos` como array, ajustarlo a `res.body.datos.filas`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/reportes/reportes.service.js backend/src/modules/reportes/reportes.routes.js backend/tests/reportes.test.js
git commit -m "feat(reportes): paginacion, resumen y filtros server-side para ventas"
```

---

## Task 6: Backend — Reportes → Ventas: ranking de productos (SQL)

**Files:**
- Modify: `backend/src/modules/reportes/reportes.service.js`
- Modify: `backend/src/modules/reportes/reportes.controller.js` (ya tiene `getVentasProductos` desde Task 4 — sin cambios acá)
- Modify: `backend/src/modules/reportes/reportes.routes.js`
- Modify: `backend/tests/reportes.test.js`

**Interfaces:**
- Consumes: `_whereVentas(filtros, alcance)` de Task 5.
- Produces: `ventasProductos(filtros, alcance)` → `Promise<Array<{ id, tipo: 'producto'|'combo', nombre, cantidad, monto }>>`, ordenado por `cantidad` descendente. Sin paginar (es un ranking, no una lista de filas — el tamaño lo limita el catálogo de productos, no el historial de ventas).

- [ ] **Step 1: Escribir el test que falla**

```js
describe('GET /api/v1/reportes/ventas/productos', () => {
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
});
```

- [ ] **Step 2: Correr el test para confirmar que falla**

Run: `cd backend && npx jest tests/reportes.test.js -t "ranking agrupado por producto" -v`
Expected: FAIL — 404, la ruta no existe.

- [ ] **Step 3: Agregar `ventasProductos` a `reportes.service.js`**

```js
async function ventasProductos(filtros = {}, alcance) {
  const where = _whereVentas(filtros, alcance);

  const filas = await DetallePedido.findAll({
    include: [
      { model: Pedido, attributes: [], where, required: true },
      { model: Producto, as: 'producto', attributes: ['nombre'], required: false },
      { model: Combo, as: 'combo', attributes: ['nombre'], required: false },
    ],
    attributes: [
      'producto_id',
      'combo_id',
      [fn('SUM', col('DetallePedido.cantidad')), 'cantidad'],
      [fn('SUM', literal('`DetallePedido`.`cantidad` * `DetallePedido`.`precio`')), 'monto'],
    ],
    group: ['DetallePedido.producto_id', 'DetallePedido.combo_id', 'producto.nombre', 'combo.nombre'],
    order: [[literal('cantidad'), 'DESC']],
    raw: true,
  });

  return filas.map((f) => ({
    id: f.producto_id ?? f.combo_id,
    tipo: f.producto_id ? 'producto' : 'combo',
    nombre: f['producto.nombre'] ?? f['combo.nombre'] ?? '(eliminado)',
    cantidad: parseFloat(f.cantidad || 0),
    monto: parseFloat(f.monto || 0),
  }));
}
```

Al principio del archivo, agregar `fn, col, literal` al import de `sequelize`:

```js
const { Op, fn, col, literal } = require('sequelize');
```

Actualizar el `module.exports`:

```js
module.exports = { ventas, ventasResumen, ventasProductos, inventario, compras, caja };
```

**Nota para quien implemente:** si al correr el test la agrupación sale mal (por ejemplo, `producto.nombre` no aparece en las claves del resultado `raw`, o MariaDB rechaza la expresión `literal` con backticks), es un problema de nombres de alias generados por Sequelize para este include específico — imprimir `filas` sin mapear (`console.log(JSON.stringify(filas[0]))`) para ver las claves reales que devuelve MariaDB y ajustar las claves usadas en `.map()` y en `group`/`order` de acuerdo a eso. La lógica (agrupar por producto_id/combo_id, sumar cantidad y cantidad×precio) no cambia, solo los nombres de columna que hay que leer.

- [ ] **Step 4: Ruta**

```js
router.get('/ventas/productos', verificarPermiso('reportes', 'ver'), ctrl.getVentasProductos);
```
(agregar junto a las otras rutas de `/ventas*`)

- [ ] **Step 5: Correr el test**

Run: `cd backend && npx jest tests/reportes.test.js -t "ranking agrupado por producto" -v`
Expected: PASS (ajustando claves si hizo falta, según la nota del Step 3).

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/reportes/reportes.service.js backend/src/modules/reportes/reportes.routes.js backend/tests/reportes.test.js
git commit -m "feat(reportes): ranking de productos mas vendidos agregado en SQL"
```

---

## Task 7: Backend — Reportes → Ventas: ranking de variantes (SQL, con fallback documentado)

**Files:**
- Modify: `backend/src/modules/reportes/reportes.service.js`
- Modify: `backend/src/modules/reportes/reportes.routes.js`
- Modify: `backend/tests/reportes.test.js`

**Interfaces:**
- Consumes: `_whereVentas(filtros, alcance)` de Task 5.
- Produces: `ventasVariantes(filtros, alcance)` → `Promise<Array<{ clave, nombre, unidad, conOpciones, cantidad, monto, ventas }>>`, mismo resultado que la lógica actual de `frontend/src/pages/reportes/tabs/TabVariantes.jsx` líneas 86-108 (agrupa por producto/combo **y** por el conjunto exacto de opciones elegidas), ordenado por `cantidad` descendente.

Este es el punto más delicado del plan (ver spec, Parte 3, sección Ventas, punto 4). Agrupar por "el conjunto de opciones de esta fila" no es un `GROUP BY` de una sola columna — las opciones están en la tabla puente `detalle_pedido_opciones` (`DetallePedido.belongsToMany(Opcion, { through: DetallePedidoOpcion, foreignKey: 'detalle_pedido_id', otherKey: 'opcion_id', as: 'opciones' })`).

- [ ] **Step 1: Escribir el test que falla**

```js
describe('GET /api/v1/reportes/ventas/variantes', () => {
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
  });
});
```

- [ ] **Step 2: Correr el test para confirmar que falla**

Run: `cd backend && npx jest tests/reportes.test.js -t "ranking agrupado por variante" -v`
Expected: FAIL — 404.

- [ ] **Step 3: Implementar `ventasVariantes`**

Enfoque recomendado: traer del rango filtrado solo las columnas mínimas de `DetallePedido` + sus `opciones` (sin el árbol completo de `Pedido`/`Mesa`/`Cliente`/`Usuario` que trae `ventas()`), y agrupar en JS reusando exactamente la misma lógica que hoy vive en `TabVariantes.jsx` — es mucho más liviano que lo que se trae hoy (que incluye cada pedido completo con todos sus includes) aunque no sea un `GROUP BY` puro en SQL:

```js
function _claveVariante(detalle) {
  const base = detalle.producto_id != null ? `p${detalle.producto_id}` : `c${detalle.combo_id}`;
  const opcionIds = (detalle.opciones || []).map((o) => o.id).sort((a, b) => a - b);
  return opcionIds.length ? `${base}-${opcionIds.join('.')}` : base;
}

function _nombreVariante(detalle) {
  const base = detalle.producto?.nombre ?? detalle.combo?.nombre ?? '(eliminado)';
  const opciones = (detalle.opciones || []).map((o) => o.nombre);
  return opciones.length ? `${base} (${opciones.join(', ')})` : base;
}

async function ventasVariantes(filtros = {}, alcance) {
  const where = _whereVentas(filtros, alcance);

  const detalles = await DetallePedido.findAll({
    include: [
      { model: Pedido, attributes: [], where, required: true },
      { model: Producto, as: 'producto', attributes: ['id', 'nombre'] },
      { model: Combo, as: 'combo', attributes: ['id', 'nombre'] },
      { model: Opcion, as: 'opciones', attributes: ['id', 'nombre'], through: { attributes: [] } },
    ],
    attributes: ['producto_id', 'combo_id', 'cantidad', 'peso', 'precio'],
  });

  const mapa = new Map();
  detalles.forEach((d) => {
    if (d.producto_id == null && d.combo_id == null) return;
    const clave = _claveVariante(d);
    const esPesable = d.peso != null;
    const cantidad = esPesable ? parseFloat(d.peso || 0) : (d.cantidad || 0);
    const monto = (d.cantidad || 0) * parseFloat(d.precio || 0);
    if (!mapa.has(clave)) {
      mapa.set(clave, {
        clave, nombre: _nombreVariante(d), unidad: esPesable ? 'kg' : 'un',
        conOpciones: (d.opciones || []).length > 0, cantidad: 0, monto: 0, ventas: 0,
      });
    }
    const variante = mapa.get(clave);
    variante.cantidad += cantidad;
    variante.monto += monto;
    variante.ventas += 1;
  });

  return Array.from(mapa.values()).sort((a, b) => b.cantidad - a.cantidad);
}
```

Actualizar `module.exports`:

```js
module.exports = { ventas, ventasResumen, ventasProductos, ventasVariantes, inventario, compras, caja };
```

- [ ] **Step 4: Ruta**

```js
router.get('/ventas/variantes', verificarPermiso('reportes', 'ver'), ctrl.getVentasVariantes);
```

- [ ] **Step 5: Correr el test**

Run: `cd backend && npx jest tests/reportes.test.js -t "ranking agrupado por variante" -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/reportes/reportes.service.js backend/src/modules/reportes/reportes.routes.js backend/tests/reportes.test.js
git commit -m "feat(reportes): ranking de variantes mas vendidas, liviano por rango de fechas"
```

---

## Task 8: Frontend — `TabVentas.jsx`

**Files:**
- Modify: `frontend/src/api/reportes.js`
- Modify: `frontend/src/pages/reportes/tabs/TabVentas.jsx`

**Interfaces:**
- Consumes: `Paginacion` (Task 1); `GET /reportes/ventas` y `/resumen` (Task 5).
- Produces: `getReporteVentas(params)` → `Promise<{ filas, pagina, limite, total, total_paginas }>`. `getReporteVentasResumen(params)` → `Promise<{ total_ventas, ventas_efectivo, ventas_qr, cantidad, filtros }>`.

- [ ] **Step 1: `frontend/src/api/reportes.js`**

```js
import api from './cliente';

export const getReporteVentas        = (params = {}) => api.get('/reportes/ventas',            { params }).then(r => r.data.datos);
export const getReporteVentasResumen = (params = {}) => api.get('/reportes/ventas/resumen',     { params }).then(r => r.data.datos);
export const getReporteVentasProductos = (params = {}) => api.get('/reportes/ventas/productos', { params }).then(r => r.data.datos);
export const getReporteVentasVariantes = (params = {}) => api.get('/reportes/ventas/variantes', { params }).then(r => r.data.datos);
export const getReporteInventario     = (params = {}) => api.get('/reportes/inventario',        { params }).then(r => r.data.datos);
export const getReporteCompras        = (params = {}) => api.get('/reportes/compras',           { params }).then(r => r.data.datos);
export const getReporteCaja           = (params = {}) => api.get('/reportes/caja',              { params }).then(r => r.data.datos);
```

- [ ] **Step 2: `TabVentas.jsx` — reemplazar estado, queries y filtros**

Import (línea 1-8 actuales) pasa a:

```js
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, ShoppingCart, TrendingUp, DollarSign, BarChart2 } from 'lucide-react';
import { getReporteVentas, getReporteVentasResumen } from '../../../api/reportes';
import { useAuth } from '../../../hooks/useAuth';
import { useAuthStore } from '../../../store/authStore';
import { exportarPDF } from '../utils/exportarPDF';
import { FiltroFechas, StatCard, BadgeTipo, Skeleton, bs, fecha, fechaHora, hoy, inicioMes } from '../shared';
import Paginacion from '../../../components/ui/Paginacion';
```

El bloque de estado (líneas 41-56 actuales) pasa a:

```js
export default function TabVentas({ empresa, logo, direccion, telefono }) {
  const { usuario } = useAuth();
  const accesoTodas = useAuthStore((s) => s.usuario?.sucursal_activa?.id == null);
  const [filtroSucursal, setFiltroSucursal] = useState('todas');
  const [desde, setDesde] = useState(inicioMes());
  const [hasta, setHasta] = useState(hoy());
  const [filtroCajero, setFiltroCajero] = useState('todos');
  const [filtroMetodoPago, setFiltroMetodoPago] = useState('todos');
  const [filtroTipo, setFiltroTipo] = useState('todos');
  const [filtroOrigen, setFiltroOrigen] = useState('todos');
  const [params, setParams] = useState({ desde: inicioMes(), hasta: hoy() });
  const [pagina, setPagina] = useState(1);

  const filtrosApi = {
    ...params,
    sucursal_id: accesoTodas && filtroSucursal !== 'todas' ? filtroSucursal : undefined,
    usuario_id: filtroCajero !== 'todos' ? filtroCajero : undefined,
    metodo_pago: filtroMetodoPago !== 'todos' ? filtroMetodoPago : undefined,
    tipo: filtroTipo !== 'todos' ? filtroTipo : undefined,
    origen: filtroOrigen !== 'todos' ? filtroOrigen : undefined,
  };

  useEffect(() => { setPagina(1); }, [params, filtroSucursal, filtroCajero, filtroMetodoPago, filtroTipo, filtroOrigen]);

  const { data: paginaDatos, isLoading } = useQuery({
    queryKey: ['reporte-ventas', filtrosApi, pagina],
    queryFn: () => getReporteVentas({ ...filtrosApi, pagina }),
  });
  const data = paginaDatos?.filas ?? [];
  const totalPaginas = paginaDatos?.total_paginas ?? 1;

  const { data: resumen } = useQuery({
    queryKey: ['reporte-ventas-resumen', filtrosApi],
    queryFn: () => getReporteVentasResumen(filtrosApi),
  });

  const cajeros = resumen?.filtros?.cajeros ?? [];
  const sucursales = resumen?.filtros?.sucursales ?? [];
```

Esto reemplaza los `useMemo` de `cajeros` y `sucursales` que existían antes (ya no hace falta derivarlos de `data`, vienen del `resumen`) — borrarlos. El resto del archivo (el `useMemo` de `filtrado` para exportar a PDF, los `StatCard`, el render de la tabla/tarjetas) sigue leyendo `data` como antes para la tabla/tarjetas, pero el botón "Exportar PDF" cambia:

- [ ] **Step 3: Exportar a PDF con `limite=0`**

Ubicar la función `exportar` actual (usa `filtrado.map(...)` para armar las filas del PDF) y convertirla en `async`, pidiendo todo el rango filtrado en vez de usar `data`/`filtrado` (que ahora es solo la página visible):

```js
  const exportar = async () => {
    const { filas: todas } = await getReporteVentas({ ...filtrosApi, limite: 0 });
    exportarPDF({
      titulo: 'Reporte de Ventas',
      subtitulo: `${fecha(params.desde)} — ${fecha(params.hasta)} · ${cajeroLabel} · ${metodoPagoLabel} · ${tipoVentaLabel} · ${origenLabel}`,
      empresa, logo, direccion, telefono,
      generadoPor: usuario?.nombre,
      columnas: ['Fecha', 'Cliente', 'Tipo', 'Método', 'Mesa/Nº', 'Cajero', 'Total'],
      filas: todas.map(v => [
        fechaHora(v.creado_en),
        v.nombre_cliente || v.cliente?.nombre || 'Público General',
        tipoLabel(v.tipo),
        v.metodo_pago,
        v.tipo === 'llevar' ? `#${v.numero_llevar ?? '-'}` : (v.mesa?.nombre || '-'),
        v.usuario?.nombre || '-',
        bs(v.total),
      ]),
    });
  };
```

(Los nombres exactos de columnas/labels — `cajeroLabel`, `metodoPagoLabel`, etc. — son los que ya arma el archivo actual más arriba; conservarlos, solo cambia de dónde sale `filas` y que ahora es `async`.) Ajustar el `onClick` del botón de exportar a `onClick={exportar}` si no lo era ya, y considerar un estado de carga simple (`const [exportando, setExportando] = useState(false)`) envolviendo el `await` si se quiere feedback visual — opcional, no bloqueante para el resto de la task.

- [ ] **Step 4: Agregar `<Paginacion>` debajo de la lista/tabla**

En el JSX, después de renderizar la lista de `VentaCard`/tabla de ventas:

```jsx
<Paginacion pagina={pagina} totalPaginas={totalPaginas} onCambiar={setPagina} />
```

- [ ] **Step 5: Verificar**

Run: `cd frontend && npx eslint src/pages/reportes/tabs/TabVentas.jsx src/api/reportes.js && npm run build`
Expected: sin errores, build exitoso.

Prueba manual: entrar a Reportes → Ventas, confirmar que los filtros (cajero, método de pago, tipo, origen, sucursal si sos admin) siguen funcionando, que aparece paginación si hay más de 20 ventas en el rango, y que "Exportar PDF" trae todas las ventas del rango filtrado (no solo las 20 visibles).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/reportes.js frontend/src/pages/reportes/tabs/TabVentas.jsx
git commit -m "feat(reportes): TabVentas usa paginacion y resumen del backend"
```

---

## Task 9: Frontend — `TabProductos.jsx`

**Files:**
- Modify: `frontend/src/pages/reportes/tabs/TabProductos.jsx`

**Interfaces:**
- Consumes: `getReporteVentasProductos` (Task 8, ya agregado a `api/reportes.js`); `getReporteVentasResumen` (Task 8) para las opciones de sucursal.

- [ ] **Step 1: Reemplazar la fuente de datos**

Import (línea 1-8) pasa a:

```js
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Layers, ShoppingCart, DollarSign, Trophy } from 'lucide-react';
import { getReporteVentasProductos, getReporteVentasResumen } from '../../../api/reportes';
import { useAuth } from '../../../hooks/useAuth';
import { useAuthStore } from '../../../store/authStore';
import { exportarPDF } from '../utils/exportarPDF';
import { FiltroFechas, StatCard, Skeleton, bs, fecha, hoy, inicioMes } from '../shared';
```

El bloque de estado y queries (que hoy trae `getReporteVentas` y calcula `sucursales` con `useMemo` sobre `data`) pasa a:

```js
export default function TabProductos({ empresa, logo, direccion, telefono }) {
  const { usuario } = useAuth();
  const accesoTodas = useAuthStore((s) => s.usuario?.sucursal_activa?.id == null);
  const [filtroSucursal, setFiltroSucursal] = useState('todas');
  const [desde, setDesde] = useState(inicioMes());
  const [hasta, setHasta] = useState(hoy());
  const [params, setParams] = useState({ desde: inicioMes(), hasta: hoy() });

  const filtrosApi = {
    ...params,
    sucursal_id: accesoTodas && filtroSucursal !== 'todas' ? filtroSucursal : undefined,
  };

  const { data = [], isLoading } = useQuery({
    queryKey: ['reporte-ventas-productos', filtrosApi],
    queryFn: () => getReporteVentasProductos(filtrosApi),
  });

  const { data: resumen } = useQuery({
    queryKey: ['reporte-ventas-resumen', filtrosApi],
    queryFn: () => getReporteVentasResumen(filtrosApi),
  });
  const sucursales = resumen?.filtros?.sucursales ?? [];
```

`data` ahora ya viene ordenado y agrupado desde el backend (`{ id, tipo, nombre, cantidad, monto }[]`) — el resto del componente que hoy arma un ranking con `producto.nombre`/`producto.cantidad`/`producto.monto` a partir de sumar pedidos pasa a leer esos mismos campos directo de cada elemento de `data` (ya no hace falta el `useMemo` de agregación, ni el `useMemo` de `sucursales`, ni ningún filtro client-side por sucursal — ese filtro ya lo aplica `filtrosApi.sucursal_id` en el backend). Ajustar el render (`ProductoCard` y el cuerpo del componente) para usar `data` directamente donde antes usaba el resultado del `useMemo`.

- [ ] **Step 2: Exportar a PDF**

El ranking completo YA es lo que trae `data` (no hay paginación en este endpoint — es un ranking acotado por catálogo, no por historial, ver Task 6), así que el botón de exportar sigue usando `data` tal cual, sin necesidad de un fetch adicional con `limite=0` (esta pantalla no tiene ese concepto).

- [ ] **Step 3: Verificar**

Run: `cd frontend && npx eslint src/pages/reportes/tabs/TabProductos.jsx && npm run build`
Expected: sin errores, build exitoso.

Prueba manual: Reportes → Productos, confirmar que el ranking sigue mostrando los mismos productos/cantidades que antes del cambio (comparar contra lo que mostraba `TabVentas` sumado a mano para un par de productos conocidos).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/reportes/tabs/TabProductos.jsx
git commit -m "feat(reportes): TabProductos consume el ranking agregado en SQL"
```

---

## Task 10: Frontend — `TabVariantes.jsx`

**Files:**
- Modify: `frontend/src/pages/reportes/tabs/TabVariantes.jsx`

**Interfaces:**
- Consumes: `getReporteVentasVariantes` (agregar a `api/reportes.js` si no quedó en Task 8 — ya está, ver Task 8 Step 1); `getReporteVentasResumen` para sucursales.

- [ ] **Step 1: Reemplazar la fuente de datos**

Mismo patrón que Task 9. Import:

```js
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Shirt, ShoppingCart, DollarSign, Trophy } from 'lucide-react';
import { getReporteVentasVariantes, getReporteVentasResumen } from '../../../api/reportes';
import { useAuth } from '../../../hooks/useAuth';
import { useAuthStore } from '../../../store/authStore';
import { exportarPDF } from '../utils/exportarPDF';
import { FiltroFechas, StatCard, Skeleton, bs, fecha, hoy, inicioMes } from '../shared';
```

(revisar el import real de íconos del archivo actual antes de tocarlo — mantener los que ya usa, este es solo un ejemplo de forma)

```js
export default function TabVariantes({ empresa, logo, direccion, telefono }) {
  const { usuario } = useAuth();
  const accesoTodas = useAuthStore((s) => s.usuario?.sucursal_activa?.id == null);
  const [filtroSucursal, setFiltroSucursal] = useState('todas');
  const [desde, setDesde] = useState(inicioMes());
  const [hasta, setHasta] = useState(hoy());
  const [params, setParams] = useState({ desde: inicioMes(), hasta: hoy() });

  const filtrosApi = {
    ...params,
    sucursal_id: accesoTodas && filtroSucursal !== 'todas' ? filtroSucursal : undefined,
  };

  const { data: variantes = [], isLoading } = useQuery({
    queryKey: ['reporte-ventas-variantes', filtrosApi],
    queryFn: () => getReporteVentasVariantes(filtrosApi),
  });

  const { data: resumen } = useQuery({
    queryKey: ['reporte-ventas-resumen', filtrosApi],
    queryFn: () => getReporteVentasResumen(filtrosApi),
  });
  const sucursales = resumen?.filtros?.sucursales ?? [];
```

El backend (Task 7) ya devuelve exactamente el shape `{ clave, nombre, unidad, conOpciones, cantidad, monto, ventas }[]` que hoy arma el `useMemo` local (`variantes`) — borrar ese `useMemo` y las funciones `claveVariante`/`nombreVariante` SI están definidas dentro de este archivo (si están en `shared.jsx` u otro archivo compartido, dejarlas — revisar antes de borrar). El resto del render sigue leyendo `variantes` igual que antes.

- [ ] **Step 2: Verificar**

Run: `cd frontend && npx eslint src/pages/reportes/tabs/TabVariantes.jsx && npm run build`
Expected: sin errores, build exitoso.

Prueba manual: Reportes → Variantes, comparar el ranking contra el comportamiento previo al cambio para un producto con opciones conocido.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/reportes/tabs/TabVariantes.jsx
git commit -m "feat(reportes): TabVariantes consume el ranking agregado del backend"
```

---

## Task 11: Backend — Reportes → Compras: paginación, resumen y filtro `estado`

**Files:**
- Modify: `backend/src/modules/reportes/reportes.service.js`
- Modify: `backend/src/modules/reportes/reportes.routes.js`
- Modify: `backend/tests/reportes.test.js`

**Interfaces:**
- Produces: `compras(filtros, alcance)` → `Promise<{ filas, pagina, limite, total, total_paginas }>`. `comprasResumen(filtros, alcance)` → `Promise<{ total_comprado, cantidad, filtros: { sucursales? } }>`. Filtro nuevo: `estado` (`'pendiente'|'recibido'`).

- [ ] **Step 1: Escribir los tests que fallan**

```js
describe('GET /api/v1/reportes/compras — paginación, resumen y filtro estado', () => {
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
```

- [ ] **Step 2: Correr los tests para confirmar que fallan**

Run: `cd backend && npx jest tests/reportes.test.js -t "paginación, resumen y filtro estado" -v`
Expected: FAIL.

- [ ] **Step 3: Reemplazar `compras()` y agregar `comprasResumen` en `reportes.service.js`**

```js
function _whereCompras(filtros, alcance) {
  const { desde, hasta, estado } = filtros;
  const where = filtroFecha(desde, hasta);
  if (!alcance.acceso_todas) where.sucursal_id = alcance.sucursal_id;
  else if (filtros.sucursal_id) where.sucursal_id = filtros.sucursal_id;
  if (estado) where.estado = estado;
  return where;
}

async function compras(filtros = {}, alcance) {
  const where = _whereCompras(filtros, alcance);
  const { pagina, limite } = _paginaLimite(filtros);

  const { rows, count } = await Compra.findAndCountAll({
    where,
    include: [
      { model: Proveedor, as: 'proveedor', attributes: ['id', 'nombre'] },
      { model: Usuario,   as: 'usuario',   attributes: ['id', 'nombre'] },
      INCLUDE_SUCURSAL,
    ],
    order: [['creado_en', 'DESC']],
    distinct: true,
    ...(limite ? { limit: limite, offset: (pagina - 1) * limite } : {}),
  });

  return { filas: rows, pagina, limite, total: count, total_paginas: limite ? Math.ceil(count / limite) : 1 };
}

async function comprasResumen(filtros = {}, alcance) {
  const where = _whereCompras(filtros, alcance);

  const [totalComprado, cantidad] = await Promise.all([
    Compra.sum('total', { where }),
    Compra.count({ where }),
  ]);

  const filtrosResp = {};
  if (alcance.acceso_todas) {
    const sucursalesRaw = await Compra.findAll({
      where, include: [INCLUDE_SUCURSAL], attributes: [],
      group: ['sucursal.id', 'sucursal.nombre'], raw: true,
    });
    filtrosResp.sucursales = sucursalesRaw
      .map((f) => ({ id: f['sucursal.id'], nombre: f['sucursal.nombre'] }))
      .filter((s) => s.id != null);
  }

  return { total_comprado: parseFloat(totalComprado || 0), cantidad: cantidad || 0, filtros: filtrosResp };
}
```

Actualizar `module.exports`:

```js
module.exports = { ventas, ventasResumen, ventasProductos, ventasVariantes, inventario, compras, comprasResumen, caja };
```

- [ ] **Step 4: Ruta**

```js
router.get('/compras/resumen', verificarPermiso('reportes', 'ver'), ctrl.getComprasResumen);
router.get('/compras',         verificarPermiso('reportes', 'ver'), ctrl.getCompras);
```

- [ ] **Step 5: Correr los tests**

Run: `cd backend && npx jest tests/reportes.test.js -v`
Expected: PASS (todos).

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/reportes/reportes.service.js backend/src/modules/reportes/reportes.routes.js backend/tests/reportes.test.js
git commit -m "feat(reportes): paginacion, resumen y filtro de estado para compras"
```

---

## Task 12: Frontend — `TabCompras.jsx`

**Files:**
- Modify: `frontend/src/api/reportes.js`
- Modify: `frontend/src/pages/reportes/tabs/TabCompras.jsx`

**Interfaces:**
- Consumes: `Paginacion` (Task 1); endpoints de Task 11.

- [ ] **Step 1: `api/reportes.js`**

Agregar junto a las demás funciones del archivo (ya tocado en Task 8):

```js
export const getReporteComprasResumen = (params = {}) => api.get('/reportes/compras/resumen', { params }).then(r => r.data.datos);
```

- [ ] **Step 2: `TabCompras.jsx`**

Mismo patrón que `TabVentas.jsx` (Task 8), adaptado a los campos de Compras. Import agrega `Paginacion` y `getReporteComprasResumen`:

```js
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getReporteCompras, getReporteComprasResumen } from '../../../api/reportes';
import Paginacion from '../../../components/ui/Paginacion';
// (mantener el resto de imports ya presentes en el archivo: íconos, useAuth, useAuthStore, exportarPDF, shared)
```

Estado y queries:

```js
export default function TabCompras({ empresa, logo, direccion, telefono }) {
  const { usuario } = useAuth();
  const accesoTodas = useAuthStore((s) => s.usuario?.sucursal_activa?.id == null);
  const [filtroSucursal, setFiltroSucursal] = useState('todas');
  const [desde, setDesde] = useState(inicioMes());
  const [hasta, setHasta] = useState(hoy());
  const [filtroEstado, setFiltroEstado] = useState('todos');
  const [params, setParams] = useState({ desde: inicioMes(), hasta: hoy() });
  const [pagina, setPagina] = useState(1);

  const filtrosApi = {
    ...params,
    sucursal_id: accesoTodas && filtroSucursal !== 'todas' ? filtroSucursal : undefined,
    estado: filtroEstado !== 'todos' ? filtroEstado : undefined,
  };

  useEffect(() => { setPagina(1); }, [params, filtroSucursal, filtroEstado]);

  const { data: paginaDatos, isLoading } = useQuery({
    queryKey: ['reporte-compras', filtrosApi, pagina],
    queryFn: () => getReporteCompras({ ...filtrosApi, pagina }),
  });
  const data = paginaDatos?.filas ?? [];
  const totalPaginas = paginaDatos?.total_paginas ?? 1;

  const { data: resumen } = useQuery({
    queryKey: ['reporte-compras-resumen', filtrosApi],
    queryFn: () => getReporteComprasResumen(filtrosApi),
  });
  const sucursales = resumen?.filtros?.sucursales ?? [];
```

Borrar el `useMemo` de `sucursales` y el `useMemo` de `filtrado` que existían antes (`data` ya viene filtrado del backend). El resto del render (tabla/tarjetas de compras) pasa a usar `data` en vez de `filtrado`.

- [ ] **Step 3: Exportar a PDF con `limite=0`**

Igual que Task 8 Step 3, adaptado: la función `exportar` pasa a `async`, pide `getReporteCompras({ ...filtrosApi, limite: 0 })` y usa `.filas` para armar las filas del PDF (conservar las columnas/labels que ya arma el archivo actual).

- [ ] **Step 4: Agregar `<Paginacion>`**

```jsx
<Paginacion pagina={pagina} totalPaginas={totalPaginas} onCambiar={setPagina} />
```
después de la lista/tabla de compras.

- [ ] **Step 5: Verificar**

Run: `cd frontend && npx eslint src/pages/reportes/tabs/TabCompras.jsx src/api/reportes.js && npm run build`
Expected: sin errores, build exitoso.

Prueba manual: Reportes → Compras, filtrar por estado, confirmar paginación y que exportar trae todo el rango.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/reportes.js frontend/src/pages/reportes/tabs/TabCompras.jsx
git commit -m "feat(reportes): TabCompras usa paginacion y resumen del backend"
```

---

## Task 13: Backend — Reportes → Inventario: paginación, resumen y filtro `tipo`

**Files:**
- Modify: `backend/src/modules/reportes/reportes.service.js`
- Modify: `backend/src/modules/reportes/reportes.routes.js`
- Modify: `backend/tests/reportes.test.js`

**Interfaces:**
- Produces: `inventario(filtros, alcance)` → `Promise<{ filas, pagina, limite, total, total_paginas }>`. `inventarioResumen(filtros, alcance)` → `Promise<{ cantidad, filtros: { sucursales? } }>`. Filtro nuevo: `tipo` (`entrada|salida|venta|compra|ajuste`).

- [ ] **Step 1: Escribir los tests que fallan**

```js
describe('GET /api/v1/reportes/inventario — paginación, resumen y filtro tipo', () => {
  test('pagina con limite por defecto', async () => {
    const res = await request(app)
      .get('/api/v1/reportes/inventario')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.datos).toHaveProperty('filas');
    expect(res.body.datos).toHaveProperty('total_paginas');
  });

  test('filtro tipo solo devuelve registros de ese tipo', async () => {
    const res = await request(app)
      .get('/api/v1/reportes/inventario?tipo=ajuste&limite=0')
      .set('Authorization', `Bearer ${token}`);
    expect(res.body.datos.filas.every(f => f.tipo === 'ajuste')).toBe(true);
  });

  test('GET /api/v1/reportes/inventario/resumen devuelve cantidad', async () => {
    const res = await request(app)
      .get('/api/v1/reportes/inventario/resumen')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.datos.cantidad).toBe('number');
  });
});
```

- [ ] **Step 2: Correr los tests para confirmar que fallan**

Run: `cd backend && npx jest tests/reportes.test.js -t "paginación, resumen y filtro tipo" -v`
Expected: FAIL.

- [ ] **Step 3: Reemplazar `inventario()` y agregar `inventarioResumen`**

```js
function _whereInventario(filtros, alcance) {
  const { desde, hasta, tipo } = filtros;
  const where = filtroFecha(desde, hasta);
  if (!alcance.acceso_todas) where.sucursal_id = alcance.sucursal_id;
  else if (filtros.sucursal_id) where.sucursal_id = filtros.sucursal_id;
  if (tipo) where.tipo = tipo;
  return where;
}

async function inventario(filtros = {}, alcance) {
  const where = _whereInventario(filtros, alcance);
  const { pagina, limite } = _paginaLimite(filtros);

  const { rows, count } = await RegistroInventario.findAndCountAll({
    where,
    include: [
      { model: Producto, as: 'producto', attributes: ['id', 'nombre', 'stock'] },
      { model: Usuario,  as: 'usuario',  attributes: ['id', 'nombre'] },
      INCLUDE_SUCURSAL,
    ],
    order: [['creado_en', 'DESC']],
    distinct: true,
    ...(limite ? { limit: limite, offset: (pagina - 1) * limite } : {}),
  });

  return { filas: rows, pagina, limite, total: count, total_paginas: limite ? Math.ceil(count / limite) : 1 };
}

async function inventarioResumen(filtros = {}, alcance) {
  const where = _whereInventario(filtros, alcance);
  const cantidad = await RegistroInventario.count({ where });

  const filtrosResp = {};
  if (alcance.acceso_todas) {
    const sucursalesRaw = await RegistroInventario.findAll({
      where, include: [INCLUDE_SUCURSAL], attributes: [],
      group: ['sucursal.id', 'sucursal.nombre'], raw: true,
    });
    filtrosResp.sucursales = sucursalesRaw
      .map((f) => ({ id: f['sucursal.id'], nombre: f['sucursal.nombre'] }))
      .filter((s) => s.id != null);
  }

  return { cantidad: cantidad || 0, filtros: filtrosResp };
}
```

Actualizar `module.exports`:

```js
module.exports = { ventas, ventasResumen, ventasProductos, ventasVariantes, inventario, inventarioResumen, compras, comprasResumen, caja };
```

- [ ] **Step 4: Ruta**

```js
router.get('/inventario/resumen', verificarPermiso('reportes', 'ver'), ctrl.getInventarioResumen);
router.get('/inventario',         verificarPermiso('reportes', 'ver'), ctrl.getInventario);
```

- [ ] **Step 5: Correr los tests**

Run: `cd backend && npx jest tests/reportes.test.js -v`
Expected: PASS (todos).

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/reportes/reportes.service.js backend/src/modules/reportes/reportes.routes.js backend/tests/reportes.test.js
git commit -m "feat(reportes): paginacion, resumen y filtro de tipo para inventario"
```

---

## Task 14: Frontend — `TabInventario.jsx`

**Files:**
- Modify: `frontend/src/api/reportes.js`
- Modify: `frontend/src/pages/reportes/tabs/TabInventario.jsx`

**Interfaces:**
- Consumes: `Paginacion` (Task 1); endpoints de Task 13.

- [ ] **Step 1: `api/reportes.js`**

```js
export const getReporteInventarioResumen = (params = {}) => api.get('/reportes/inventario/resumen', { params }).then(r => r.data.datos);
```

- [ ] **Step 2: `TabInventario.jsx`**

Mismo patrón que Task 12, adaptado a Inventario:

```js
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getReporteInventario, getReporteInventarioResumen } from '../../../api/reportes';
import Paginacion from '../../../components/ui/Paginacion';
// (mantener el resto de imports ya presentes)

export default function TabInventario({ empresa, logo, direccion, telefono }) {
  const { usuario } = useAuth();
  const accesoTodas = useAuthStore((s) => s.usuario?.sucursal_activa?.id == null);
  const [filtroSucursal, setFiltroSucursal] = useState('todas');
  const [desde, setDesde] = useState(inicioMes());
  const [hasta, setHasta] = useState(hoy());
  const [filtroTipo, setFiltroTipo] = useState('todos');
  const [params, setParams] = useState({ desde: inicioMes(), hasta: hoy() });
  const [pagina, setPagina] = useState(1);

  const filtrosApi = {
    ...params,
    sucursal_id: accesoTodas && filtroSucursal !== 'todas' ? filtroSucursal : undefined,
    tipo: filtroTipo !== 'todos' ? filtroTipo : undefined,
  };

  useEffect(() => { setPagina(1); }, [params, filtroSucursal, filtroTipo]);

  const { data: paginaDatos, isLoading } = useQuery({
    queryKey: ['reporte-inventario', filtrosApi, pagina],
    queryFn: () => getReporteInventario({ ...filtrosApi, pagina }),
  });
  const data = paginaDatos?.filas ?? [];
  const totalPaginas = paginaDatos?.total_paginas ?? 1;

  const { data: resumen } = useQuery({
    queryKey: ['reporte-inventario-resumen', filtrosApi],
    queryFn: () => getReporteInventarioResumen(filtrosApi),
  });
  const sucursales = resumen?.filtros?.sucursales ?? [];
```

Borrar los `useMemo` de `sucursales`/`filtrado` preexistentes; el resto del render usa `data` directo.

- [ ] **Step 3: Exportar a PDF y `<Paginacion>`**

Mismo patrón que Task 12 Steps 3-4: `exportar` pasa a `async` con `getReporteInventario({ ...filtrosApi, limite: 0 })`, y se agrega `<Paginacion pagina={pagina} totalPaginas={totalPaginas} onCambiar={setPagina} />` después de la lista.

- [ ] **Step 4: Verificar**

Run: `cd frontend && npx eslint src/pages/reportes/tabs/TabInventario.jsx src/api/reportes.js && npm run build`
Expected: sin errores, build exitoso.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/reportes.js frontend/src/pages/reportes/tabs/TabInventario.jsx
git commit -m "feat(reportes): TabInventario usa paginacion y resumen del backend"
```

---

## Task 15: Backend — Reportes → Caja: paginación, resumen y filtro `tipo`

**Files:**
- Modify: `backend/src/modules/reportes/reportes.service.js`
- Modify: `backend/src/modules/reportes/reportes.routes.js`
- Modify: `backend/tests/reportes.test.js`

**Interfaces:**
- Produces: `caja(filtros, alcance)` → `Promise<{ filas, pagina, limite, total, total_paginas }>` (mismo aplanado `sucursal` que ya hace la función actual, tomado de `sesion_caja.sucursal`). `cajaResumen(filtros, alcance)` → `Promise<{ total_ingresos, total_egresos, filtros: { sucursales? } }>`. Filtro nuevo: `tipo` (`ingreso|egreso`).

- [ ] **Step 1: Escribir los tests que fallan**

```js
describe('GET /api/v1/reportes/caja — paginación, resumen y filtro tipo', () => {
  test('pagina con limite por defecto', async () => {
    const res = await request(app)
      .get('/api/v1/reportes/caja')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.datos).toHaveProperty('filas');
    expect(res.body.datos).toHaveProperty('total_paginas');
  });

  test('filtro tipo solo devuelve movimientos de ese tipo', async () => {
    const res = await request(app)
      .get('/api/v1/reportes/caja?tipo=ingreso&limite=0')
      .set('Authorization', `Bearer ${token}`);
    expect(res.body.datos.filas.every(f => f.tipo === 'ingreso')).toBe(true);
  });

  test('GET /api/v1/reportes/caja/resumen devuelve totales', async () => {
    const res = await request(app)
      .get('/api/v1/reportes/caja/resumen')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.datos.total_ingresos).toBe('number');
    expect(typeof res.body.datos.total_egresos).toBe('number');
  });
});
```

- [ ] **Step 2: Correr los tests para confirmar que fallan**

Run: `cd backend && npx jest tests/reportes.test.js -t "paginación, resumen y filtro tipo" -v` (nota: este `-t` matchea también los tests de Task 13 si tienen el mismo texto — está bien, ambos deben pasar juntos; si se quiere aislar, correr el archivo completo)
Expected: FAIL para los tests de `/reportes/caja`.

- [ ] **Step 3: Reemplazar `caja()` y agregar `cajaResumen`**

La función actual ya arma manualmente el filtro por sucursal vía `includeSesion.where` (porque `LibroCaja` no tiene `sucursal_id` propio, sale de `sesion_caja.sucursal_id`) — mantener ese mecanismo, sumarle paginación, filtro `tipo`, y el soporte para que un admin filtre por una sucursal puntual:

```js
function _includeSesionCaja(filtros, alcance) {
  const includeSesion = {
    model: SesionCaja, as: 'sesion_caja', attributes: ['id'],
    include: [INCLUDE_SUCURSAL],
  };
  if (!alcance.acceso_todas) {
    includeSesion.where = { sucursal_id: alcance.sucursal_id };
  } else if (filtros.sucursal_id) {
    includeSesion.where = { sucursal_id: filtros.sucursal_id };
  }
  return includeSesion;
}

function _aplanarSucursal(registro) {
  const plano = registro.toJSON();
  plano.sucursal = plano.sesion_caja?.sucursal ?? null;
  delete plano.sesion_caja;
  return plano;
}

async function caja(filtros = {}, alcance) {
  const { desde, hasta, tipo } = filtros;
  const where = { ...filtroFecha(desde, hasta) };
  if (tipo) where.tipo = tipo;
  const { pagina, limite } = _paginaLimite(filtros);

  const { rows, count } = await LibroCaja.findAndCountAll({
    where,
    include: [
      { model: Usuario, as: 'usuario', attributes: ['id', 'nombre'] },
      _includeSesionCaja(filtros, alcance),
    ],
    order: [['creado_en', 'DESC']],
    distinct: true,
    ...(limite ? { limit: limite, offset: (pagina - 1) * limite } : {}),
  });

  return {
    filas: rows.map(_aplanarSucursal),
    pagina, limite, total: count,
    total_paginas: limite ? Math.ceil(count / limite) : 1,
  };
}

async function cajaResumen(filtros = {}, alcance) {
  const { desde, hasta, tipo } = filtros;
  const where = { ...filtroFecha(desde, hasta) };
  if (tipo) where.tipo = tipo;
  const includeSesion = _includeSesionCaja(filtros, alcance);

  const [totalIngresos, totalEgresos] = await Promise.all([
    LibroCaja.sum('monto', { where: { ...where, tipo: 'ingreso' }, include: [includeSesion] }),
    LibroCaja.sum('monto', { where: { ...where, tipo: 'egreso' }, include: [includeSesion] }),
  ]);

  const filtrosResp = {};
  if (alcance.acceso_todas) {
    const sucursalesRaw = await LibroCaja.findAll({
      where,
      include: [{
        model: SesionCaja, as: 'sesion_caja', attributes: [], required: true,
        include: [{ model: Sucursal, as: 'sucursal', attributes: ['id', 'nombre'] }],
      }],
      attributes: [], group: ['sesion_caja.sucursal.id', 'sesion_caja.sucursal.nombre'], raw: true,
    });
    filtrosResp.sucursales = sucursalesRaw
      .map((f) => ({ id: f['sesion_caja.sucursal.id'], nombre: f['sesion_caja.sucursal.nombre'] }))
      .filter((s) => s.id != null);
  }

  return { total_ingresos: parseFloat(totalIngresos || 0), total_egresos: parseFloat(totalEgresos || 0), filtros: filtrosResp };
}
```

`Sucursal` ya está importado en este archivo (usado por `INCLUDE_SUCURSAL`). Actualizar `module.exports` (última vez que se toca en este plan):

```js
module.exports = {
  ventas, ventasResumen, ventasProductos, ventasVariantes,
  inventario, inventarioResumen,
  compras, comprasResumen,
  caja, cajaResumen,
};
```

- [ ] **Step 4: Ruta**

```js
router.get('/caja/resumen', verificarPermiso('reportes', 'ver'), ctrl.getCajaResumen);
router.get('/caja',         verificarPermiso('reportes', 'ver'), ctrl.getCaja);
```

- [ ] **Step 5: Correr los tests**

Run: `cd backend && npx jest tests/reportes.test.js -v`
Expected: PASS (todos — este es el archivo completo de reportes, cubre las Tasks 5-7 y 11-15).

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/reportes/reportes.service.js backend/src/modules/reportes/reportes.routes.js backend/tests/reportes.test.js
git commit -m "feat(reportes): paginacion, resumen y filtro de tipo para caja"
```

---

## Task 16: Frontend — `TabCaja.jsx`

**Files:**
- Modify: `frontend/src/api/reportes.js`
- Modify: `frontend/src/pages/reportes/tabs/TabCaja.jsx`

**Interfaces:**
- Consumes: `Paginacion` (Task 1); endpoints de Task 15.

- [ ] **Step 1: `api/reportes.js`**

```js
export const getReporteCajaResumen = (params = {}) => api.get('/reportes/caja/resumen', { params }).then(r => r.data.datos);
```

- [ ] **Step 2: `TabCaja.jsx`**

Mismo patrón que las Tasks 12/14, adaptado a Caja (que además tiene el bloque `resumenSucursales` — el desglose de ingresos/egresos por sucursal cuando `accesoTodas` — ver más abajo):

```js
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getReporteCaja, getReporteCajaResumen } from '../../../api/reportes';
import Paginacion from '../../../components/ui/Paginacion';
// (mantener el resto de imports ya presentes)

export default function TabCaja({ empresa, logo, direccion, telefono }) {
  const { usuario } = useAuth();
  const accesoTodas = useAuthStore((s) => s.usuario?.sucursal_activa?.id == null);
  const [filtroSucursal, setFiltroSucursal] = useState('todas');
  const [desde, setDesde] = useState(inicioMes());
  const [hasta, setHasta] = useState(hoy());
  const [filtroTipo, setFiltroTipo] = useState('todos');
  const [params, setParams] = useState({ desde: inicioMes(), hasta: hoy() });
  const [pagina, setPagina] = useState(1);

  const filtrosApi = {
    ...params,
    sucursal_id: accesoTodas && filtroSucursal !== 'todas' ? filtroSucursal : undefined,
    tipo: filtroTipo !== 'todos' ? filtroTipo : undefined,
  };

  useEffect(() => { setPagina(1); }, [params, filtroSucursal, filtroTipo]);

  const { data: paginaDatos, isLoading } = useQuery({
    queryKey: ['reporte-caja', filtrosApi, pagina],
    queryFn: () => getReporteCaja({ ...filtrosApi, pagina }),
  });
  const data = paginaDatos?.filas ?? [];
  const totalPaginas = paginaDatos?.total_paginas ?? 1;

  const { data: resumen } = useQuery({
    queryKey: ['reporte-caja-resumen', filtrosApi],
    queryFn: () => getReporteCajaResumen(filtrosApi),
  });
  const sucursales = resumen?.filtros?.sucursales ?? [];

  const stats = {
    total: paginaDatos?.total ?? 0,
    ingresos: resumen?.total_ingresos ?? 0,
    egresos: resumen?.total_egresos ?? 0,
    balance: (resumen?.total_ingresos ?? 0) - (resumen?.total_egresos ?? 0),
  };
```

Esto reemplaza el `useMemo` de `stats` que hoy suma sobre `data` completo. El bloque `resumenSucursales` (desglose de ingresos/egresos por sucursal, líneas 68-82 del archivo actual) queda **fuera de alcance de este plan** — hoy se calcula sumando `filtrado` (todas las filas visibles) por sucursal en el navegador, y ese desglose por sucursal simultáneo no lo cubre el endpoint `resumen` (que da un solo total, no un total-por-sucursal). Dejarlo tal cual está pero que sume sobre `data` (la página visible) en vez de sobre el array completo — es una degradación aceptada y documentada: ese desglose específico deja de ser 100% preciso cuando hay más de una página de movimientos mixtos entre sucursales, hasta una eventual mejora futura que agregue un endpoint de resumen-por-sucursal si hace falta. Ninguna otra parte de esta task depende de arreglar eso.

Borrar el `useMemo` de `sucursales` preexistente (ahora sale de `resumen.filtros.sucursales`).

- [ ] **Step 3: Exportar a PDF y `<Paginacion>`**

Mismo patrón que las tasks anteriores: `exportar` pasa a `async` con `getReporteCaja({ ...filtrosApi, limite: 0 })`, agregar `<Paginacion pagina={pagina} totalPaginas={totalPaginas} onCambiar={setPagina} />` después de la lista.

- [ ] **Step 4: Verificar**

Run: `cd frontend && npx eslint src/pages/reportes/tabs/TabCaja.jsx src/api/reportes.js && npm run build`
Expected: sin errores, build exitoso.

Prueba manual completa (cierra el plan): recorrer los 6 listados (Libro de Caja + 5 pestañas de Reportes), confirmar paginación, filtros, y exportación a PDF completa en cada uno.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/reportes.js frontend/src/pages/reportes/tabs/TabCaja.jsx
git commit -m "feat(reportes): TabCaja usa paginacion y resumen del backend"
```
