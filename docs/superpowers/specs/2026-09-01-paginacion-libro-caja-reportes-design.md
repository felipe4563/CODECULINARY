# Paginación en Libro de Caja y Reportes — Diseño

## Contexto

Cinco listados del sistema traen **todo** el rango de fechas seleccionado en una sola consulta, sin límite:

| Listado | Endpoint actual | Servicio | Modelo base |
|---|---|---|---|
| Libro de Caja | `GET /libro-caja` | `backend/src/modules/libro_caja/libro_caja.service.js` → `listar()` | `LibroCaja` |
| Reportes → Ventas | `GET /reportes/ventas` | `backend/src/modules/reportes/reportes.service.js` → `ventas()` | `Pedido` (+ `DetallePedido`, `Opcion`) |
| Reportes → Compras | `GET /reportes/compras` | `reportes.service.js` → `compras()` | `Compra` |
| Reportes → Inventario | `GET /reportes/inventario` | `reportes.service.js` → `inventario()` | `RegistroInventario` |
| Reportes → Caja | `GET /reportes/caja` | `reportes.service.js` → `caja()` | `LibroCaja` (todas las sucursales) |

El frontend (`LibroCajaPage.jsx` y las 5 pestañas en `frontend/src/pages/reportes/tabs/`) trae ese array completo con `useQuery`, y luego en el navegador: filtra (texto, tipo, cajero, método de pago, sucursal para admins), calcula totales/estadísticas, arma las opciones de los `<select>` de filtro, y arma las filas del PDF. Sin límite de fila ni paginación, esto crece sin techo con el historial del negocio y cada fetch/refetch mueve datasets cada vez más pesados.

Caso aparte: dentro de Reportes → Ventas, dos pestañas (`TabProductos.jsx`, `TabVariantes.jsx`) no muestran los pedidos en sí — muestran un ranking (top productos / top variantes) que hoy se calcula sumando en JavaScript sobre el mismo array completo de pedidos que usa `TabVentas.jsx`. El problema ahí no es "paginar filas", es que se trae cada pedido individual solo para sumarlo — el trabajo debería hacerlo la base de datos.

## Objetivo

1. Que ningún listado dependa de traer el historial completo a memoria: paginación real (`LIMIT`/`OFFSET`) en los endpoints que devuelven filas.
2. Que los totales/estadísticas y las opciones de los filtros (cajeros, sucursales) se calculen con SQL (`SUM`, `COUNT`, `DISTINCT`), no sumando arrays en el navegador.
3. Que los filtros que hoy son client-side (tipo, cajero, método de pago, búsqueda de texto, estado, origen) pasen a ser query params reales del backend — dejan de tener sentido como filtro-sobre-array cuando el array ya no está completo en memoria.
4. Que "Exportar PDF" siga exportando **todo** el rango filtrado, no solo la página visible.

**Fuera de alcance:** diseño visual de tarjetas/tablas (no cambia), y cualquier reestructuración de los modelos de datos existentes.

## Parte 1 — Contrato común de paginación

Los cinco endpoints que devuelven **filas** (Libro de Caja, Ventas, Compras, Inventario, Caja) suman dos query params:

- `pagina` (entero, default `1`)
- `limite` (entero, default `20`, tope `100`) — con un valor especial: **`limite=0` significa "sin límite"**, salta `LIMIT`/`OFFSET` y devuelve todas las filas del filtro. Reservado para el botón "Exportar PDF" (ver Parte 4) — no se expone como opción en el selector de tamaño de página del frontend.

Respuesta (reemplaza el actual `datos: [...]` plano):

```json
{
  "ok": true,
  "datos": {
    "filas": [ /* mismo shape de fila que hoy */ ],
    "pagina": 1,
    "limite": 20,
    "total": 543,
    "total_paginas": 28
  }
}
```

Implementación: cada `listar()`/`ventas()`/`compras()`/`inventario()`/`caja()` pasa de `Modelo.findAll(...)` a `Modelo.findAndCountAll({ ..., limit: limite || undefined, offset: limite ? (pagina - 1) * limite : undefined })`, y devuelve `{ filas: rows, pagina, limite, total: count, total_paginas: limite ? Math.ceil(count / limite) : 1 }`.

## Parte 2 — Endpoint de resumen (uno nuevo por módulo)

Nuevo endpoint por módulo, mismos filtros de fecha/sucursal que el listado pero **sin** `pagina`/`limite`:

- `GET /libro-caja/resumen`
- `GET /reportes/ventas/resumen`
- `GET /reportes/compras/resumen`
- `GET /reportes/inventario/resumen`
- `GET /reportes/caja/resumen`

Reemplaza lo que hoy se calcula en el navegador. Ejemplo de forma de respuesta (Libro de Caja):

