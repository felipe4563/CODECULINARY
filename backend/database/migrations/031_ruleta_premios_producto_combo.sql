-- Premios de la ruleta que regalan un producto o combo específico (no solo
-- descuentos genéricos). El precio no se guarda fijo acá: se toma el precio
-- vigente del producto/combo en el momento del giro, para no quedar
-- desactualizado si el precio del menú cambia después.
ALTER TABLE ruleta_premios
  MODIFY COLUMN tipo ENUM('porcentaje','fijo','producto_gratis','combo_gratis','nada') NOT NULL DEFAULT 'nada',
  ADD COLUMN producto_id INT UNSIGNED DEFAULT NULL AFTER valor,
  ADD COLUMN combo_id INT UNSIGNED DEFAULT NULL AFTER producto_id;

ALTER TABLE ruleta_premios
  ADD CONSTRAINT ruleta_premios_producto_fk FOREIGN KEY (producto_id) REFERENCES productos(id),
  ADD CONSTRAINT ruleta_premios_combo_fk FOREIGN KEY (combo_id) REFERENCES combos(id);
