-- Permite desactivar, por caja, la impresión automática del ticket de
-- cliente al vender (el de cocina ya se controla aparte con flujo_cocina).
-- Por defecto queda activo para no cambiar el comportamiento actual de
-- ninguna caja existente.
ALTER TABLE cajas ADD COLUMN imprimir_ticket_cliente TINYINT(1) NOT NULL DEFAULT 1 AFTER ancho_papel_bluetooth;
