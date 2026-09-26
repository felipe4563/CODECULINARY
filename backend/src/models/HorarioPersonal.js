const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const HorarioPersonal = sequelize.define('HorarioPersonal', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  usuario_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  dia_semana: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false },
  trabaja: { type: DataTypes.TINYINT(1), allowNull: false, defaultValue: 1 },
  hora_entrada: { type: DataTypes.TIME, allowNull: true },
  hora_salida: { type: DataTypes.TIME, allowNull: true },
}, {
  tableName: 'horarios_personal',
  createdAt: 'creado_en',
  updatedAt: 'actualizado_en',
});

module.exports = HorarioPersonal;
