const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ComboProducto = sequelize.define('ComboProducto', {
  combo_id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true },
  producto_id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true },
  cantidad: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
}, {
  tableName: 'combo_productos',
  timestamps: false,
});

module.exports = ComboProducto;
