-- Ancho de papel de la impresora Bluetooth portátil de esta caja (no aplica
-- al modo físico, que ya imprime a 80mm fijo vía el agente de Windows).
-- Existen impresoras portátiles de 58mm (32 columnas de texto) y de 80mm
-- (48 columnas) — hacerlo fijo en el código asumía siempre 58mm, lo cual
-- dejaba el ticket angosto en impresoras de 80mm.
ALTER TABLE cajas ADD COLUMN ancho_papel_bluetooth ENUM('58mm','80mm') NOT NULL DEFAULT '80mm' AFTER modo_impresion;
