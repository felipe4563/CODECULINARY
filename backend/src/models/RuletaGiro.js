const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const RuletaGiro = sequelize.define('RuletaGiro', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  cliente_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  premio_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  cupon_id: { type: DataTypes.INTEGER.UNSIGNED },
  usuario_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  puntos_gastados: { type: DataTypes.INTEGER, allowNull: false },
}, {
  tableName: 'ruleta_giros',
  createdAt: 'creado_en',
  updatedAt: false,
});

module.exports = RuletaGiro;
