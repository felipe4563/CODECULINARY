-- Restringe (opcionalmente) un cupón a ciertos productos, en vez de
-- descontar siempre sobre todo el pedido. Sin filas acá, el cupón se
-- comporta exactamente igual que antes (descuento sobre el carrito
-- completo) — no rompe los cupones ya existentes.
CREATE TABLE cupon_productos (
  cupon_id INT UNSIGNED NOT NULL,
  producto_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (cupon_id, producto_id),
  KEY producto_id (producto_id),
  CONSTRAINT cupon_productos_cupon_fk FOREIGN KEY (cupon_id) REFERENCES cupones(id) ON DELETE CASCADE,
  CONSTRAINT cupon_productos_producto_fk FOREIGN KEY (producto_id) REFERENCES productos(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
