-- Renombra `peso` a `probabilidad`: el peso ya no determina el tamaño
-- visual del segmento en la ruleta (todos los segmentos se dibujan del
-- mismo tamaño), solo la probabilidad real de que salga ese premio.
ALTER TABLE ruleta_premios CHANGE peso probabilidad INT UNSIGNED NOT NULL DEFAULT 1;
