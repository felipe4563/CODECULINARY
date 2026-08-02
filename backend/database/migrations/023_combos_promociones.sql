CREATE TABLE combos (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(150) NOT NULL,
  descripcion VARCHAR(255) DEFAULT NULL,
  precio DECIMAL(10,2) NOT NULL,
  imagen VARCHAR(255) DEFAULT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  fecha_inicio DATE DEFAULT NULL,
  fecha_fin DATE DEFAULT NULL,
  dias_semana VARCHAR(20) DEFAULT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE combo_productos (
  combo_id INT UNSIGNED NOT NULL,
  producto_id INT UNSIGNED NOT NULL,
  cantidad INT NOT NULL DEFAULT 1,
  PRIMARY KEY (combo_id, producto_id),
  KEY producto_id (producto_id),
  CONSTRAINT combo_productos_ibfk_1 FOREIGN KEY (combo_id) REFERENCES combos(id) ON DELETE CASCADE,
  CONSTRAINT combo_productos_ibfk_2 FOREIGN KEY (producto_id) REFERENCES productos(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE promociones (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  producto_id INT UNSIGNED NOT NULL,
  nombre VARCHAR(150) DEFAULT NULL,
  tipo ENUM('porcentaje','monto') NOT NULL DEFAULT 'porcentaje',
  valor DECIMAL(10,2) NOT NULL,
  fecha_inicio DATE DEFAULT NULL,
  fecha_fin DATE DEFAULT NULL,
  dias_semana VARCHAR(20) DEFAULT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY producto_id (producto_id),
  CONSTRAINT promociones_ibfk_1 FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Un detalle de pedido ahora representa un producto suelto O un combo, nunca
-- ambos: producto_id pasa a ser opcional y se agrega combo_id.
ALTER TABLE detalle_pedidos
  MODIFY producto_id INT UNSIGNED NULL,
  ADD COLUMN combo_id INT UNSIGNED NULL AFTER producto_id,
  ADD KEY combo_id (combo_id),
  ADD CONSTRAINT detalle_pedidos_combo_fk FOREIGN KEY (combo_id) REFERENCES combos(id);

INSERT INTO permisos (modulo, accion, descripcion) VALUES
  ('combos', 'ver', 'Ver combos'),
  ('combos', 'crear', 'Crear combos'),
  ('combos', 'editar', 'Editar combos'),
  ('combos', 'eliminar', 'Eliminar combos'),
  ('promociones', 'ver', 'Ver promociones'),
  ('promociones', 'crear', 'Crear promociones'),
  ('promociones', 'editar', 'Editar promociones'),
  ('promociones', 'eliminar', 'Eliminar promociones');

INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT 1, id FROM permisos WHERE modulo IN ('combos', 'promociones');
