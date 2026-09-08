-- backend/database/migrations/045_libro_caja_metodo_pago_app_externa.sql
-- La migración 044 extendió pedidos.metodo_pago con 'app_externa' pero
-- olvidó libro_caja.metodo_pago, que _finalizarVenta también escribe
-- (ventas.service.js) — sin esto, toda venta prepagada por la app externa
-- rompe la transacción en una base con sql_mode estricto, o escribe ''
-- silenciosamente en una que no lo tiene (ya pasó en la base de dev: filas
-- existentes con metodo_pago='').

UPDATE libro_caja SET metodo_pago = 'efectivo' WHERE metodo_pago = '';

ALTER TABLE libro_caja
  MODIFY COLUMN metodo_pago ENUM('efectivo','qr','app_externa') DEFAULT 'efectivo';
