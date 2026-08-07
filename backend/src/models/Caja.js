const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Caja = sequelize.define('Caja', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  sucursal_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  nombre: { type: DataTypes.STRING(100), allowNull: false },
  modo_impresion: { type: DataTypes.ENUM('fisica', 'bluetooth'), allowNull: false, defaultValue: 'fisica' },
  ancho_papel_bluetooth: { type: DataTypes.ENUM('58mm', '80mm'), allowNull: false, defaultValue: '80mm' },
  activo: { type: DataTypes.TINYINT(1), defaultValue: 1 },
}, {
  tableName: 'cajas',
  createdAt: 'creado_en',
  updatedAt: 'actualizado_en',
});

module.exports = Caja;
