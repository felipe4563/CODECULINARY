# Insumos y Recetas (consumo automático de ingredientes)

**Fecha:** 2026-08-08

## Goal

Hoy los "insumos" (ingredientes de cocina: pulpa, azúcar, hielo, etc.) no existen como concepto en el sistema — solo existen `Producto` (ítems vendibles) y `Compra`/`DetalleCompra` (que solo puede referenciar productos). El negocio necesita:

1. Registrar la compra de insumos por **unidad de medida** (kg, arroba, libra, litro, etc., con decimales), separada visualmente de otros gastos, aunque siga generando egreso en `libro_caja`.
2. Que, para insumos que **sí** se pueden medir con precisión (ej. pulpa de un frappe), cada venta del producto que los usa descuente automáticamente la cantidad correspondiente del stock del insumo.
3. Que esto sea **configurable por producto/insumo**: hay insumos difíciles de medir (ej. condimentos de un plato preparado) que no tendrán receta y por tanto nunca se descuentan solos — su control queda manual, vía compras/ajustes.
4. Que la cantidad consumida pueda variar según la opción elegida en la venta (ej. tamaño Grande vs Chico consume distinta cantidad del mismo insumo; sabor Fresa vs Mora consume insumos distintos).

**Fuera de alcance:**
- Alertas/notificaciones automáticas de stock bajo de insumos (se ve reflejado como número, negativo si falta, pero no se dispara ninguna notificación).
- Recetas para `Combo` (los combos ya arman su propio precio a partir de productos existentes; si sus componentes tienen receta, esa receta ya aplica a través del producto — no se modela una receta aparte a nivel combo).
- Costeo/margen de ganancia calculado automáticamente a partir del costo de insumos (el reporte solo es "cuánto gasté", no "cuánto me cuesta producir cada plato").

## Decisiones (de la sesión de brainstorming)

1. **Flujo de compra:** se extiende el módulo de Compras existente (Proveedor → Compra → DetalleCompra) en vez de crear un flujo aparte — se reutiliza el historial, proveedores, y el egreso automático en `libro_caja`.
2. **Alcance del stock:** por sucursal, igual patrón que `producto_stock_sucursal`, pero con cantidades `DECIMAL` (no enteras).
3. **Unidad de medida:** enum fijo (no texto libre), para evitar inconsistencias tipo "Kg" vs "kg" vs "kilo".
4. **Nivel de receta:** puede variar por opción elegida, cubriendo dos casos:
   - Misma unidad de insumo, distinta cantidad según la opción (tamaños).
   - Insumo distinto según la opción (sabores).
   Ambos se resuelven con el mismo modelo: una línea de receta puede estar atada a un producto (consumo base, siempre) o a una opción específica (consumo condicional a que el cliente la haya elegido).
5. **Stock insuficiente al vender:** no bloquea la venta. El stock del insumo queda en negativo como señal visual de alerta para reponer.
6. **Reporte:** página propia "Insumos" (listado, stock, alta/edición, definición de receta por producto), separada de la vista general de Libro de Caja, aunque el dato de egreso siga viviendo ahí.
7. **Gap descubierto y resuelto:** hoy `opcion_ids` elegidos en una venta se usan solo para calcular el precio extra y luego se descartan (solo queda texto libre concatenado en `detalle_pedidos.nota`, decisión de un diseño anterior). Para que la receta por opción funcione, hace falta persistir esa elección de forma estructurada — se agrega una tabla puente nueva, sin tocar el comportamiento actual de nota/ticket/cocina.

## Arquitectura

### Base de datos (migración `037_insumos_recetas.sql`)

