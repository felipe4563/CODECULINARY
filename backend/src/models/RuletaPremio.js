const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const RuletaPremio = sequelize.define('RuletaPremio', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  nombre: { type: DataTypes.STRING(100), allowNull: false },
  tipo: { type: DataTypes.ENUM('porcentaje', 'fijo', 'producto_gratis', 'combo_gratis', 'nada'), allowNull: false, defaultValue: 'nada' },
  valor: { type: DataTypes.DECIMAL(10, 2) },
  producto_id: { type: DataTypes.INTEGER.UNSIGNED },
  combo_id: { type: DataTypes.INTEGER.UNSIGNED },
  probabilidad: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
  color: { type: DataTypes.STRING(20) },
  activo: { type: DataTypes.TINYINT(1), defaultValue: 1 },
  orden: { type: DataTypes.INTEGER, defaultValue: 0 },
}, {
  tableName: 'ruleta_premios',
  createdAt: 'creado_en',
  updatedAt: 'actualizado_en',
});

module.exports = RuletaPremio;
