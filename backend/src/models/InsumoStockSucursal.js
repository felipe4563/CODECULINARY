const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const InsumoStockSucursal = sequelize.define('InsumoStockSucursal', {
  insumo_id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true },
  sucursal_id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true },
  stock: { type: DataTypes.DECIMAL(10, 3), allowNull: false, defaultValue: 0 },
}, {
  tableName: 'insumo_stock_sucursal',
  timestamps: false,
});

module.exports = InsumoStockSucursal;
