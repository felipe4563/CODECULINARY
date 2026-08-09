const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Estructura las opciones elegidas por línea de pedido — antes solo quedaban
// como texto libre en detalle_pedidos.nota (ticket/cocina siguen leyendo nota
// igual que siempre). Se usa para resolver receta_insumos.opcion_id al vender.
const DetallePedidoOpcion = sequelize.define('DetallePedidoOpcion', {
  detalle_pedido_id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true },
  opcion_id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true },
}, { tableName: 'detalle_pedido_opciones', timestamps: false });

module.exports = DetallePedidoOpcion;
