ALTER TABLE pedidos
  ADD COLUMN estado_cocina ENUM('pendiente','listo') NULL DEFAULT NULL AFTER estado;
