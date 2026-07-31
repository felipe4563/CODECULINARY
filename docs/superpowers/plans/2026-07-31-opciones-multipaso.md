# Opciones de Producto Multi-Paso — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar la relación 1-a-1 `productos.grupo_opciones_id` por una relación muchos-a-muchos ordenada (`producto_grupos_opciones`), agregar `tipo_seleccion` (única/múltiple) a los grupos de opciones, y convertir `SelectorOpcionModal.jsx` en un asistente de pasos secuenciales — uno por grupo asignado al producto, en orden, cada uno opcional u obligatorio según se configure.

**Architecture:** Cambio de modelo de datos (migración + modelos Sequelize) propagado a través de `productos.service.js` (capa que ya maneja "reemplazar todo el set" para las `opciones` de un grupo — se aplica el mismo patrón para los grupos de un producto), la UI de administración (`ProductosPage.jsx`) y la UI de venta (`SelectorOpcionModal.jsx`). La elección final se sigue guardando como texto libre en `detalle_pedidos.nota` — cero cambios en comanda de cocina, tickets, o reportes.

**Tech Stack:** Node/Express + Sequelize + MariaDB (backend), React 18 + Vite (frontend), Jest/Supertest (tests backend, sin test runner en frontend).

## Global Constraints

- El backend SÍ tiene test runner (Jest); el frontend NO — su verificación es `npm run lint`/`npm run build` + inspección manual, ya documentado como restricción del proyecto.
- Los tests backend requieren una base de datos MySQL/MariaDB real y accesible; en el sandbox de esta sesión típicamente no lo está (`ECONNREFUSED`) — restricción de entorno ya establecida en trabajos anteriores de este proyecto. Si los tests no corren por falta de conexión, repórtalo así explícitamente; no lo trates como fallo de la tarea ni fabriques resultados.
- La forma final de la API para los grupos de un producto es: `grupos_opciones: [{ id, nombre, tipo_seleccion, orden, obligatorio, opciones: [{ id, nombre, orden }] }]`, siempre ordenado por `orden` ascendente (grupos entre sí, y opciones dentro de cada grupo). Esta forma la define exactamente Task 1 — Tasks 2 y 3 la consumen tal cual, no la reinterpretan.
- La elección final del cliente se sigue guardando como texto libre en `detalle_pedidos.nota` (columna existente, sin cambios de esquema ahí). No se crea ninguna tabla de "opciones elegidas por línea de pedido".
- Al quitar la columna `productos.grupo_opciones_id`, las asignaciones existentes (productos que ya tenían un grupo) se migran a la nueva tabla puente con `orden=0`, `obligatorio=0` — ningún producto pierde su configuración actual.
- Task 2 y Task 3 dependen de las asociaciones y el shape de API que define Task 1 — deben ejecutarse en orden, no en paralelo.

---

### Task 1: Migración de base de datos + modelos + servicio backend

**Files:**
- Create: `backend/database/migrations/019_opciones_multipaso.sql`
- Modify: `bd/bd_codeculinary.sql` (dump de desarrollo — debe reflejar el esquema final, mismo patrón ya usado en este proyecto para mantener el dump sincronizado con las migraciones)
- Modify: `backend/src/models/GrupoOpciones.js`
- Modify: `backend/src/models/Producto.js`
- Create: `backend/src/models/ProductoGrupoOpciones.js`
- Modify: `backend/src/models/index.js`
- Modify: `backend/src/modules/productos/productos.service.js`
- Modify: `backend/tests/productos.test.js`

**Interfaces:**
- Produce (para Task 2 y Task 3): el shape de API descrito en Global Constraints. `GET/POST/PUT /api/v1/productos` devuelve/acepta `grupos_opciones` como array; `POST/PUT /api/v1/grupos-opciones` acepta/devuelve `tipo_seleccion`.
- No consume nada de tareas anteriores (es la primera tarea).

- [ ] **Step 1: Crear la migración**

Crear `backend/database/migrations/019_opciones_multipaso.sql`:

```sql
ALTER TABLE grupos_opciones
  ADD COLUMN tipo_seleccion ENUM('unica','multiple') NOT NULL DEFAULT 'unica' AFTER nombre;

CREATE TABLE IF NOT EXISTS producto_grupos_opciones (
  producto_id INT UNSIGNED NOT NULL,
  grupo_opciones_id INT UNSIGNED NOT NULL,
  orden INT NOT NULL DEFAULT 0,
  obligatorio TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (producto_id, grupo_opciones_id),
  FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE,
  FOREIGN KEY (grupo_opciones_id) REFERENCES grupos_opciones(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Migrar asignaciones existentes (1 grupo por producto → orden 0, no obligatorio,
-- igual al comportamiento actual donde siempre se puede "agregar sin especificar")
INSERT INTO producto_grupos_opciones (producto_id, grupo_opciones_id, orden, obligatorio)
SELECT id, grupo_opciones_id, 0, 0 FROM productos WHERE grupo_opciones_id IS NOT NULL;

ALTER TABLE productos DROP FOREIGN KEY productos_ibfk_2;
ALTER TABLE productos DROP COLUMN grupo_opciones_id;
```

- [ ] **Step 2: Aplicar el mismo cambio de esquema al dump `bd/bd_codeculinary.sql`**

Este archivo es el dump de desarrollo que se importa para levantar la BD local — debe reflejar el esquema final (mismo patrón ya usado en este proyecto). Aplicar estos 5 reemplazos exactos (el archivo no tiene filas `INSERT INTO` para `productos`, `grupos_opciones` ni `opciones`, así que no hay datos que migrar en el dump, solo estructura):

**2a.** Reemplazar:
```sql
CREATE TABLE `grupos_opciones` (
  `id` int(10) UNSIGNED NOT NULL,
  `nombre` varchar(100) NOT NULL,
  `creado_en` timestamp NULL DEFAULT current_timestamp(),
  `actualizado_en` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```
