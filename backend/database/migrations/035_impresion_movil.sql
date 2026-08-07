-- Modo de impresión por caja: 'fisica' (impresora fija, agente de Windows por
-- sockets, como hoy) o 'bluetooth' (celular con impresora térmica portátil,
-- vía RawBT). Cada caja decide el suyo de forma independiente.
ALTER TABLE cajas ADD COLUMN modo_impresion ENUM('fisica','bluetooth') NOT NULL DEFAULT 'fisica' AFTER nombre;

-- Destino del ticket de cocina: 'centralizada' (un solo destino compartido
-- por toda la sucursal, como hoy) o 'por_caja' (cada caja imprime su propio
-- ticket de cocina junto con el de venta — para negocios chicos sin una
-- estación de cocina fija).
INSERT IGNORE INTO configuraciones (clave, valor) VALUES ('cocina_destino', 'centralizada');
