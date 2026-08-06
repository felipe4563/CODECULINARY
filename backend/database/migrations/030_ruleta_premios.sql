-- Ruleta de premios: el cliente gasta puntos de fidelidad por cada giro y
-- gana un premio sorteado (servidor, ponderado por `peso`). Si el premio no
-- es "nada", se le genera un cupón personal (mismo mecanismo que ya usan
-- los cupones de cumpleaños: cliente_id exclusivo, 1 solo uso).
CREATE TABLE ruleta_premios (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(100) NOT NULL,
  tipo ENUM('porcentaje','fijo','nada') NOT NULL DEFAULT 'nada',
  valor DECIMAL(10,2) DEFAULT NULL,
  peso INT UNSIGNED NOT NULL DEFAULT 1,
  color VARCHAR(20) DEFAULT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  orden INT NOT NULL DEFAULT 0,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Historial de giros — auditoría de puntos gastados y límite de giros por período.
CREATE TABLE ruleta_giros (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  cliente_id INT UNSIGNED NOT NULL,
  premio_id INT UNSIGNED NOT NULL,
  cupon_id INT UNSIGNED DEFAULT NULL,
  usuario_id INT UNSIGNED NOT NULL,
  puntos_gastados INT NOT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY cliente_id (cliente_id),
  KEY premio_id (premio_id),
  KEY cupon_id (cupon_id),
  KEY usuario_id (usuario_id),
  CONSTRAINT ruleta_giros_cliente_fk FOREIGN KEY (cliente_id) REFERENCES clientes(id),
  CONSTRAINT ruleta_giros_premio_fk FOREIGN KEY (premio_id) REFERENCES ruleta_premios(id),
  CONSTRAINT ruleta_giros_cupon_fk FOREIGN KEY (cupon_id) REFERENCES cupones(id),
  CONSTRAINT ruleta_giros_usuario_fk FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO configuraciones (clave, valor) VALUES
  ('ruleta_activa', 'false'),
  ('ruleta_costo_puntos', '10'),
  ('ruleta_max_giros_periodo', '1'),
  ('ruleta_periodo', 'dia'),
  ('ruleta_vigencia_dias_premio', '7');

INSERT INTO permisos (modulo, accion, descripcion) VALUES
  ('ruleta', 'ver', 'Ver ruleta de premios'),
  ('ruleta', 'girar', 'Girar la ruleta por un cliente'),
  ('ruleta', 'crear', 'Crear premios de la ruleta'),
  ('ruleta', 'editar', 'Editar premios de la ruleta'),
  ('ruleta', 'eliminar', 'Eliminar premios de la ruleta');

INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT 1, id FROM permisos WHERE modulo = 'ruleta';
