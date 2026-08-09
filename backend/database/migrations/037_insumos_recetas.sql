-- Insumos (ingredientes de cocina, no vendibles) + recetas de consumo automático.
-- Ver docs/superpowers/specs/2026-08-08-insumos-recetas-design.md

CREATE TABLE `insumos` (
  `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `nombre` varchar(100) NOT NULL,
  `unidad_medida` enum('kilogramo','gramo','litro','mililitro','arroba','libra','unidad') NOT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `creado_en` timestamp NOT NULL DEFAULT current_timestamp(),
  `actualizado_en` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `insumo_stock_sucursal` (
  `insumo_id` int(10) UNSIGNED NOT NULL,
  `sucursal_id` int(10) UNSIGNED NOT NULL,
  `stock` decimal(10,3) NOT NULL DEFAULT 0.000,
  PRIMARY KEY (`insumo_id`, `sucursal_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `insumo_stock_sucursal`
  ADD CONSTRAINT `insumo_stock_sucursal_ibfk_1` FOREIGN KEY (`insumo_id`) REFERENCES `insumos` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `insumo_stock_sucursal_ibfk_2` FOREIGN KEY (`sucursal_id`) REFERENCES `sucursales` (`id`) ON DELETE CASCADE;

CREATE TABLE `insumo_movimientos` (
  `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `insumo_id` int(10) UNSIGNED NOT NULL,
  `sucursal_id` int(10) UNSIGNED NOT NULL,
  `usuario_id` int(10) UNSIGNED DEFAULT NULL,
  `tipo` enum('compra','ajuste','consumo_venta') NOT NULL,
  `cantidad` decimal(10,3) NOT NULL,
  `stock_anterior` decimal(10,3) NOT NULL,
  `stock_nuevo` decimal(10,3) NOT NULL,
  `nota` varchar(255) DEFAULT NULL,
  `creado_en` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `insumo_movimientos`
  ADD CONSTRAINT `insumo_movimientos_ibfk_1` FOREIGN KEY (`insumo_id`) REFERENCES `insumos` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `insumo_movimientos_ibfk_2` FOREIGN KEY (`sucursal_id`) REFERENCES `sucursales` (`id`) ON DELETE CASCADE;

-- detalle_compras: admite líneas de insumo además de producto (una u otra, nunca ambas).
-- cantidad pasa de entero a decimal para poder comprar insumos por 2.5 kg, 0.75 arroba, etc.
ALTER TABLE `detalle_compras`
  ADD COLUMN `insumo_id` int(10) UNSIGNED DEFAULT NULL AFTER `producto_id`,
  MODIFY COLUMN `producto_id` int(10) UNSIGNED DEFAULT NULL,
  MODIFY COLUMN `cantidad` decimal(10,3) NOT NULL;

ALTER TABLE `detalle_compras`
  ADD CONSTRAINT `detalle_compras_ibfk_3` FOREIGN KEY (`insumo_id`) REFERENCES `insumos` (`id`);

-- Receta: qué insumo(s) y cuánto consume un producto al venderse.
-- opcion_id NULL = consumo base (siempre); opcion_id con valor = solo si esa opción fue elegida.
CREATE TABLE `receta_insumos` (
  `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `producto_id` int(10) UNSIGNED NOT NULL,
  `opcion_id` int(10) UNSIGNED DEFAULT NULL,
  `insumo_id` int(10) UNSIGNED NOT NULL,
  `cantidad` decimal(10,3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `receta_insumos`
  ADD CONSTRAINT `receta_insumos_ibfk_1` FOREIGN KEY (`producto_id`) REFERENCES `productos` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `receta_insumos_ibfk_2` FOREIGN KEY (`opcion_id`) REFERENCES `opciones` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `receta_insumos_ibfk_3` FOREIGN KEY (`insumo_id`) REFERENCES `insumos` (`id`) ON DELETE CASCADE;

-- Estructura las opciones elegidas por línea de pedido (antes solo quedaban
-- como texto libre en detalle_pedidos.nota) — necesario para resolver
-- receta_insumos.opcion_id al confirmar la venta.
CREATE TABLE `detalle_pedido_opciones` (
  `detalle_pedido_id` int(10) UNSIGNED NOT NULL,
  `opcion_id` int(10) UNSIGNED NOT NULL,
  PRIMARY KEY (`detalle_pedido_id`, `opcion_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `detalle_pedido_opciones`
  ADD CONSTRAINT `detalle_pedido_opciones_ibfk_1` FOREIGN KEY (`detalle_pedido_id`) REFERENCES `detalle_pedidos` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `detalle_pedido_opciones_ibfk_2` FOREIGN KEY (`opcion_id`) REFERENCES `opciones` (`id`) ON DELETE CASCADE;

-- Permisos del módulo insumos, otorgados de entrada al rol Administrador (id 1).
INSERT INTO `permisos` (`id`, `modulo`, `accion`, `descripcion`) VALUES
(65, 'insumos', 'ver', 'Ver insumos'),
(66, 'insumos', 'crear', 'Crear insumos'),
(67, 'insumos', 'editar', 'Editar insumos (incluye receta y ajustes de stock)'),
(68, 'insumos', 'eliminar', 'Desactivar insumos');

INSERT INTO `roles_permisos` (`rol_id`, `permiso_id`) VALUES (1,65),(1,66),(1,67),(1,68);
