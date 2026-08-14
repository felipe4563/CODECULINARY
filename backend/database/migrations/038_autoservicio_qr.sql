-- Sesión de mesa, código QR y origen del pedido para autoservicio.
-- Ver docs/superpowers/specs/2026-08-10-autoservicio-qr-design.md

ALTER TABLE mesas
  ADD COLUMN codigo_qr VARCHAR(32) NULL AFTER nombre,
  ADD UNIQUE KEY codigo_qr (codigo_qr);

CREATE TABLE mesa_sesiones (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  mesa_id INT UNSIGNED NOT NULL,
  sucursal_id INT UNSIGNED NOT NULL,
  abierta_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cerrada_en DATETIME NULL,
  abierta_por ENUM('staff','autoservicio') NOT NULL DEFAULT 'staff',
  FOREIGN KEY (mesa_id) REFERENCES mesas(id) ON DELETE CASCADE,
  FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE CASCADE,
  KEY mesa_activa (mesa_id, cerrada_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE pedidos
  ADD COLUMN mesa_sesion_id INT UNSIGNED NULL AFTER mesa_id,
  ADD COLUMN origen ENUM('staff','autoservicio') NOT NULL DEFAULT 'staff' AFTER tipo,
  ADD FOREIGN KEY (mesa_sesion_id) REFERENCES mesa_sesiones(id);