```json
{
  "ok": true,
  "datos": {
    "total_ingresos": 12345.50,
    "total_egresos": 3210.00,
    "cantidad": 543,
    "filtros": {
      "cajeros": [{ "id": 1, "nombre": "Ana" }],
      "sucursales": [{ "id": 1, "nombre": "Centro" }]
    }
  }
}
```

Cada módulo define sus propios campos de totales (ver Parte 3), pero todos comparten el bloque `filtros` con las listas para poblar los `<select>` — construidas con `DISTINCT` sobre los datos ya filtrados por fecha/sucursal/alcance, no sobre el catálogo completo de usuarios/sucursales del sistema (si en un rango de fechas dado ningún egreso lo cargó "Juan", "Juan" no debería aparecer en el filtro de cajeros de ese rango).

El frontend pide este endpoint **solo cuando cambian los filtros de fecha/tipo/etc.**, no en cada cambio de página — así el costo de "recalcular totales" no se repite al navegar entre páginas.

## Parte 3 — Filtros server-side y totales por módulo

### Libro de Caja (`backend/src/modules/libro_caja/`)

- Filtros nuevos: `tipo` (`ingreso`/`egreso`), `busqueda` (texto libre — hoy busca en `concepto`, `usuario.nombre`, `metodo_pago` en el navegador; pasa a `Op.or` con `Op.like` sobre `concepto` y `metodo_pago`, más un `$usuario.nombre$` en el `where` del include para el nombre del cajero).
- `resumen`: `total_ingresos`, `total_egresos`, `cantidad`, `filtros.cajeros` (usuarios con al menos un movimiento en el rango), `filtros.sucursales` (solo si `alcance.acceso_todas`, vía las sesiones de caja del rango — mismo criterio de "sin sesión cuenta igual" que ya usa `listar()`).

### Reportes → Ventas (`backend/src/modules/reportes/`)

Ventas se divide en **tres** salidas porque hoy alimenta tres pestañas con necesidades distintas:

1. **`GET /reportes/ventas`** (paginado) — sigue devolviendo pedidos con sus `detalles` incluidos, para `TabVentas.jsx`. Filtros nuevos: `usuario_id` (cajero), `metodo_pago`, `tipo` (mesa/llevar), `origen` (staff/autoservicio).
2. **`GET /reportes/ventas/resumen`** — totales (ventas efectivo/QR, cantidad de pedidos) + `filtros.cajeros`, `filtros.sucursales` (mismos filtros de fecha/sucursal/origen/etc. aplicados).
3. **`GET /reportes/ventas/productos`** (nuevo, para `TabProductos.jsx`) — ranking agrupado en SQL por `producto_id`/`combo_id` (`SUM(cantidad)`, `SUM(cantidad * precio)`), ordenado por cantidad descendente. Reemplaza el `useMemo` que hoy suma en JS sobre el array completo.
4. **`GET /reportes/ventas/variantes`** (nuevo, para `TabVariantes.jsx`) — ranking agrupado por producto/combo **y** por la combinación exacta de opciones elegidas (lo que hoy `claveVariante(d)` arma en JS concatenando `producto_id`/`combo_id` + ids de opciones ordenados). Es el caso más delicado del diseño: agrupar por "el conjunto de opciones de esta fila" no es un `GROUP BY` directo porque las opciones están en la tabla puente `detalle_pedido_opciones` (relación N:M vía el modelo `DetallePedidoOpcion`, `foreignKey: detalle_pedido_id`, `otherKey: opcion_id`). El enfoque recomendado: una subconsulta que calcule por cada `detalle_pedido_id` un `GROUP_CONCAT(opcion_id ORDER BY opcion_id)` como clave de variante, y agrupar el resultado por `producto_id`/`combo_id` + esa clave. Si al implementarlo esto resulta fecha en Sequelize/MariaDB, la alternativa aceptable es traer solo las columnas mínimas de `DetallePedido` + `opciones` (sin el árbol completo de `Pedido`/`Mesa`/`Cliente`/`Usuario` que trae `ventas()` hoy) y seguir agrupando en JS — sigue siendo una mejora real (mucho menos peso por fila) aunque no sea agregación pura en SQL. Cualquiera de las dos formas debe producir el mismo resultado que la lógica actual de `TabVariantes.jsx` (líneas 86-108) para no romper el reporte.

### Reportes → Compras

- Filtro nuevo: `estado`.
- `resumen`: total comprado, cantidad de compras, `filtros.sucursales`.

### Reportes → Inventario

- Filtro nuevo: `tipo`.
- `resumen`: cantidad de movimientos por tipo, `filtros.sucursales`.

### Reportes → Caja