por:
```sql
CREATE TABLE `grupos_opciones` (
  `id` int(10) UNSIGNED NOT NULL,
  `nombre` varchar(100) NOT NULL,
  `tipo_seleccion` enum('unica','multiple') NOT NULL DEFAULT 'unica',
  `creado_en` timestamp NULL DEFAULT current_timestamp(),
  `actualizado_en` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**2b.** Reemplazar:
```sql
CREATE TABLE `productos` (
  `id` int(10) UNSIGNED NOT NULL,
  `categoria_id` int(10) UNSIGNED NOT NULL,
  `grupo_opciones_id` int(10) UNSIGNED DEFAULT NULL,
  `nombre` varchar(255) NOT NULL,
```
por:
```sql
CREATE TABLE `productos` (
  `id` int(10) UNSIGNED NOT NULL,
  `categoria_id` int(10) UNSIGNED NOT NULL,
  `nombre` varchar(255) NOT NULL,
```

**2c.** Reemplazar (inserta la nueva tabla justo antes de `producto_stock_sucursal`):
```sql
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `creado_en` timestamp NOT NULL DEFAULT current_timestamp(),
  `actualizado_en` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `producto_stock_sucursal`
--

CREATE TABLE `producto_stock_sucursal` (
```
por:
```sql
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `creado_en` timestamp NOT NULL DEFAULT current_timestamp(),
  `actualizado_en` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `producto_grupos_opciones`
--

CREATE TABLE `producto_grupos_opciones` (
  `producto_id` int(10) UNSIGNED NOT NULL,
  `grupo_opciones_id` int(10) UNSIGNED NOT NULL,
  `orden` int(11) NOT NULL DEFAULT 0,
  `obligatorio` tinyint(1) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `producto_stock_sucursal`
--

CREATE TABLE `producto_stock_sucursal` (
```

**2d.** Reemplazar:
```sql
--
-- Indices de la tabla `productos`
--
ALTER TABLE `productos`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `productos_barcode_unique` (`codigo_barras`),
  ADD KEY `categoria_id` (`categoria_id`),
  ADD KEY `grupo_opciones_id` (`grupo_opciones_id`);

--
-- Indices de la tabla `producto_stock_sucursal`
--
ALTER TABLE `producto_stock_sucursal`
  ADD PRIMARY KEY (`producto_id`,`sucursal_id`),
  ADD KEY `sucursal_id` (`sucursal_id`);
```
por:
```sql
--
-- Indices de la tabla `productos`
--
ALTER TABLE `productos`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `productos_barcode_unique` (`codigo_barras`),
  ADD KEY `categoria_id` (`categoria_id`);

--
-- Indices de la tabla `producto_grupos_opciones`
--
ALTER TABLE `producto_grupos_opciones`
  ADD PRIMARY KEY (`producto_id`,`grupo_opciones_id`),
  ADD KEY `grupo_opciones_id` (`grupo_opciones_id`);

--
-- Indices de la tabla `producto_stock_sucursal`
--
ALTER TABLE `producto_stock_sucursal`
  ADD PRIMARY KEY (`producto_id`,`sucursal_id`),
  ADD KEY `sucursal_id` (`sucursal_id`);
```

**2e.** Reemplazar:
```sql
--
-- Filtros para la tabla `productos`
--
ALTER TABLE `productos`
  ADD CONSTRAINT `productos_ibfk_1` FOREIGN KEY (`categoria_id`) REFERENCES `categorias` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `productos_ibfk_2` FOREIGN KEY (`grupo_opciones_id`) REFERENCES `grupos_opciones` (`id`) ON DELETE SET NULL;

--
-- Filtros para la tabla `producto_stock_sucursal`
--
ALTER TABLE `producto_stock_sucursal`
  ADD CONSTRAINT `producto_stock_sucursal_ibfk_1` FOREIGN KEY (`producto_id`) REFERENCES `productos` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `producto_stock_sucursal_ibfk_2` FOREIGN KEY (`sucursal_id`) REFERENCES `sucursales` (`id`) ON DELETE CASCADE;
```
por:
```sql
--
-- Filtros para la tabla `productos`
--
ALTER TABLE `productos`
  ADD CONSTRAINT `productos_ibfk_1` FOREIGN KEY (`categoria_id`) REFERENCES `categorias` (`id`) ON DELETE CASCADE;

--
-- Filtros para la tabla `producto_grupos_opciones`
--
ALTER TABLE `producto_grupos_opciones`
  ADD CONSTRAINT `producto_grupos_opciones_ibfk_1` FOREIGN KEY (`producto_id`) REFERENCES `productos` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `producto_grupos_opciones_ibfk_2` FOREIGN KEY (`grupo_opciones_id`) REFERENCES `grupos_opciones` (`id`) ON DELETE CASCADE;

--
-- Filtros para la tabla `producto_stock_sucursal`
--
ALTER TABLE `producto_stock_sucursal`
  ADD CONSTRAINT `producto_stock_sucursal_ibfk_1` FOREIGN KEY (`producto_id`) REFERENCES `productos` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `producto_stock_sucursal_ibfk_2` FOREIGN KEY (`sucursal_id`) REFERENCES `sucursales` (`id`) ON DELETE CASCADE;
```

(No hace falta bloque `AUTO_INCREMENT` para `producto_grupos_opciones` — tiene PK compuesta, sin columna autoincremental, igual que `roles_permisos`/`usuarios_sucursales` en el mismo dump.)

- [ ] **Step 3: Actualizar el modelo `GrupoOpciones`**

Reemplazar el contenido completo de `backend/src/models/GrupoOpciones.js`:

```js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const GrupoOpciones = sequelize.define('GrupoOpciones', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  nombre: { type: DataTypes.STRING(100), allowNull: false },
  tipo_seleccion: { type: DataTypes.ENUM('unica', 'multiple'), allowNull: false, defaultValue: 'unica' },
}, {
  tableName: 'grupos_opciones',
  createdAt: 'creado_en',
  updatedAt: 'actualizado_en',
});

module.exports = GrupoOpciones;
```

- [ ] **Step 4: Quitar `grupo_opciones_id` del modelo `Producto`**

En `backend/src/models/Producto.js`, eliminar esta línea (la única que cambia):

```js
  grupo_opciones_id: { type: DataTypes.INTEGER.UNSIGNED },
```

- [ ] **Step 5: Crear el modelo `ProductoGrupoOpciones`**

Crear `backend/src/models/ProductoGrupoOpciones.js`:

```js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ProductoGrupoOpciones = sequelize.define('ProductoGrupoOpciones', {
  producto_id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true },
  grupo_opciones_id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true },
  orden: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  obligatorio: { type: DataTypes.TINYINT(1), allowNull: false, defaultValue: 0 },
}, {
  tableName: 'producto_grupos_opciones',
  timestamps: false,
});

module.exports = ProductoGrupoOpciones;
```

- [ ] **Step 6: Actualizar las asociaciones en `models/index.js`**

**6a.** Agregar el require, junto a los demás (después de la línea `const Opcion = require('./Opcion');`):

```js
const ProductoGrupoOpciones = require('./ProductoGrupoOpciones');
```

**6b.** Reemplazar el bloque "Opciones de producto":

```js
// Opciones de producto
GrupoOpciones.hasMany(Opcion, { foreignKey: 'grupo_opciones_id', as: 'opciones' });
Opcion.belongsTo(GrupoOpciones, { foreignKey: 'grupo_opciones_id', as: 'grupo' });
Producto.belongsTo(GrupoOpciones, { foreignKey: 'grupo_opciones_id', as: 'grupo_opciones' });
GrupoOpciones.hasMany(Producto, { foreignKey: 'grupo_opciones_id', as: 'productos' });
```

por:

```js
// Opciones de producto
GrupoOpciones.hasMany(Opcion, { foreignKey: 'grupo_opciones_id', as: 'opciones' });
Opcion.belongsTo(GrupoOpciones, { foreignKey: 'grupo_opciones_id', as: 'grupo' });
Producto.belongsToMany(GrupoOpciones, { through: ProductoGrupoOpciones, foreignKey: 'producto_id', otherKey: 'grupo_opciones_id', as: 'grupos_opciones' });
GrupoOpciones.belongsToMany(Producto, { through: ProductoGrupoOpciones, foreignKey: 'grupo_opciones_id', otherKey: 'producto_id', as: 'productos' });
```

**6c.** En `module.exports`, agregar `ProductoGrupoOpciones` junto a `GrupoOpciones, Opcion,`:

```js
  GrupoOpciones, Opcion, ProductoGrupoOpciones,
```

- [ ] **Step 7: Reescribir la sección de productos/grupos en `productos.service.js`**

Reemplazar el `require` del inicio del archivo:

```js
const { Categoria, Producto, Sucursal, GrupoOpciones, Opcion, DetallePedido } = require('../../models');
```

por:

```js
const { Categoria, Producto, Sucursal, GrupoOpciones, Opcion, ProductoGrupoOpciones, DetallePedido } = require('../../models');
```

Reemplazar la sección completa `// --- Grupos de opciones ---` (desde `async function listarGruposOpciones()` hasta el `}` que cierra `eliminarGrupoOpciones`, es decir todo el bloque actual de esa sección) por:

```js
// --- Grupos de opciones ---

async function listarGruposOpciones() {
  return GrupoOpciones.findAll({
    include: [{ model: Opcion, as: 'opciones', attributes: ['id', 'nombre', 'orden'] }],
    order: [['nombre', 'ASC'], [{ model: Opcion, as: 'opciones' }, 'orden', 'ASC']],
  });
}

async function _conOpciones(id, transaction) {
  return GrupoOpciones.findByPk(id, {
    include: [{ model: Opcion, as: 'opciones', attributes: ['id', 'nombre', 'orden'] }],
    order: [[{ model: Opcion, as: 'opciones' }, 'orden', 'ASC']],
    transaction,
  });
}

async function crearGrupoOpciones({ nombre, tipo_seleccion, opciones = [] }) {
  return sequelize.transaction(async (t) => {
    const grupo = await GrupoOpciones.create({ nombre, tipo_seleccion }, { transaction: t });
    if (opciones.length) {
      await Opcion.bulkCreate(
        opciones.map((o, i) => ({ grupo_opciones_id: grupo.id, nombre: o.nombre, orden: o.orden ?? i })),
        { transaction: t }
      );
    }
    return _conOpciones(grupo.id, t);
  });
}

async function actualizarGrupoOpciones(id, { nombre, tipo_seleccion, opciones = [] }) {
  return sequelize.transaction(async (t) => {
    const grupo = await GrupoOpciones.findByPk(id, { transaction: t });
    if (!grupo) throw Object.assign(new Error('Grupo de opciones no encontrado'), { status: 404 });
    await grupo.update({ nombre, tipo_seleccion }, { transaction: t });
    await Opcion.destroy({ where: { grupo_opciones_id: id }, transaction: t });
    if (opciones.length) {
      await Opcion.bulkCreate(
        opciones.map((o, i) => ({ grupo_opciones_id: id, nombre: o.nombre, orden: o.orden ?? i })),
        { transaction: t }
      );
    }
    return _conOpciones(id, t);
  });
}

async function eliminarGrupoOpciones(id) {
  const grupo = await GrupoOpciones.findByPk(id);
  if (!grupo) throw Object.assign(new Error('Grupo de opciones no encontrado'), { status: 404 });
  // producto_grupos_opciones tiene ON DELETE CASCADE en grupo_opciones_id: las
  // asignaciones de productos a este grupo se borran solas, no hace falta tocarlas a mano.
  await grupo.destroy();
}

async function _sincronizarGruposOpciones(producto_id, grupos_opciones = [], transaction) {
  const ids = grupos_opciones.map((g) => g.id);
  if (new Set(ids).size !== ids.length) {
    throw Object.assign(new Error('No se puede asignar el mismo grupo de opciones más de una vez'), { status: 400 });
  }
  await ProductoGrupoOpciones.destroy({ where: { producto_id }, transaction });
  if (grupos_opciones.length) {
    await ProductoGrupoOpciones.bulkCreate(
      grupos_opciones.map((g, i) => ({ producto_id, grupo_opciones_id: g.id, orden: g.orden ?? i, obligatorio: !!g.obligatorio })),
      { transaction }
    );
  }
}

function _normalizarGruposOpciones(producto) {
  if (Array.isArray(producto.grupos_opciones)) {
    producto.grupos_opciones = producto.grupos_opciones
      .map((g) => ({
        id: g.id,
        nombre: g.nombre,
        tipo_seleccion: g.tipo_seleccion,
        orden: g.ProductoGrupoOpciones?.orden ?? 0,
        obligatorio: !!g.ProductoGrupoOpciones?.obligatorio,
        opciones: [...(g.opciones ?? [])].sort((a, b) => a.orden - b.orden),
      }))
      .sort((a, b) => a.orden - b.orden);
  }
  return producto;
}
```

(`_sincronizarGruposOpciones` y `_normalizarGruposOpciones` son nuevas — se usan en los pasos siguientes de este mismo Step. El comentario dentro de `eliminarGrupoOpciones` reemplaza la línea `await Producto.update({ grupo_opciones_id: null }, ...)` que existía antes — esa línea se elimina porque la columna que actualizaba ya no existe.)

Ahora, dentro de la sección `// --- Productos ---`, hacer estos 4 reemplazos:

**7a.** En `listarProductos`, reemplazar el `include` de grupo de opciones:

```js
      { model: GrupoOpciones, as: 'grupo_opciones', attributes: ['id', 'nombre'],
        include: [{ model: Opcion, as: 'opciones', attributes: ['id', 'nombre', 'orden'] }] },
    ],
    order,
  });

  const conStock = await mezclarStockPorSucursal(productos, alcance);

  if (solo_disponibles === 'true' || solo_disponibles === true) {
    return conStock.filter((p) => p.stock === null || p.stock > 0);
  }
  return conStock;
}
```

por:

```js
      { model: GrupoOpciones, as: 'grupos_opciones', attributes: ['id', 'nombre', 'tipo_seleccion'],
        through: { attributes: ['orden', 'obligatorio'] },
        include: [{ model: Opcion, as: 'opciones', attributes: ['id', 'nombre', 'orden'] }] },
    ],
    order,
  });

  const conStock = await mezclarStockPorSucursal(productos, alcance);
  conStock.forEach(_normalizarGruposOpciones);

  if (solo_disponibles === 'true' || solo_disponibles === true) {
    return conStock.filter((p) => p.stock === null || p.stock > 0);
  }
  return conStock;
}
```

**7b.** En `obtenerProducto`, reemplazar:

```js
async function obtenerProducto(id, alcance) {
  const p = await Producto.findByPk(id, {
    include: [
      { model: Categoria, as: 'categoria', attributes: ['id', 'nombre'] },
      { model: GrupoOpciones, as: 'grupo_opciones', attributes: ['id', 'nombre'],
        include: [{ model: Opcion, as: 'opciones', attributes: ['id', 'nombre', 'orden'] }] },
    ],
  });
  if (!p) throw Object.assign(new Error('Producto no encontrado'), { status: 404 });
  const [conStock] = await mezclarStockPorSucursal([p], alcance);
  return conStock;
}
```

por:

```js
async function obtenerProducto(id, alcance) {
  const p = await Producto.findByPk(id, {
    include: [
      { model: Categoria, as: 'categoria', attributes: ['id', 'nombre'] },
      { model: GrupoOpciones, as: 'grupos_opciones', attributes: ['id', 'nombre', 'tipo_seleccion'],
        through: { attributes: ['orden', 'obligatorio'] },
        include: [{ model: Opcion, as: 'opciones', attributes: ['id', 'nombre', 'orden'] }] },
    ],
  });
  if (!p) throw Object.assign(new Error('Producto no encontrado'), { status: 404 });
  const [conStock] = await mezclarStockPorSucursal([p], alcance);
  return _normalizarGruposOpciones(conStock);
}
```

**7c.** En `crearProducto`, reemplazar:

```js
async function crearProducto({ categoria_id, nombre, codigo_barras, codigo, precio, costo, stock, sucursal_id, es_vendible, imagen, grupo_opciones_id, es_pesable }, alcance) {
  let sucursalDestino;
  const conStock = stock !== undefined && stock !== null;

  if (conStock) {
    sucursalDestino = alcance.acceso_todas ? sucursal_id : alcance.sucursal_id;
    if (alcance.acceso_todas && !sucursalDestino) {
      throw Object.assign(new Error('sucursal_id es requerido para asignar stock inicial'), { status: 400 });
    }
    if (alcance.acceso_todas) {
      const existe = await Sucursal.findByPk(sucursalDestino);
      if (!existe) throw Object.assign(new Error('Sucursal no encontrada'), { status: 404 });
    }
  }

  const producto = await Producto.create({ categoria_id, nombre, codigo_barras, codigo, precio, costo, stock: conStock ? 0 : null, es_vendible, imagen, grupo_opciones_id, es_pesable });

  if (conStock) {
    await ajustarStockSucursal({ producto_id: producto.id, sucursal_id: sucursalDestino, tipo: 'ajuste', cantidad: stock, usuario_id: alcance.usuario_id, nota: 'Stock inicial' });
  }

  return obtenerProducto(producto.id, alcance);
}
```

por:

```js
async function crearProducto({ categoria_id, nombre, codigo_barras, codigo, precio, costo, stock, sucursal_id, es_vendible, imagen, grupos_opciones, es_pesable }, alcance) {
  let sucursalDestino;
  const conStock = stock !== undefined && stock !== null;

  if (conStock) {
    sucursalDestino = alcance.acceso_todas ? sucursal_id : alcance.sucursal_id;
    if (alcance.acceso_todas && !sucursalDestino) {
      throw Object.assign(new Error('sucursal_id es requerido para asignar stock inicial'), { status: 400 });
    }
    if (alcance.acceso_todas) {
      const existe = await Sucursal.findByPk(sucursalDestino);
      if (!existe) throw Object.assign(new Error('Sucursal no encontrada'), { status: 404 });
    }
  }

  const producto = await Producto.create({ categoria_id, nombre, codigo_barras, codigo, precio, costo, stock: conStock ? 0 : null, es_vendible, imagen, es_pesable });
  await _sincronizarGruposOpciones(producto.id, grupos_opciones);

  if (conStock) {
    await ajustarStockSucursal({ producto_id: producto.id, sucursal_id: sucursalDestino, tipo: 'ajuste', cantidad: stock, usuario_id: alcance.usuario_id, nota: 'Stock inicial' });
  }

  return obtenerProducto(producto.id, alcance);
}
```

**7d.** En `actualizarProducto`, reemplazar:

```js
async function actualizarProducto(id, datos, alcance) {
  const { stock, ...resto } = datos; // stock nunca se edita aquí — solo vía ajustarStockSucursal
  const p = await Producto.findByPk(id);
  if (!p) throw Object.assign(new Error('Producto no encontrado'), { status: 404 });
  await p.update(resto);
  return obtenerProducto(id, alcance);
}
```

por:

```js
async function actualizarProducto(id, datos, alcance) {
  const { stock, grupos_opciones, ...resto } = datos; // stock nunca se edita aquí — solo vía ajustarStockSucursal
  const p = await Producto.findByPk(id);
  if (!p) throw Object.assign(new Error('Producto no encontrado'), { status: 404 });
  await p.update(resto);
  if (grupos_opciones !== undefined) {
    await _sincronizarGruposOpciones(id, grupos_opciones);
  }
  return obtenerProducto(id, alcance);
}
```

- [ ] **Step 8: Actualizar los tests existentes de grupo de opciones**

En `backend/tests/productos.test.js`, reemplazar el bloque completo `describe('Productos — grupo de opciones', ...)` (líneas 159-206 del archivo original) por:

```js
describe('Productos — grupos de opciones', () => {
  let categoriaId, grupoSaborId, grupoExtraId, adminToken;

  beforeAll(async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'admin@restaurante.com', contrasena: process.env.ADMIN_PASSWORD || 'admin123' });
    adminToken = login.body.datos.token;

    const categoria = await Categoria.create({ nombre: 'Categoria Grupo Opciones Productos Test' });
    categoriaId = categoria.id;

    const grupoSabor = await GrupoOpciones.create({ nombre: 'Sabor Productos Test', tipo_seleccion: 'unica' });
    await Opcion.create({ grupo_opciones_id: grupoSabor.id, nombre: 'Chocolate', orden: 0 });
    await Opcion.create({ grupo_opciones_id: grupoSabor.id, nombre: 'Vainilla', orden: 1 });
    grupoSaborId = grupoSabor.id;

    const grupoExtra = await GrupoOpciones.create({ nombre: 'Extra Productos Test', tipo_seleccion: 'multiple' });
    await Opcion.create({ grupo_opciones_id: grupoExtra.id, nombre: 'Maní', orden: 0 });
    grupoExtraId = grupoExtra.id;
  });

  afterAll(async () => {
    await Producto.destroy({ where: { categoria_id: categoriaId } });
    await Categoria.destroy({ where: { id: categoriaId } });
    await Opcion.destroy({ where: { grupo_opciones_id: [grupoSaborId, grupoExtraId] } });
    await GrupoOpciones.destroy({ where: { id: [grupoSaborId, grupoExtraId] } });
  });

  it('crea un producto con varios grupos ordenados y los devuelve ordenados con tipo_seleccion y obligatorio', async () => {
    const crear = await request(app)
      .post('/api/v1/productos')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        categoria_id: categoriaId, nombre: 'Bubba Test', precio: 15,
        grupos_opciones: [
          { id: grupoExtraId, orden: 1, obligatorio: false },
          { id: grupoSaborId, orden: 0, obligatorio: true },
        ],
      });

    expect(crear.status).toBe(201);
    const grupos = crear.body.datos.grupos_opciones;
    expect(grupos.map(g => g.id)).toEqual([grupoSaborId, grupoExtraId]); // ordenado por 'orden', no por el orden en que se enviaron
    expect(grupos[0].tipo_seleccion).toBe('unica');
    expect(grupos[0].obligatorio).toBe(true);
    expect(grupos[0].opciones.map(o => o.nombre)).toEqual(['Chocolate', 'Vainilla']);
    expect(grupos[1].tipo_seleccion).toBe('multiple');
    expect(grupos[1].obligatorio).toBe(false);
  });

  it('GET /productos/:id devuelve los mismos grupos ordenados', async () => {
    const crear = await request(app)
      .post('/api/v1/productos')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ categoria_id: categoriaId, nombre: 'Bubba Consulta Test', precio: 15, grupos_opciones: [{ id: grupoSaborId, orden: 0, obligatorio: false }] });

    const obtener = await request(app)
      .get(`/api/v1/productos/${crear.body.datos.id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(obtener.status).toBe(200);
    expect(obtener.body.datos.grupos_opciones.map(g => g.id)).toEqual([grupoSaborId]);
  });

  it('actualizar un producto reemplaza el set completo de grupos', async () => {
    const crear = await request(app)
      .post('/api/v1/productos')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ categoria_id: categoriaId, nombre: 'Producto Reemplazo Grupos Test', precio: 10, grupos_opciones: [{ id: grupoSaborId, orden: 0, obligatorio: false }] });

    const editar = await request(app)
      .put(`/api/v1/productos/${crear.body.datos.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ grupos_opciones: [{ id: grupoExtraId, orden: 0, obligatorio: true }] });

    expect(editar.status).toBe(200);
    expect(editar.body.datos.grupos_opciones.map(g => g.id)).toEqual([grupoExtraId]);
  });

  it('rechaza asignar el mismo grupo dos veces', async () => {
    const res = await request(app)
      .post('/api/v1/productos')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        categoria_id: categoriaId, nombre: 'Producto Grupo Duplicado Test', precio: 10,
        grupos_opciones: [{ id: grupoSaborId, orden: 0 }, { id: grupoSaborId, orden: 1 }],
      });
    expect(res.status).toBe(400);
  });

  it('un producto sin grupos asignados devuelve grupos_opciones vacío', async () => {
    const crear = await request(app)
      .post('/api/v1/productos')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ categoria_id: categoriaId, nombre: 'Producto Sin Grupos Test', precio: 20 });

    expect(crear.body.datos.grupos_opciones).toEqual([]);
  });

  it('borrar un grupo de opciones quita la asignación del producto sin borrar el producto', async () => {
    const grupoTemp = await GrupoOpciones.create({ nombre: 'Grupo Temporal Test', tipo_seleccion: 'unica' });
    const crear = await request(app)
      .post('/api/v1/productos')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ categoria_id: categoriaId, nombre: 'Producto Con Grupo Temporal Test', precio: 10, grupos_opciones: [{ id: grupoTemp.id, orden: 0 }] });

    await request(app).delete(`/api/v1/grupos-opciones/${grupoTemp.id}`).set('Authorization', `Bearer ${adminToken}`);

    const obtener = await request(app).get(`/api/v1/productos/${crear.body.datos.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(obtener.status).toBe(200);
    expect(obtener.body.datos.grupos_opciones).toEqual([]);

    const productoEnBd = await Producto.findByPk(crear.body.datos.id);
    expect(productoEnBd).not.toBeNull();
  });
});
```

- [ ] **Step 9: Correr los tests**

Run: `cd backend && npx jest tests/productos.test.js --runInBand`

Expected: todos los tests de `productos.test.js` pasan (incluyendo los ya existentes, que no deben romperse). Si falla por `ECONNREFUSED` u otro error de conexión a MySQL/MariaDB, es la limitación de entorno ya documentada — repórtalo tal cual, con el mensaje de error exacto, en vez de forzar un resultado. Si la base de datos SÍ está accesible pero no tiene la migración `019_opciones_multipaso.sql` aplicada, aplícala primero (`mysql -h 127.0.0.1 -P 3306 --protocol=TCP -u root <nombre_bd> < backend/database/migrations/019_opciones_multipaso.sql`) y vuelve a correr los tests.

- [ ] **Step 10: Commit**

```bash
git add backend/database/migrations/019_opciones_multipaso.sql bd/bd_codeculinary.sql backend/src/models/GrupoOpciones.js backend/src/models/Producto.js backend/src/models/ProductoGrupoOpciones.js backend/src/models/index.js backend/src/modules/productos/productos.service.js backend/tests/productos.test.js
git commit -m "feat(productos): migrar grupo_opciones_id a relación muchos-a-muchos con tipo_seleccion y obligatorio"
```

---

### Task 2: Admin — tipo de selección por grupo + asignación de varios grupos por producto

**Files:**
- Modify: `frontend/src/pages/productos/ProductosPage.jsx`

**Interfaces:**
- Consumes: el shape de API definido en Task 1 — `producto.grupos_opciones: [{ id, nombre, tipo_seleccion, orden, obligatorio, opciones }]`, y que `POST`/`PUT /productos` aceptan `grupos_opciones: [{ id, orden, obligatorio }]`; que `POST`/`PUT /grupos-opciones` aceptan `tipo_seleccion`.
- No produce interfaces nuevas para otras tareas — Task 3 no depende de este archivo.

- [ ] **Step 1: `FormGrupoOpcionesModal` — agregar selector de tipo de selección**

En `frontend/src/pages/productos/ProductosPage.jsx`, dentro de `FormGrupoOpcionesModal`, reemplazar:

```jsx
function FormGrupoOpcionesModal({ grupo, onClose, onGuardar, guardando, error }) {
  const [nombre, setNombre] = useState(grupo?.nombre ?? '');
  const [opciones, setOpciones] = useState(
    grupo?.opciones?.length ? grupo.opciones.map(o => ({ nombre: o.nombre })) : [{ nombre: '' }]
  );
```

por:

```jsx
function FormGrupoOpcionesModal({ grupo, onClose, onGuardar, guardando, error }) {
  const [nombre, setNombre] = useState(grupo?.nombre ?? '');
  const [tipoSeleccion, setTipoSeleccion] = useState(grupo?.tipo_seleccion ?? 'unica');
  const [opciones, setOpciones] = useState(
    grupo?.opciones?.length ? grupo.opciones.map(o => ({ nombre: o.nombre })) : [{ nombre: '' }]
  );
```

- [ ] **Step 2: Incluir `tipo_seleccion` al guardar**

Reemplazar:

```jsx
  function handleGuardar() {
    const opcionesValidas = opciones
      .map(o => o.nombre.trim())
      .filter(Boolean)
      .map((nombre, orden) => ({ nombre, orden }));
    onGuardar({ nombre, opciones: opcionesValidas });
  }
```

por:

```jsx
  function handleGuardar() {
    const opcionesValidas = opciones
      .map(o => o.nombre.trim())
      .filter(Boolean)
      .map((nombre, orden) => ({ nombre, orden }));
    onGuardar({ nombre, tipo_seleccion: tipoSeleccion, opciones: opcionesValidas });
  }
```

- [ ] **Step 3: Agregar el selector visual de tipo de selección**

Reemplazar:

```jsx
        <div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Nombre del grupo</label>
          <input
            autoFocus
            value={nombre}
            onChange={e => setNombre(e.target.value)}
            placeholder="Ej: Término de cocción, Sabor"
            className="w-full bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Opciones</label>
```

por:

```jsx
        <div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Nombre del grupo</label>
          <input
            autoFocus
            value={nombre}
            onChange={e => setNombre(e.target.value)}
            placeholder="Ej: Término de cocción, Sabor"
            className="w-full bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Tipo de selección</label>
          <div className="grid grid-cols-2 gap-2">
            {[{ id: 'unica', label: 'Única (elige una)' }, { id: 'multiple', label: 'Múltiple (elige varias)' }].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTipoSeleccion(t.id)}
                className={`py-2.5 rounded-xl text-sm font-medium border transition-colors ${
                  tipoSeleccion === t.id
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-blue-400 dark:hover:border-blue-500'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Opciones</label>
```

- [ ] **Step 4: `FormProductoModal` — estado inicial con lista de grupos en vez de un solo id**

Reemplazar:

```jsx
    grupo_opciones_id: prod?.grupo_opciones?.id ?? '',
```

por:

```jsx
    grupos_opciones: prod?.grupos_opciones?.map(g => ({ id: g.id, nombre: g.nombre, obligatorio: !!g.obligatorio })) ?? [],
```

(Esta línea está dentro del objeto inicial de `useState(...)` en `FormProductoModal` — las demás claves de ese objeto no cambian.)

- [ ] **Step 5: Funciones para agregar/quitar/reordenar/marcar obligatorio un grupo**

Justo después de esta línea existente (déjala igual, agrega las funciones nuevas a continuación):

```jsx
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
```

agregar:

```jsx

  function agregarGrupo(grupoId) {
    const grupo = gruposOpciones.find(g => g.id === parseInt(grupoId));
    if (!grupo) return;
    set('grupos_opciones', [...form.grupos_opciones, { id: grupo.id, nombre: grupo.nombre, obligatorio: false }]);
  }

  function quitarGrupo(i) {
    setForm(f => ({ ...f, grupos_opciones: f.grupos_opciones.filter((_, idx) => idx !== i) }));
  }

  function moverGrupo(i, direccion) {
    setForm(f => {
      const destino = i + direccion;
      if (destino < 0 || destino >= f.grupos_opciones.length) return f;
      const copia = [...f.grupos_opciones];
      [copia[i], copia[destino]] = [copia[destino], copia[i]];
      return { ...f, grupos_opciones: copia };
    });
  }

  function toggleObligatorioGrupo(i) {
    setForm(f => ({
      ...f,
      grupos_opciones: f.grupos_opciones.map((g, idx) => idx === i ? { ...g, obligatorio: !g.obligatorio } : g),
    }));
  }
```

- [ ] **Step 6: Incluir `grupos_opciones` al guardar el producto**

Reemplazar:

```jsx
    const datos = {
      categoria_id: parseInt(form.categoria_id),
      grupo_opciones_id: form.grupo_opciones_id ? parseInt(form.grupo_opciones_id) : null,
      nombre: form.nombre,
      precio: parseFloat(form.precio),
      es_vendible: form.es_vendible,
      es_pesable: form.es_pesable,
      imagen: form.imagen,
    };
```

por:

```jsx
    const datos = {
      categoria_id: parseInt(form.categoria_id),
      grupos_opciones: form.grupos_opciones.map((g, orden) => ({ id: g.id, orden, obligatorio: g.obligatorio })),
      nombre: form.nombre,
      precio: parseFloat(form.precio),
      es_vendible: form.es_vendible,
      es_pesable: form.es_pesable,
      imagen: form.imagen,
    };
```

- [ ] **Step 7: Reemplazar el `<select>` único por la lista ordenable**

Reemplazar:

```jsx
          <div className="col-span-2">
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Grupo de opciones</label>
            <select
              value={form.grupo_opciones_id}
              onChange={e => set('grupo_opciones_id', e.target.value)}
              className="w-full bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Ninguno</option>
              {gruposOpciones.map(g => <option key={g.id} value={g.id}>{g.nombre}</option>)}
            </select>
          </div>
```

por:

```jsx
          <div className="col-span-2">
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Grupos de opciones</label>
            <div className="space-y-2">
              {form.grupos_opciones.map((g, i) => (
                <div key={g.id} className="flex items-center gap-1.5 bg-gray-50 dark:bg-gray-700/50 rounded-xl px-3 py-2">
                  <span className="flex-1 text-sm text-gray-700 dark:text-gray-200 min-w-0 truncate">{i + 1}. {g.nombre}</span>
                  <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 shrink-0">
                    <input
                      type="checkbox"
                      checked={g.obligatorio}
                      onChange={() => toggleObligatorioGrupo(i)}
                      className="w-3.5 h-3.5 rounded accent-blue-600"
                    />
                    Obligatorio
                  </label>
                  <button type="button" onClick={() => moverGrupo(i, -1)} disabled={i === 0} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-30 transition-colors">
                    <ChevronUp className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={() => moverGrupo(i, 1)} disabled={i === form.grupos_opciones.length - 1} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-30 transition-colors">
                    <ChevronDown className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={() => quitarGrupo(i)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            {gruposOpciones.filter(g => !form.grupos_opciones.some(fg => fg.id === g.id)).length > 0 && (
              <select
                value=""
                onChange={e => { if (e.target.value) agregarGrupo(e.target.value); }}
                className="mt-2 w-full bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">+ Agregar grupo...</option>
                {gruposOpciones.filter(g => !form.grupos_opciones.some(fg => fg.id === g.id)).map(g => (
                  <option key={g.id} value={g.id}>{g.nombre}</option>
                ))}
              </select>
            )}
          </div>
```

- [ ] **Step 8: Verificar lint y build**

Run: `cd frontend && npm run lint` — 0 errores nuevos en `ProductosPage.jsx`.
Run: `cd frontend && npm run build` — si falla, debe ser exactamente por el problema preexistente y no relacionado de `VentasPage.jsx`/`api/ventas.js` (`reimprimirVenta`), no por nada de este archivo. Verifícalo leyendo el mensaje de error.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/productos/ProductosPage.jsx
git commit -m "feat(productos): admin de tipo de selección por grupo y varios grupos por producto"
```

---

### Task 3: Venta — asistente de pasos secuenciales

**Files:**
- Modify: `frontend/src/pages/ventas/components/SelectorOpcionModal.jsx` (reescritura completa)
- Modify: `frontend/src/pages/ventas/VentasPage.jsx`

**Interfaces:**
- Consumes: el shape de API definido en Task 1 — `producto.grupos_opciones: [{ id, nombre, tipo_seleccion, orden, obligatorio, opciones }]`, ya ordenado por `orden` (Task 1 lo garantiza — este componente no necesita reordenar nada).
- No depende de Task 2.

- [ ] **Step 1: Reescribir `SelectorOpcionModal.jsx`**

Reemplazar el contenido completo de `frontend/src/pages/ventas/components/SelectorOpcionModal.jsx`:

```jsx
import { useState, useEffect } from 'react';
import Modal from '../../../components/ui/Modal';

export default function SelectorOpcionModal({ producto, onElegir, onClose }) {
  const grupos = producto.grupos_opciones ?? [];
  const [paso, setPaso] = useState(0);
  const [selecciones, setSelecciones] = useState({}); // { [grupoId]: string[] }
  const [multipleElegidas, setMultipleElegidas] = useState([]);

  useEffect(() => {
    setMultipleElegidas([]);
  }, [paso]);

  const grupoActual = grupos[paso];
  const esUltimoPaso = paso === grupos.length - 1;

  function construirNotaFinal(seleccionesFinales) {
    const partes = grupos
      .map((g) => {
        const elegidas = seleccionesFinales[g.id] ?? [];
        if (elegidas.length === 0) return null;
        return `${g.nombre}: ${elegidas.join(', ')}`;
      })
      .filter(Boolean);
    return partes.length > 0 ? partes.join(' · ') : null;
  }

  function avanzar(seleccionesActualizadas) {
    if (esUltimoPaso) {
      onElegir(construirNotaFinal(seleccionesActualizadas));
    } else {
      setSelecciones(seleccionesActualizadas);
      setPaso((p) => p + 1);
    }
  }

  function elegirUnica(opcionNombre) {
    avanzar({ ...selecciones, [grupoActual.id]: [opcionNombre] });
  }

  function saltarPaso() {
    avanzar({ ...selecciones, [grupoActual.id]: [] });
  }

  function toggleMultiple(opcionNombre) {
    setMultipleElegidas((prev) =>
      prev.includes(opcionNombre) ? prev.filter((o) => o !== opcionNombre) : [...prev, opcionNombre]
    );
  }

  function confirmarMultiple() {
    avanzar({ ...selecciones, [grupoActual.id]: multipleElegidas });
  }

  return (
    <Modal titulo={`${producto.nombre} — ${grupoActual.nombre}`} onClose={onClose}>
      <div className="space-y-4">
        {grupos.length > 1 && (
          <p className="text-xs text-gray-400">Paso {paso + 1} de {grupos.length}</p>
        )}

        {grupoActual.tipo_seleccion === 'multiple' ? (
          <>
            <div className="flex flex-wrap gap-2">
              {grupoActual.opciones.map((opcion) => (
                <button
                  key={opcion.id}
                  type="button"
                  onClick={() => toggleMultiple(opcion.nombre)}
                  className={`px-4 py-2 rounded-full text-sm font-semibold border transition-all ${
                    multipleElegidas.includes(opcion.nombre)
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-blue-400 dark:hover:border-blue-500'
                  }`}
                >
                  {opcion.nombre}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={confirmarMultiple}
              className="w-full px-4 py-2 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors"
            >
              {esUltimoPaso ? 'Agregar' : 'Continuar'}
            </button>
          </>
        ) : (
          <div className="flex flex-wrap gap-2">
            {grupoActual.opciones.map((opcion) => (
              <button
                key={opcion.id}
                type="button"
                onClick={() => elegirUnica(opcion.nombre)}
                className="px-4 py-2 rounded-full text-sm font-semibold bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-blue-400 dark:hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400 transition-all"
              >
                {opcion.nombre}
              </button>
            ))}
          </div>
        )}

        {!grupoActual.obligatorio && (
          <button
            type="button"
            onClick={saltarPaso}
            className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            Saltar este paso
          </button>
        )}
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Actualizar la condición en `VentasPage.jsx`**

En `frontend/src/pages/ventas/VentasPage.jsx`, dentro de `handleProducto`, reemplazar:

```jsx
    if (prod.grupo_opciones) {
      setSelectorOpcion(prod);
      return;
    }
```

por:

```jsx
    if (prod.grupos_opciones?.length > 0) {
      setSelectorOpcion(prod);
      return;
    }
```

- [ ] **Step 3: Verificar lint y build**

Run: `cd frontend && npm run lint` — 0 errores nuevos en `SelectorOpcionModal.jsx`/`VentasPage.jsx`.
Run: `cd frontend && npm run build` — mismo criterio que en Task 2: si falla, debe ser por el problema preexistente de `reimprimirVenta`, no por este cambio.

- [ ] **Step 4: Verificación manual (queda pendiente para el usuario)**

No hay navegador disponible para verificar esto en un subagente. Documenta en el reporte que falta confirmar manualmente:
1. Un producto con un solo grupo de tipo única sigue funcionando como antes (elegir una opción o "Saltar este paso" agrega sin especificar).
2. Un producto con 2 grupos (uno única, uno múltiple) muestra "Paso 1 de 2" → "Paso 2 de 2", y el texto final combina ambos con ` · `.
3. Un producto sin ningún grupo asignado se agrega directo al carrito sin abrir el modal (comportamiento sin cambios).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/ventas/components/SelectorOpcionModal.jsx frontend/src/pages/ventas/VentasPage.jsx
git commit -m "feat(ventas): asistente de pasos secuenciales para opciones de producto multi-grupo"
```
