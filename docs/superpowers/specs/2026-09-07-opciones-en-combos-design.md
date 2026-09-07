# Opciones por producto dentro de combos — Diseño

## Contexto

Hoy, cuando un combo incluye productos que individualmente tienen `grupos_opciones`
(ej. tamaño, sabor), esas opciones se ignoran por completo al vender el combo —
tanto en Ventas (staff) como en Autoservicio (QR). El código lo dice explícitamente
en `ventas.service.js` (`_finalizarVenta`): *"Los combos no tienen opciones propias
— solo aplica la receta base de cada producto componente"*.

Un combo hoy es UNA sola fila en `detalle_pedidos` (`combo_id` puesto,
`producto_id: null`), sin importar cuántos productos incluya.

## Objetivo

Permitir elegir, al agregar un combo al carrito (en Ventas y en Autoservicio), las
opciones de cada producto componente que las tenga — igual que ya se puede para un
producto suelto — sin romper nada de lo que ya depende de "un combo = una fila"
(tickets, reportes, edición/borrado de ítems).

## Decisión de modelo de datos

Se agrega una tabla nueva, `detalle_pedido_combo_opciones`, en vez de "explotar" el
combo en varias filas de `detalle_pedidos` (alternativa descartada: rompería la
impresión de tickets, los reportes de productos/variantes ya identificados como
frágiles, y la semántica de "borrar una fila = borrar el combo completo").

```sql
CREATE TABLE detalle_pedido_combo_opciones (
  detalle_pedido_id INT UNSIGNED NOT NULL,
  producto_id INT UNSIGNED NOT NULL,
  opcion_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (detalle_pedido_id, producto_id, opcion_id),
  FOREIGN KEY (detalle_pedido_id) REFERENCES detalle_pedidos(id) ON DELETE CASCADE,
  FOREIGN KEY (producto_id) REFERENCES productos(id),
  FOREIGN KEY (opcion_id) REFERENCES opciones(id) ON DELETE CASCADE
);
```

`detalle_pedidos` y `detalle_pedido_opciones` (la de productos sueltos) no cambian.

## Reglas acordadas

- **Precio:** el `precio_adicional` de cada opción elegida se suma al precio del
  combo (igual que para un producto suelto), recalculado siempre en el backend.
- **Obligatoriedad:** un grupo marcado `obligatorio` en `producto_grupos_opciones`
  sigue siendo obligatorio dentro del combo. Se enforce SOLO en el frontend (el
  modal no deja confirmar sin elegir) — igual que ya pasa hoy con productos sueltos;
  el backend no valida "obligatorio" para ningún caso, no se introduce inconsistencia.
- **Cantidad > 1 del producto dentro del combo:** se elige una sola vez por
  producto, sin importar cuántas unidades de ese producto trae el combo.
- **Edición posterior:** NO se permite reabrir el selector de un combo ya agregado
  para cambiar sus opciones — hay que quitarlo y volver a agregarlo. Mismo criterio
  que ya rige hoy para un producto suelto con opciones (`actualizarItem` no acepta
  `opcion_ids`), no se introduce una capacidad nueva inconsistente.
- **Insumos/stock:** sin cambios — elegir una opción nunca cambió qué insumos se
  descuentan (es puramente de precio), tampoco cambia para combos.
- **Ticket:** SÍ se muestra qué se eligió por producto (ej. `2x Papas (Grande)`),
  en los 4 archivos que arman contenido de combo: `ticketVenta.js`, `ticketCocina.js`,
  `escpos.js` (dos secciones: caja y cocina) y `print-agent/agent.js` (ídem).

## Contrato del backend

Forma nueva de un ítem de combo en `POST /ventas/completa` y `POST /ventas/:id/items`:

```json
{
  "combo_id": 5,
  "cantidad": 1,
  "nota": "...",
  "opciones_por_producto": [
    { "producto_id": 12, "opcion_ids": [101, 105] },
    { "producto_id": 18, "opcion_ids": [] }
  ]
}
```

`opciones_por_producto` es opcional (combo sin productos opcionables).

**Validación nueva:** cada `producto_id` en `opciones_por_producto` debe pertenecer
al combo (existir en `combo_productos` para ese `combo_id`) — si no, 400. Esto es
integridad referencial, no "obligatorio" — evita que un cliente mande opciones para
un producto ajeno al combo.

