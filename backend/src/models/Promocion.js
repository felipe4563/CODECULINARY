const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Promocion = sequelize.define('Promocion', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  nombre: { type: DataTypes.STRING(150) },
  tipo: { type: DataTypes.ENUM('porcentaje', 'monto'), allowNull: false, defaultValue: 'porcentaje' },
  valor: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  fecha_inicio: { type: DataTypes.DATEONLY },
  fecha_fin: { type: DataTypes.DATEONLY },
  dias_semana: { type: DataTypes.STRING(20) },
  activo: { type: DataTypes.TINYINT(1), defaultValue: 1 },
}, {
  tableName: 'promociones',
  createdAt: 'creado_en',
  updatedAt: 'actualizado_en',
});

module.exports = Promocion;
