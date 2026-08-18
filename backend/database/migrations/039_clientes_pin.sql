-- backend/database/migrations/039_clientes_pin.sql
-- PIN de cliente para autoservicio (canje de puntos, historial). Ver
-- docs/superpowers/specs/2026-08-14-fidelidad-autoservicio-pin-design.md

ALTER TABLE clientes
  ADD COLUMN pin_hash VARCHAR(255) NULL AFTER puntos,
  ADD COLUMN pin_intentos_fallidos INT NOT NULL DEFAULT 0 AFTER pin_hash,
  ADD COLUMN pin_bloqueado_hasta DATETIME NULL AFTER pin_intentos_fallidos;

CREATE TABLE cliente_pin_verificaciones (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cliente_id INT UNSIGNED NOT NULL,
  pin_hash VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  codigo_hash VARCHAR(255) NOT NULL,
  intentos INT NOT NULL DEFAULT 0,
  expira_en DATETIME NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY cliente_id (cliente_id),
  FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
