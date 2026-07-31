-- Migración de datos de producción (respaldo pre-multisucursal) a la
-- estructura multisucursal actual, asignando todo lo existente a la
-- sucursal "SHINAHOTA".
--
-- Requisito: importar primero bd/respaldo_salybrasas.sql en la base de
-- datos de destino. Este script asume ese esquema exacto (equivalente a
-- las migraciones 001-011, sin sucursales/cajas todavía).
--
-- Uso:
--   mysql -u root -p salybrasas_db < bd/respaldo_salybrasas.sql
--   mysql -u root -p salybrasas_db < backend/database/migrations/016_produccion_sucursal_shinahota.sql

-- sesiones_caja.cerrado_en usa DEFAULT '0000-00-00 00:00:00' (esquema
-- viejo); bajo sql_mode estricto eso rompe cualquier ALTER TABLE que
-- reescriba la tabla, aunque no toquemos esa columna. Se relaja para
-- esta sesión y se restaura al final.
SET @old_sql_mode = @@SESSION.sql_mode;
SET SESSION sql_mode = '';

-- 1) Tablas y columna base de sucursales (= migración 012)
CREATE TABLE IF NOT EXISTS sucursales (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(255) NOT NULL,
  direccion VARCHAR(255),
  telefono VARCHAR(50),
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE usuarios
  ADD COLUMN acceso_todas_sucursales TINYINT(1) NOT NULL DEFAULT 0 AFTER rol_id;

CREATE TABLE IF NOT EXISTS usuarios_sucursales (
  usuario_id INT UNSIGNED NOT NULL,
  sucursal_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (usuario_id, sucursal_id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2) Crear la sucursal SHINAHOTA, tomando dirección/teléfono de la
--    configuración existente si están disponibles.
INSERT INTO sucursales (nombre, direccion, telefono, activo)
SELECT
  'SHINAHOTA',
  (SELECT valor FROM configuraciones WHERE clave = 'direccion' LIMIT 1),
  (SELECT valor FROM configuraciones WHERE clave = 'telefono' LIMIT 1),
  1
WHERE NOT EXISTS (SELECT 1 FROM sucursales WHERE nombre = 'SHINAHOTA');

SET @sucursal_id = (SELECT id FROM sucursales WHERE nombre = 'SHINAHOTA' LIMIT 1);

-- 3) Columnas sucursal_id en tablas operativas (= migración 013),
--    agregadas como NULL primero porque las tablas ya tienen datos,
--    rellenadas con la sucursal SHINAHOTA y luego fijadas NOT NULL + FK.
ALTER TABLE areas ADD COLUMN sucursal_id INT UNSIGNED NULL AFTER id;
UPDATE areas SET sucursal_id = @sucursal_id;
ALTER TABLE areas
  MODIFY COLUMN sucursal_id INT UNSIGNED NOT NULL,
  ADD FOREIGN KEY (sucursal_id) REFERENCES sucursales(id);

ALTER TABLE sesiones_caja ADD COLUMN sucursal_id INT UNSIGNED NULL AFTER usuario_id;
UPDATE sesiones_caja SET sucursal_id = @sucursal_id;
ALTER TABLE sesiones_caja
  MODIFY COLUMN sucursal_id INT UNSIGNED NOT NULL,
  ADD FOREIGN KEY (sucursal_id) REFERENCES sucursales(id);

ALTER TABLE pedidos ADD COLUMN sucursal_id INT UNSIGNED NULL AFTER id;
UPDATE pedidos SET sucursal_id = @sucursal_id;
ALTER TABLE pedidos
  MODIFY COLUMN sucursal_id INT UNSIGNED NOT NULL,
  ADD FOREIGN KEY (sucursal_id) REFERENCES sucursales(id);

ALTER TABLE compras ADD COLUMN sucursal_id INT UNSIGNED NULL AFTER id;
UPDATE compras SET sucursal_id = @sucursal_id;
ALTER TABLE compras
  MODIFY COLUMN sucursal_id INT UNSIGNED NOT NULL,
  ADD FOREIGN KEY (sucursal_id) REFERENCES sucursales(id);

ALTER TABLE registros_inventario ADD COLUMN sucursal_id INT UNSIGNED NULL AFTER producto_id;
UPDATE registros_inventario SET sucursal_id = @sucursal_id;
ALTER TABLE registros_inventario
  MODIFY COLUMN sucursal_id INT UNSIGNED NOT NULL,
  ADD FOREIGN KEY (sucursal_id) REFERENCES sucursales(id);

-- 4) Stock por sucursal (= migración 013): el stock actual de
--    `productos` (agregado, único hasta ahora) se convierte en el stock
--    de SHINAHOTA para cada producto que sí trackea inventario.
CREATE TABLE IF NOT EXISTS producto_stock_sucursal (
  producto_id INT UNSIGNED NOT NULL,
  sucursal_id INT UNSIGNED NOT NULL,
  stock INT NOT NULL DEFAULT 0,
  actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (producto_id, sucursal_id),
  FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE,
  FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO producto_stock_sucursal (producto_id, sucursal_id, stock)
SELECT id, @sucursal_id, stock FROM productos WHERE stock IS NOT NULL;

-- 5) Cajas (= migración 014): una caja principal para SHINAHOTA, y
--    sesiones_caja.caja_id apuntando a ella (misma técnica NULL -> NOT NULL).
CREATE TABLE IF NOT EXISTS cajas (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sucursal_id INT UNSIGNED NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (sucursal_id) REFERENCES sucursales(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO cajas (sucursal_id, nombre, activo) VALUES (@sucursal_id, 'Caja Principal', 1);
SET @caja_id = LAST_INSERT_ID();

ALTER TABLE sesiones_caja ADD COLUMN caja_id INT UNSIGNED NULL AFTER sucursal_id;
UPDATE sesiones_caja SET caja_id = @caja_id;
ALTER TABLE sesiones_caja
  MODIFY COLUMN caja_id INT UNSIGNED NOT NULL,
  ADD FOREIGN KEY (caja_id) REFERENCES cajas(id);

-- 6) Pagos QR (= migración 015)
CREATE TABLE IF NOT EXISTS pagos_qr (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  pedido_id INT UNSIGNED NOT NULL,
  sucursal_id INT UNSIGNED NOT NULL,
  order_id VARCHAR(25) NOT NULL UNIQUE,
  tx_id VARCHAR(100) NULL,
  estado ENUM('pendiente','completado','fallido','expirado','cancelado') NOT NULL DEFAULT 'pendiente',
  estado_previo VARCHAR(20) NOT NULL,
  moneda VARCHAR(3) NOT NULL DEFAULT 'BOB',
  monto_neto DECIMAL(10,2) NOT NULL,
  comision DECIMAL(10,2) NULL,
  monto_total DECIMAL(10,2) NULL,
  qr_code MEDIUMTEXT NULL,
  expires_at DATETIME NOT NULL,
  datos_webhook JSON NULL,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id),
  FOREIGN KEY (sucursal_id) REFERENCES sucursales(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE pedidos
  MODIFY COLUMN estado ENUM('pendiente','listo','pendiente_pago','completado','cancelado') NOT NULL DEFAULT 'pendiente';

-- 7) Permisos nuevos (sucursales.*, cajas.*) — se insertan sin tocar los
--    permisos ya asignados a Cajero/Mesero/Cocina en producción; solo se
--    conceden al rol Administrador para no alterar accesos existentes.
INSERT INTO permisos (modulo, accion, descripcion)
SELECT * FROM (
  SELECT 'sucursales' AS modulo, 'ver' AS accion, 'Ver sucursales' AS descripcion
  UNION ALL SELECT 'sucursales', 'crear', 'Crear sucursales'
  UNION ALL SELECT 'sucursales', 'editar', 'Editar sucursales'
  UNION ALL SELECT 'sucursales', 'eliminar', 'Eliminar sucursales'
  UNION ALL SELECT 'cajas', 'ver', 'Ver cajas'
  UNION ALL SELECT 'cajas', 'crear', 'Crear cajas'
  UNION ALL SELECT 'cajas', 'editar', 'Editar cajas'
  UNION ALL SELECT 'cajas', 'eliminar', 'Eliminar cajas'
) nuevos
WHERE NOT EXISTS (
  SELECT 1 FROM permisos p WHERE p.modulo = nuevos.modulo AND p.accion = nuevos.accion
);

INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT (SELECT id FROM roles WHERE nombre = 'Administrador' LIMIT 1), p.id
FROM permisos p
WHERE p.modulo IN ('sucursales', 'cajas')
  AND NOT EXISTS (
    SELECT 1 FROM roles_permisos rp
    WHERE rp.rol_id = (SELECT id FROM roles WHERE nombre = 'Administrador' LIMIT 1)
      AND rp.permiso_id = p.id
  );

-- 8) Acceso de usuarios a SHINAHOTA: el Administrador obtiene acceso a
--    todas las sucursales; el resto de usuarios existentes se asigna
--    explícitamente a SHINAHOTA (requerido para poder iniciar sesión ahí).
UPDATE usuarios u
JOIN roles r ON r.id = u.rol_id
SET u.acceso_todas_sucursales = 1
WHERE r.nombre = 'Administrador';

INSERT INTO usuarios_sucursales (usuario_id, sucursal_id)
SELECT u.id, @sucursal_id
FROM usuarios u
WHERE NOT EXISTS (
  SELECT 1 FROM usuarios_sucursales us WHERE us.usuario_id = u.id AND us.sucursal_id = @sucursal_id
);

SET SESSION sql_mode = @old_sql_mode;

SELECT @sucursal_id AS sucursal_shinahota_id, @caja_id AS caja_principal_id;
