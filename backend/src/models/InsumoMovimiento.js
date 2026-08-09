const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const InsumoMovimiento = sequelize.define('InsumoMovimiento', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  insumo_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  sucursal_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  usuario_id: { type: DataTypes.INTEGER.UNSIGNED },
  tipo: { type: DataTypes.ENUM('compra', 'ajuste', 'consumo_venta'), allowNull: false },
  cantidad: { type: DataTypes.DECIMAL(10, 3), allowNull: false },
  stock_anterior: { type: DataTypes.DECIMAL(10, 3), allowNull: false },
  stock_nuevo: { type: DataTypes.DECIMAL(10, 3), allowNull: false },
  nota: { type: DataTypes.STRING(255) },
}, { tableName: 'insumo_movimientos', createdAt: 'creado_en', updatedAt: false });

module.exports = InsumoMovimiento;