```sql
CREATE TABLE insumos (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  unidad_medida ENUM('kilogramo','gramo','litro','mililitro','arroba','libra','unidad') NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE insumo_stock_sucursal (
  insumo_id INT UNSIGNED NOT NULL,
  sucursal_id INT UNSIGNED NOT NULL,
  stock DECIMAL(10,3) NOT NULL DEFAULT 0,
  PRIMARY KEY (insumo_id, sucursal_id),
  FOREIGN KEY (insumo_id) REFERENCES insumos(id) ON DELETE CASCADE,
  FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Historial de movimientos de insumo (compra / ajuste manual / consumo por venta),
-- mismo espíritu que el historial de stock de productos (ver stock.service.js).
CREATE TABLE insumo_movimientos (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  insumo_id INT UNSIGNED NOT NULL,
  sucursal_id INT UNSIGNED NOT NULL,
  usuario_id INT UNSIGNED NULL,
  tipo ENUM('compra','ajuste','consumo_venta') NOT NULL,
  cantidad DECIMAL(10,3) NOT NULL,
  stock_anterior DECIMAL(10,3) NOT NULL,
  stock_nuevo DECIMAL(10,3) NOT NULL,
  nota VARCHAR(255) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (insumo_id) REFERENCES insumos(id) ON DELETE CASCADE,
  FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- DetalleCompra gana insumo_id opcional, alternativo a producto_id
ALTER TABLE detalle_compras
  ADD COLUMN insumo_id INT UNSIGNED NULL AFTER producto_id,
  MODIFY COLUMN producto_id INT UNSIGNED NULL,
  ADD FOREIGN KEY (insumo_id) REFERENCES insumos(id);
-- Nota: verificar contra bd_codeculinary.sql el nombre real de la tabla/columnas
-- de detalle_compras y si producto_id ya admite NULL antes de aplicar.

-- Receta: consumo de insumo por producto (base) o por opción específica
CREATE TABLE receta_insumos (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  producto_id INT UNSIGNED NOT NULL,
  opcion_id INT UNSIGNED NULL, -- NULL = consumo base, siempre que se venda el producto
  insumo_id INT UNSIGNED NOT NULL,
  cantidad DECIMAL(10,3) NOT NULL,
  FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE,
  FOREIGN KEY (opcion_id) REFERENCES opciones(id) ON DELETE CASCADE,
  FOREIGN KEY (insumo_id) REFERENCES insumos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Estructura las opciones elegidas por línea de pedido (hoy solo quedaban
-- como texto libre en detalle_pedidos.nota) — necesario para poder resolver
-- receta_insumos.opcion_id al momento de confirmar la venta.
CREATE TABLE detalle_pedido_opciones (
  detalle_pedido_id INT UNSIGNED NOT NULL,
  opcion_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (detalle_pedido_id, opcion_id),
  FOREIGN KEY (detalle_pedido_id) REFERENCES detalle_pedidos(id) ON DELETE CASCADE,
  FOREIGN KEY (opcion_id) REFERENCES opciones(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

(Los nombres exactos de columnas/constraints de `detalle_compras` deben verificarse contra `bd/bd_codeculinary.sql` antes de escribir la migración real, siguiendo la misma disciplina de otras migraciones de esta sesión.)

### Backend — Insumos (nuevo módulo `backend/src/modules/insumos/`)

- **Modelos:** `Insumo.js`, `InsumoStockSucursal.js`, `InsumoMovimiento.js`, `RecetaInsumo.js`, `DetallePedidoOpcion.js`.
- **`insumos.service.js`:**
  - `listarInsumos(alcance)` / `crearInsumo` / `actualizarInsumo` / `desactivarInsumo` — CRUD simple, patrón calcado de `productos.service.js`.
  - `ajustarStockInsumoSucursal({ insumo_id, sucursal_id, tipo, cantidad, usuario_id, nota, transaction })` — misma forma que `ajustarStockSucursal` de `stock.service.js`, pero con `DECIMAL` y sin el "no puede quedar negativo" que sí tiene el de productos (acá si puede, por decisión de diseño).
  - `listarRecetaProducto(producto_id)` / `guardarRecetaProducto(producto_id, lineas)` — reemplaza-todo (destroy + bulkCreate), mismo patrón que `actualizarGrupoOpciones` con sus `opciones`.
  - `totalGastadoInsumos({ desde, hasta, alcance })` — suma `subtotal` de `DetalleCompra` donde `insumo_id IS NOT NULL`, para el resumen de la página Insumos.

### Backend — Compras (`compras.service.js`, modificar)

- `crearCompra`: cada item de `items` ahora trae `producto_id` **o** `insumo_id` (no ambos). Validar que venga exactamente uno.
- `recibirCompra`: por cada detalle, si es insumo → `ajustarStockInsumoSucursal(tipo: 'compra', ...)` en vez de `ajustarStockSucursal`. El egreso en `libro_caja` sigue siendo uno solo por compra (mezclando productos e insumos), tal como hoy — separar "cuánto fue insumos" es un cálculo de reporte, no un cambio en cómo se registra el egreso.

### Backend — Ventas (`ventas.service.js`, modificar)

- `crearCompleta`/`agregarItem`: al crear cada `DetallePedido`, además de guardar `nota` como hoy, hacer `DetallePedidoOpcion.bulkCreate` con los `opcion_ids` recibidos — sin cambiar el texto de `nota` ni el ticket/comanda (que siguen leyendo `nota` igual que siempre).
- Nueva función `_descontarInsumosPorVenta(pedido, transaction)`, llamada al confirmar/completar el pedido (mismo punto donde hoy se descuenta stock de producto, si existe):
  1. Por cada `DetallePedido` con `producto_id` (no combo): buscar en `receta_insumos` las filas con `producto_id` igual, más las filas con `opcion_id` dentro de las opciones elegidas de esa línea (vía `detalle_pedido_opciones`).
  2. Por cada fila encontrada: `ajustarStockInsumoSucursal(tipo: 'consumo_venta', cantidad: fila.cantidad * detalle.cantidad, ...)`.
  3. Sin bloquear ni lanzar error si el stock queda negativo — coincide con la decisión de diseño.

### Frontend

- **Nueva página `InsumosPage.jsx`** (ruta `/insumos`, junto a Productos/Compras en el menú):
  - Listado de insumos con stock por sucursal, alta/edición/baja.
  - Resumen "Total gastado en insumos" con filtro de fechas (usa `totalGastadoInsumos`).
- **`ProductosPage.jsx` (o modal de edición de producto):** nueva sección "Receta" — por cada grupo de opciones del producto, permitir asignar consumo de insumo (a nivel base del producto, o por opción específica dentro del grupo). Reusa el patrón visual ya existente para grupos de opciones.
- **`compras` (páginas existentes):** el selector de "producto" en una línea de compra pasa a ser un selector de "producto o insumo" (dos pestañas/tabs, o un selector con las dos listas agrupadas).
- **`VentasPage.jsx`:** sin cambios visibles — la selección de opciones ya funciona igual, solo cambia qué datos manda al backend (los `opcion_ids` ya se mandan hoy para el cálculo de precio, se siguen mandando igual).

## Testing

- Insumo con receta base (sin opción): vender el producto y verificar que el stock del insumo baja la cantidad exacta × cantidad vendida.
- Insumo con receta por opción (dos variantes, ej. tamaño): vender cada variante y verificar que descuenta la cantidad correcta de cada una.
- Insumo con receta por opción que cambia el insumo (ej. sabor): verificar que solo se descuenta el insumo de la opción elegida, no ambos.
- Producto sin receta: vender y verificar que ningún insumo se mueve.
- Venta que deja stock de insumo en negativo: verificar que la venta se completa igual, sin error.
- Compra mixta (producto + insumo en la misma compra): verificar que cada línea ajusta el stock correcto (entero para producto, decimal para insumo) y que se genera un solo egreso en libro_caja por el total.
- `totalGastadoInsumos`: verificar que solo suma líneas de compra con `insumo_id`, no las de `producto_id`.
