ALTER TABLE usuarios
  ADD COLUMN debe_cambiar_contrasena TINYINT(1) NOT NULL DEFAULT 0 AFTER contrasena;