- Filtro nuevo: `tipo` (`ingreso`/`egreso`).
- `resumen`: `total_ingresos`, `total_egresos`, `filtros.sucursales`.

### Corrección necesaria de alcance en `reportes.controller.js`

Hoy `getVentas`/`getInventario`/`getCompras`/`getCaja` arman un solo objeto `{ ...req.query, ..._alcance(req) }` y se lo pasan a cada función de servicio — el spread de `_alcance(req)` **pisa** cualquier `sucursal_id` que venga en `req.query`, así que un admin (`acceso_todas: true`) nunca puede filtrar por una sucursal puntual desde el backend (por eso `TabCaja.jsx`/`TabVentas.jsx` filtran `sucursal_id` en el navegador hoy, sobre el array completo ya traído de todas las sucursales). Para que el filtro de sucursal funcione de verdad en el backend, el controller pasa a llamar `svc.ventas(req.query, _alcance(req))` (dos argumentos separados, mismo patrón que ya usa `libro_caja.controller.js`), y cada función de servicio distingue: si `!alcance.acceso_todas` fuerza `alcance.sucursal_id`; si `alcance.acceso_todas` y viene `filtros.sucursal_id`, filtra por esa; si no viene, trae todas las sucursales.

## Parte 4 — Exportar a PDF

El botón "Exportar PDF" de cada pestaña sigue funcionando igual desde el punto de vista del usuario: exporta todas las filas que cumplen los filtros activos, no solo la página visible. Para lograrlo sin duplicar lógica, el botón dispara una llamada extra al mismo endpoint paginado con `limite=0` (con los mismos filtros que la vista actual) en vez de usar el estado `filas` ya cargado en memoria — así el PDF nunca queda desincronizado de lo que hay en pantalla ni depende de que el usuario haya "cargado todas las páginas" navegando.

## Parte 5 — Frontend

### Componente de paginación reusable

Nuevo `frontend/src/components/ui/Paginacion.jsx`: recibe `pagina`, `totalPaginas`, `onCambiar`. Botones anterior/siguiente + números de página (con elipsis si son muchas). Se usa en los 6 lugares (Libro de Caja + 5 pestañas de Reportes).

### Patrón de refactor (se repite en los 6 archivos)

- Un `useQuery` para el **resumen** (`queryKey` incluye fecha + filtros, NO la página) — de ahí salen las opciones de los `<select>` de filtro y los `StatCard`.
- Un `useQuery` para las **filas paginadas** (`queryKey` incluye fecha + filtros + `pagina`) — reemplaza el `useMemo` de filtrado client-side.
- Estado `pagina` que vuelve a `1` cada vez que cambia cualquier filtro (fecha, tipo, cajero, etc.) — evitar quedar en "página 8 de 2" tras estrechar el filtro.
- El botón "Exportar" pasa a ser `async`: pide `limite=0` con los filtros actuales, arma el PDF con esa respuesta.

### Archivos tocados

- `frontend/src/pages/libro-caja/LibroCajaPage.jsx`
- `frontend/src/pages/reportes/tabs/TabVentas.jsx`
- `frontend/src/pages/reportes/tabs/TabProductos.jsx`
- `frontend/src/pages/reportes/tabs/TabVariantes.jsx`
- `frontend/src/pages/reportes/tabs/TabCompras.jsx`
- `frontend/src/pages/reportes/tabs/TabInventario.jsx`
- `frontend/src/pages/reportes/tabs/TabCaja.jsx`
- `frontend/src/api/libroCaja.js`, `frontend/src/api/reportes.js` (nuevas funciones `getXxxResumen`, params `pagina`/`limite` en las existentes)
- `frontend/src/components/ui/Paginacion.jsx` (nuevo)

## Testing

- Backend: por cada módulo, test de que `pagina`/`limite` recortan correctamente (`total` correcto, `filas.length <= limite`), que `limite=0` devuelve todo, y que cada filtro nuevo (`tipo`, `busqueda`, `usuario_id`, `metodo_pago`, `origen`, `estado`) reduce el resultado como corresponde. Test del endpoint `resumen` verificando los totales contra una suma manual de fixtures conocidas, y que `filtros.cajeros`/`filtros.sucursales` no incluye entradas fuera del rango de fechas. Test específico de la corrección de alcance: un admin filtrando por `sucursal_id` en `/reportes/ventas` recibe solo esa sucursal; un usuario no-admin sigue restringido a la suya aunque mande otro `sucursal_id` por query.
- Frontend: no hay suite de componentes en este proyecto — verificación manual (cambiar de página, cambiar filtro y confirmar que vuelve a página 1, exportar PDF y confirmar que trae más filas que las visibles en pantalla si el total supera el límite de página).
