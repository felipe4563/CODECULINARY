ALTER TABLE productos
  ADD COLUMN es_pesable TINYINT(1) NOT NULL DEFAULT 0 AFTER precio;

ALTER TABLE detalle_pedidos
  ADD COLUMN peso DECIMAL(10,3) NULL AFTER cantidad;
