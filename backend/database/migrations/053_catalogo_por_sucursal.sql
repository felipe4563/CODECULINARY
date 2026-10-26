-- backend/database/migrations/053_catalogo_por_sucursal.sql
-- Catálogo por sucursal: categorías, productos, grupos de opciones, combos y
-- promociones pasan a pertenecer a una sucursal. Todo lo existente se asigna
-- a la sucursal principal (la activa de menor id).
--
-- IMPORTANTE: aplicar con todas las cajas cerradas y sin pedidos abiertos,
-- después de respaldar la base, y correr INMEDIATAMENTE DESPUÉS (desde backend/)
--   node database/scripts/migrar-catalogo-por-sucursal.js
-- que copia el catálogo de la principal a las demás sucursales activas y
-- les pasa su stock. Si no, las demás sucursales quedan sin catálogo. Revisar
-- los omitidos que imprime el script.

SET @principal = (SELECT MIN(id) FROM sucursales WHERE activo = 1);

-- categorias
ALTER TABLE categorias ADD COLUMN sucursal_id INT UNSIGNED NULL AFTER id;
UPDATE categorias SET sucursal_id = @principal;
ALTER TABLE categorias
  MODIFY sucursal_id INT UNSIGNED NOT NULL,
  ADD CONSTRAINT fk_categorias_sucursal FOREIGN KEY (sucursal_id) REFERENCES sucursales(id),
  ADD INDEX idx_categorias_sucursal (sucursal_id);

-- productos
ALTER TABLE productos ADD COLUMN sucursal_id INT UNSIGNED NULL AFTER id;
UPDATE productos SET sucursal_id = @principal;
ALTER TABLE productos
  MODIFY sucursal_id INT UNSIGNED NOT NULL,
  ADD CONSTRAINT fk_productos_sucursal FOREIGN KEY (sucursal_id) REFERENCES sucursales(id),
  ADD INDEX idx_productos_sucursal (sucursal_id);

-- grupos_opciones
ALTER TABLE grupos_opciones ADD COLUMN sucursal_id INT UNSIGNED NULL AFTER id;
UPDATE grupos_opciones SET sucursal_id = @principal;
ALTER TABLE grupos_opciones
  MODIFY sucursal_id INT UNSIGNED NOT NULL,
  ADD CONSTRAINT fk_grupos_opciones_sucursal FOREIGN KEY (sucursal_id) REFERENCES sucursales(id),
  ADD INDEX idx_grupos_opciones_sucursal (sucursal_id);

-- combos
ALTER TABLE combos ADD COLUMN sucursal_id INT UNSIGNED NULL AFTER id;
UPDATE combos SET sucursal_id = @principal;
ALTER TABLE combos
  MODIFY sucursal_id INT UNSIGNED NOT NULL,
  ADD CONSTRAINT fk_combos_sucursal FOREIGN KEY (sucursal_id) REFERENCES sucursales(id),
  ADD INDEX idx_combos_sucursal (sucursal_id);

-- promociones
ALTER TABLE promociones ADD COLUMN sucursal_id INT UNSIGNED NULL AFTER id;
UPDATE promociones SET sucursal_id = @principal;
ALTER TABLE promociones
  MODIFY sucursal_id INT UNSIGNED NOT NULL,
  ADD CONSTRAINT fk_promociones_sucursal FOREIGN KEY (sucursal_id) REFERENCES sucursales(id),
  ADD INDEX idx_promociones_sucursal (sucursal_id);
