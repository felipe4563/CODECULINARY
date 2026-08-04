-- Promo de cumpleaños automática: guarda la fecha de nacimiento del cliente
-- y genera, con anticipación configurable, un cupón personal (exclusivo de
-- ese cliente_id, reutilizando el mecanismo de cupones ya existente).
ALTER TABLE clientes
  ADD COLUMN fecha_nacimiento DATE DEFAULT NULL AFTER direccion;

INSERT INTO configuraciones (clave, valor) VALUES
  ('cumple_activo', 'false'),
  ('cumple_dias_anticipacion', '5'),
  ('cumple_tipo', 'porcentaje'),
  ('cumple_valor', '10'),
  ('cumple_vigencia_dias', '10');
