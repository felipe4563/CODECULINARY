CREATE TABLE cupones (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(30) NOT NULL,
  tipo ENUM('fijo','porcentaje') NOT NULL DEFAULT 'fijo',
  valor DECIMAL(10,2) NOT NULL,
  fecha_expiracion DATE DEFAULT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  usado TINYINT(1) NOT NULL DEFAULT 0,
  usado_en DATETIME DEFAULT NULL,
  creado_por INT UNSIGNED DEFAULT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY codigo (codigo),
  KEY creado_por (creado_por),
  CONSTRAINT cupones_ibfk_1 FOREIGN KEY (creado_por) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE pedidos
  ADD COLUMN cupon_id INT UNSIGNED DEFAULT NULL AFTER puntos_canjeados,
  ADD COLUMN descuento_cupon DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER cupon_id,
  ADD KEY cupon_id (cupon_id),
  ADD CONSTRAINT pedidos_cupon_fk FOREIGN KEY (cupon_id) REFERENCES cupones(id);

INSERT INTO permisos (modulo, accion, descripcion) VALUES
  ('cupones', 'ver', 'Ver cupones'),
  ('cupones', 'crear', 'Crear cupones'),
  ('cupones', 'editar', 'Editar cupones'),
  ('cupones', 'eliminar', 'Eliminar cupones');

INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT 1, id FROM permisos WHERE modulo = 'cupones';
