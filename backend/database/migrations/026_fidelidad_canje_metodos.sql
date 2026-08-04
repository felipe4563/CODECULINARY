-- Permite decidir, por separado, si el canje de puntos se acepta en pago
-- efectivo y/o en pago QR. Antes solo funcionaba en efectivo (limitación de
-- código); con el pago QR el default queda apagado hasta que el negocio lo
-- habilite explícitamente, porque implica reservar los puntos del cliente
-- al generar el QR (ver iniciarPagoQr en ventas.service.js).
INSERT INTO configuraciones (clave, valor) VALUES
  ('fidelidad_canje_efectivo', 'true'),
  ('fidelidad_canje_qr', 'false');
