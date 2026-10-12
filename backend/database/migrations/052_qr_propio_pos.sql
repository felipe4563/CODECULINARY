-- backend/database/migrations/052_qr_propio_pos.sql
-- Cobro QR del POS con el QR propio del negocio (verificación manual).
-- El dueño sube la imagen de su QR bancario en Configuración → Negocio y
-- elige qué método QR usa el POS: 'codepay' (automático, como hasta ahora)
-- o 'manual' (se muestra el QR del negocio y el cajero confirma el pago
-- viendo el comprobante del cliente). El autoservicio por mesa sigue
-- siempre con CodePay. metodo_pago sigue siendo 'qr' en ambos casos, así
-- caja, arqueo, libro de caja y reportes no cambian.

INSERT INTO configuraciones (clave, valor) VALUES
  ('qr_pos_modo', 'codepay'),
  ('qr_pago_imagen', ''),
  ('qr_pago_texto', '');

ALTER TABLE pedidos
  ADD COLUMN qr_tipo ENUM('codepay','manual') NULL AFTER metodo_pago,
  ADD COLUMN qr_confirmado_por INT UNSIGNED NULL AFTER qr_tipo,
  ADD FOREIGN KEY (qr_confirmado_por) REFERENCES usuarios(id);
