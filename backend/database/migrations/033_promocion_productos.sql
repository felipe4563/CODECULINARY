-- Una promoción ahora puede afectar a varios productos (antes era 1 a 1).
-- No hay datos existentes que migrar (tabla promociones vacía al momento de
-- esta migración), así que se reemplaza directo la columna producto_id por
-- la tabla puente.
CREATE TABLE promocion_productos (
  promocion_id INT UNSIGNED NOT NULL,
  producto_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (promocion_id, producto_id),
  KEY producto_id (producto_id),
  CONSTRAINT promocion_productos_promocion_fk FOREIGN KEY (promocion_id) REFERENCES promociones(id) ON DELETE CASCADE,
  CONSTRAINT promocion_productos_producto_fk FOREIGN KEY (producto_id) REFERENCES productos(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE promociones DROP FOREIGN KEY promociones_ibfk_1;
ALTER TABLE promociones DROP COLUMN producto_id;
