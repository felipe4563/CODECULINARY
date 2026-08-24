-- backend/database/migrations/040_recuperar_pin.sql
-- Permite reutilizar cliente_pin_verificaciones para el flujo de "olvidé mi
-- PIN": en el paso de "pedir código" todavía no se conoce el PIN nuevo, así
-- que pin_hash queda NULL hasta que el cliente lo confirma.

ALTER TABLE cliente_pin_verificaciones
  MODIFY COLUMN pin_hash VARCHAR(255) NULL;
