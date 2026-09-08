-- backend/database/migrations/044_integracion_pedidos_externos.sql
-- Integración con app de pedidos externa. Ver
-- docs/superpowers/specs/2026-09-08-integracion-app-pedidos-design.md

CREATE TABLE integraciones_api_keys (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sucursal_id INT UNSIGNED NOT NULL,
  nombre_app VARCHAR(100) NOT NULL,
  api_key_hash VARCHAR(255) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE CASCADE,
  UNIQUE KEY api_key_hash (api_key_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE pedidos
  MODIFY COLUMN origen ENUM('staff','autoservicio','app_externa') NOT NULL DEFAULT 'staff',
  MODIFY COLUMN tipo ENUM('mesa','llevar','delivery') NOT NULL DEFAULT 'mesa',
  MODIFY COLUMN metodo_pago ENUM('efectivo','qr','app_externa') NOT NULL DEFAULT 'efectivo',
  ADD COLUMN direccion_entrega VARCHAR(255) NULL AFTER documento_cliente,
  ADD COLUMN telefono_cliente VARCHAR(50) NULL AFTER direccion_entrega,
  ADD COLUMN origen_app VARCHAR(100) NULL AFTER origen;
