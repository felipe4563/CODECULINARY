const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Cupon = sequelize.define('Cupon', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  codigo: { type: DataTypes.STRING(30), allowNull: false, unique: true },
  tipo: { type: DataTypes.ENUM('fijo', 'porcentaje'), allowNull: false, defaultValue: 'fijo' },
  valor: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  fecha_expiracion: { type: DataTypes.DATEONLY },
  activo: { type: DataTypes.TINYINT(1), defaultValue: 1 },
  usado: { type: DataTypes.TINYINT(1), defaultValue: 0 },
  usado_en: { type: DataTypes.DATE },
  creado_por: { type: DataTypes.INTEGER.UNSIGNED },
}, {
  tableName: 'cupones',
  createdAt: 'creado_en',
  updatedAt: false,
});

module.exports = Cupon;
