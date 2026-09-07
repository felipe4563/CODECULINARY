// backend/src/models/DetallePedidoComboOpcion.js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Opción elegida para un producto específico dentro de un combo — ver
// docs/superpowers/specs/2026-09-07-opciones-en-combos-design.md. A
// diferencia de DetallePedidoOpcion (para productos sueltos), acá hace
// falta el campo `producto_id` porque un combo es UNA sola fila de
// DetallePedido que puede contener varios productos, cada uno con su
// propia elección.
const DetallePedidoComboOpcion = sequelize.define('DetallePedidoComboOpcion', {
  detalle_pedido_id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true },
  producto_id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true },
  opcion_id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true },
}, { tableName: 'detalle_pedido_combo_opciones', timestamps: false });

module.exports = DetallePedidoComboOpcion;
