ALTER TABLE productos
  ADD COLUMN disponible_hoy TINYINT(1) NOT NULL DEFAULT 1 AFTER activo;

INSERT INTO permisos (modulo, accion, descripcion) VALUES
  ('productos', 'disponibilidad', 'Marcar productos como no disponibles hoy');

INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT 1, id FROM permisos WHERE modulo = 'productos' AND accion = 'disponibilidad';

INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT 2, id FROM permisos WHERE modulo = 'productos' AND accion = 'disponibilidad';
