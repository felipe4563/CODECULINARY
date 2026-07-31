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
