-- Reemplaza el booleano `usado` por un contador de usos, para permitir
-- cupones válidos varias veces (ej. "válido 3 veces"), con dos límites
-- independientes y opcionales: total global y por cliente. También permite
-- restringir un cupón a un cliente específico (ej. promo de cumpleaños).
ALTER TABLE cupones
  ADD COLUMN usos_maximos INT UNSIGNED NOT NULL DEFAULT 1 AFTER valor,
  ADD COLUMN usos_actuales INT UNSIGNED NOT NULL DEFAULT 0 AFTER usos_maximos,
  ADD COLUMN limite_por_cliente INT UNSIGNED DEFAULT NULL AFTER usos_actuales,
  ADD COLUMN cliente_id INT UNSIGNED DEFAULT NULL AFTER limite_por_cliente;

-- Backfill: todo lo ya creado era de un solo uso, así que mantiene ese
-- comportamiento exacto tras el cambio.
UPDATE cupones SET usos_actuales = usado;

ALTER TABLE cupones
  DROP COLUMN usado,
  ADD KEY cliente_id (cliente_id),
  ADD CONSTRAINT cupones_cliente_fk FOREIGN KEY (cliente_id) REFERENCES clientes(id);
