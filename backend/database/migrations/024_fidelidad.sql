ALTER TABLE clientes
  ADD COLUMN puntos INT NOT NULL DEFAULT 0 AFTER direccion;

ALTER TABLE pedidos
  ADD COLUMN puntos_ganados INT NOT NULL DEFAULT 0 AFTER propina,
  ADD COLUMN puntos_canjeados INT NOT NULL DEFAULT 0 AFTER puntos_ganados;

INSERT INTO configuraciones (clave, valor) VALUES
  ('fidelidad_activa', 'false'),
  ('puntos_por_bs', '1'),
  ('valor_punto_bs', '0.10');
