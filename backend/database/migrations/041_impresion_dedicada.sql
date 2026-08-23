INSERT INTO configuraciones (clave, valor) VALUES ('cocina_pantalla_dedicada', 'false')
  ON DUPLICATE KEY UPDATE valor = valor;
