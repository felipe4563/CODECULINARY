-- codigo_barras, codigo y costo nunca se llegaron a conectar a ningún flujo
-- real (sin búsqueda por código de barras, sin campo en el formulario de
-- producto, costo nunca se actualiza desde compras) — se eliminan para
-- limpiar la tabla.
ALTER TABLE productos
  DROP COLUMN codigo_barras,
  DROP COLUMN codigo,
  DROP COLUMN costo;
