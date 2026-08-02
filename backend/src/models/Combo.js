const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Combo = sequelize.define('Combo', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  nombre: { type: DataTypes.STRING(150), allowNull: false },
  descripcion: { type: DataTypes.STRING(255) },
  precio: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  imagen: { type: DataTypes.STRING(255) },
  activo: { type: DataTypes.TINYINT(1), defaultValue: 1 },
  fecha_inicio: { type: DataTypes.DATEONLY },
  fecha_fin: { type: DataTypes.DATEONLY },
  dias_semana: { type: DataTypes.STRING(20) },
}, {
  tableName: 'combos',
  createdAt: 'creado_en',
  updatedAt: 'actualizado_en',
});

module.exports = Combo;