**`ventas.service.js`:**
- Rama de combo de `crearCompleta` y `agregarItem`: se calcula `extra` sumando
  `precio_adicional` de TODAS las opciones en `opciones_por_producto` (reusando
  `_extraPorOpciones` sobre el array aplanado), se suma a `combo.precio`. Se crea
  la fila de `DetallePedido` igual que hoy, y después un `bulkCreate` en la tabla
  nueva con una fila por cada par `{producto_id, opcion_id}`.
- `_finalizarVenta`: sin cambios (confirmado arriba).
- `INCLUDE_PEDIDO_COMPLETO`: nuevo include anidado bajo `detalles`, hacia la tabla
  nueva, con el producto (nombre) y la opción (nombre) — usado por `listar`,
  `listarCocina`, `obtener`, cobro QR y `cobrar`, así que todo pedido completo
  arrastra esta información automáticamente (incluida la reimpresión, que reusa
  `obtener`).

**`combos.service.js`:** `INCLUDE_PRODUCTOS` (usado por `listar`/`listarActivos`/
`obtener`, que alimentan tanto el POS de Ventas como el menú de Autoservicio) gana
un include anidado de `grupos_opciones` → `opciones` por producto componente,
igual al patrón que ya usa `productos.service.js` — sin esto el frontend no puede
saber qué producto del combo es opcionable.

## Frontend — Ventas y Autoservicio

Mismo patrón en los dos (`VentasPage.jsx` y `AutoservicioPage.jsx`), reusando
`SelectorOpcionModal.jsx` en cadena, una vez por cada producto del combo con
`grupos_opciones`:

```js
function agregarCombo(combo) {
  const productosConOpciones = (combo.productos || []).filter(p => p.grupos_opciones?.length > 0);
  if (productosConOpciones.length === 0) {
    agregarComboAlCarrito(combo, []);   // comportamiento actual, sin cambios
    return;
  }
  setColaOpcionesCombo({ combo, pendientes: productosConOpciones, resueltas: [] });
}

function elegirOpcionCombo(seleccion) {
  const [actual, ...resto] = colaOpcionesCombo.pendientes;
  const resueltas = [...colaOpcionesCombo.resueltas, { producto_id: actual.id, opcion_ids: seleccion.opcionIds }];
  if (resto.length === 0) {
    agregarComboAlCarrito(colaOpcionesCombo.combo, resueltas);
    setColaOpcionesCombo(null);
  } else {
    setColaOpcionesCombo({ ...colaOpcionesCombo, pendientes: resto, resueltas });
  }
}
```

- Cerrar el modal a mitad de la cadena cancela el combo completo (no se agrega
  parcialmente) — mismo criterio que hoy con un producto suelto.
- `SelectorOpcionModal.jsx` gana un prop opcional `subtitulo` (default vacío, no
  rompe el uso actual con productos sueltos) para mostrar contexto, ej. *"Combo:
  Menú Familiar — Producto 2 de 3: Papas"*.

## Tickets impresos

En los 4 archivos que arman el contenido textual de un combo (`ticketVenta.js`,
`ticketCocina.js`, `escpos.js` ×2, `print-agent/agent.js` ×2), se agrupa
`combo_opciones` por `producto_id` y se agrega entre paréntesis al listado:

```js
function _opcionesPorProducto(comboOpciones) {
  const mapa = {};
  (comboOpciones || []).forEach(co => {
    if (!co.opcion?.nombre) return;
    (mapa[co.producto_id] ??= []).push(co.opcion.nombre);
  });
  return mapa;
}
```

`2x Papas, 1x Gaseosa` → `2x Papas (Grande), 1x Gaseosa`.

## Testing (backend)

1. `crearCompleta` combo + opción con `precio_adicional` → total correcto, fila de
   `DetallePedido` sin cambios, filas nuevas correctas.
2. Combo sin opciones elegidas → sin cambios de comportamiento, sin filas nuevas.
3. Dos productos del mismo combo, cada uno con su propia opción → no se mezclan.
4. `agregarItem` combo + opciones → mismas verificaciones.
5. `eliminarItem` de un combo con opciones → cascada borra las filas nuevas.
6. `producto_id` en `opciones_por_producto` que no pertenece al combo → 400.
7. `GET`/`obtener` de un pedido con combo+opciones → `detalles[].combo_opciones`
   viene anidado con nombres.
8. `combos.service.js`: `listar`/`listarActivos` devuelven `grupos_opciones`
   anidado por producto componente.

## Fuera de alcance (explícitamente descartado en esta ronda)

- Editar las opciones de un combo ya agregado (in-place).
- Validación "obligatorio" del lado del backend.
- Cambios en descuento de insumos/stock por combo.
- "Explotar" el combo en múltiples filas de `detalle_pedidos`.
