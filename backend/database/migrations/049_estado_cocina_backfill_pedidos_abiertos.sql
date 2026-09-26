-- backend/database/migrations/049_estado_cocina_backfill_pedidos_abiertos.sql
-- Un pedido que ya estaba abierto (pendiente/listo) ANTES de que se
-- desplegara la migración 048 quedó con estado_cocina = NULL (el default
-- de una columna nueva) — invisible para la pantalla de Cocina, y
-- agregarItem() solo reabre 'listo' -> 'pendiente', nunca NULL ->
-- 'pendiente', así que una mesa sentada justo al momento del despliegue
-- desaparecería de Cocina para siempre. Backfill idempotente: seguro de
-- correr más de una vez, no toca nada que ya tenga estado_cocina asignado.
UPDATE pedidos
SET estado_cocina = 'pendiente'
WHERE estado IN ('pendiente', 'listo') AND estado_cocina IS NULL;
