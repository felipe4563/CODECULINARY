-- backend/database/migrations/046_sucursal_ubicacion_negocio_portada.sql
-- Para que la app de pedidos externa (GET /api/v1/integraciones/menu) pueda
-- mostrar dónde está la sucursal y un banner del negocio: coordenadas por
-- sucursal (opcionales) + una nueva clave de configuración `portada`.

ALTER TABLE sucursales
  ADD COLUMN latitud  DECIMAL(10,7) NULL AFTER telefono,
  ADD COLUMN longitud DECIMAL(10,7) NULL AFTER latitud;

INSERT IGNORE INTO configuraciones (clave, valor) VALUES ('portada', NULL);
