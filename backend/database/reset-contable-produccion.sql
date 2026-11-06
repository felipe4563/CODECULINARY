-- Reseteo de todo lo transaccional/contable a cero en producción.
-- NO toca: catálogo (productos, categorías, grupos de opciones), stock
-- actual (producto_stock_sucursal, productos.stock), usuarios, roles,
-- sucursales, cajas (los registros físicos), proveedores, clientes,
-- configuraciones, áreas, mesas (solo se les resetea el estado).
--
-- ¡HACER BACKUP ANTES DE CORRER ESTO! Es irreversible.
--   mysqldump -u <user> -p <db_name> > backup_antes_de_reset_$(date +%Y%m%d_%H%M).sql
--
-- Uso:
--   mysql -u <user> -p <db_name> < backend/database/reset-contable-produccion.sql
--
-- Este script trunca la base `restaurante_db` (el USE de abajo lo fija
-- explícitamente para que no dependa de qué base tengas seleccionada en
-- phpMyAdmin/consola). Si tu base de producción tiene otro nombre, cambia
-- la línea USE antes de ejecutar.
--
-- IMPORTANTE: ejecuta TODO el script de una sola vez (botón "Continuar"/
-- "Go" con el archivo completo, o `SOURCE archivo.sql`), no lo pegues por
-- partes ni lo corras línea por línea. El SET FOREIGN_KEY_CHECKS=0 solo
-- protege dentro de la misma sesión/ejecución; si vuelves a mandar una
-- consulta suelta después, ya no aplica y los TRUNCATE fallarán por FK.
--
-- NOTA: TRUNCATE TABLE falla (#1701) sobre cualquier tabla referenciada
-- por una FK de otra tabla, aunque esa otra tabla esté vacía y aunque
-- FOREIGN_KEY_CHECKS esté en 0 (depende de la versión/driver). Por eso
-- `pedidos`, `detalle_pedidos`, `mesa_sesiones`, `sesiones_caja` y
-- `compras` (referenciadas desde otras tablas) se vacían
-- con DELETE FROM en vez de TRUNCATE, reseteando su AUTO_INCREMENT a mano
-- para que quede igual que un truncate.

USE `restaurante_db`;

-- sesiones_caja.cerrado_en puede tener DEFAULT '0000-00-00 00:00:00' (esquema
-- viejo); bajo sql_mode estricto eso rompe el ALTER TABLE ... AUTO_INCREMENT
-- (error 1067). Se relaja solo para esta sesión y se restaura al final,
-- igual que en la migración 016.
SET @old_sql_mode = @@SESSION.sql_mode;
SET SESSION sql_mode = '';

SET FOREIGN_KEY_CHECKS = 0;

-- Ventas / pedidos
TRUNCATE TABLE detalle_pedido_opciones;
TRUNCATE TABLE detalle_pedido_combo_opciones;
DELETE FROM detalle_pedidos;
ALTER TABLE detalle_pedidos AUTO_INCREMENT = 1;
TRUNCATE TABLE pagos_qr;
DELETE FROM pedidos;
ALTER TABLE pedidos AUTO_INCREMENT = 1;
DELETE FROM mesa_sesiones;
ALTER TABLE mesa_sesiones AUTO_INCREMENT = 1;

-- Caja / contabilidad
TRUNCATE TABLE detalle_arqueo;
TRUNCATE TABLE gastos;
TRUNCATE TABLE libro_caja;
DELETE FROM sesiones_caja;
ALTER TABLE sesiones_caja AUTO_INCREMENT = 1;

-- Compras a proveedores
TRUNCATE TABLE detalle_compras;
DELETE FROM compras;
ALTER TABLE compras AUTO_INCREMENT = 1;

-- Historial de movimientos de inventario e insumos (NO toca el stock actual)
TRUNCATE TABLE registros_inventario;
TRUNCATE TABLE insumo_movimientos;

SET FOREIGN_KEY_CHECKS = 1;
SET SESSION sql_mode = @old_sql_mode;

-- Sin pedidos, ninguna mesa debería seguir marcada como ocupada/reservada.
UPDATE mesas SET estado = 'disponible' WHERE estado <> 'disponible';

-- Verificación: todo en 0 salvo mesas (que sigue teniendo sus filas, solo
-- resetea el estado) y todo lo que no se tocó (productos, categorías,
-- stock, usuarios, etc).
SELECT 'detalle_pedido_opciones' t, COUNT(*) n FROM detalle_pedido_opciones
UNION ALL SELECT 'detalle_pedido_combo_opciones', COUNT(*) FROM detalle_pedido_combo_opciones
UNION ALL SELECT 'detalle_pedidos', COUNT(*) FROM detalle_pedidos
UNION ALL SELECT 'pagos_qr', COUNT(*) FROM pagos_qr
UNION ALL SELECT 'pedidos', COUNT(*) FROM pedidos
UNION ALL SELECT 'mesa_sesiones', COUNT(*) FROM mesa_sesiones
UNION ALL SELECT 'detalle_arqueo', COUNT(*) FROM detalle_arqueo
UNION ALL SELECT 'gastos', COUNT(*) FROM gastos
UNION ALL SELECT 'libro_caja', COUNT(*) FROM libro_caja
UNION ALL SELECT 'sesiones_caja', COUNT(*) FROM sesiones_caja
UNION ALL SELECT 'detalle_compras', COUNT(*) FROM detalle_compras
UNION ALL SELECT 'compras', COUNT(*) FROM compras
UNION ALL SELECT 'registros_inventario', COUNT(*) FROM registros_inventario
UNION ALL SELECT 'insumo_movimientos', COUNT(*) FROM insumo_movimientos
UNION ALL SELECT 'mesas_no_disponibles', COUNT(*) FROM mesas WHERE estado <> 'disponible';
