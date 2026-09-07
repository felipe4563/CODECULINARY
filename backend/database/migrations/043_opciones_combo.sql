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
