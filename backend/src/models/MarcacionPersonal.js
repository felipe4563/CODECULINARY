const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const MarcacionPersonal = sequelize.define('MarcacionPersonal', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  usuario_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  sucursal_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  fecha: { type: DataTypes.DATEONLY, allowNull: false },

  hora_entrada: { type: DataTypes.DATE, allowNull: false },
  lat_entrada: { type: DataTypes.DECIMAL(10, 7), allowNull: true },
  lng_entrada: { type: DataTypes.DECIMAL(10, 7), allowNull: true },
  verificacion_entrada: { type: DataTypes.ENUM('ok', 'fuera_de_rango', 'sin_verificar'), allowNull: false, defaultValue: 'sin_verificar', validate: { isIn: [['ok', 'fuera_de_rango', 'sin_verificar']] } },

  hora_salida: { type: DataTypes.DATE, allowNull: true },
  lat_salida: { type: DataTypes.DECIMAL(10, 7), allowNull: true },
  lng_salida: { type: DataTypes.DECIMAL(10, 7), allowNull: true },
  verificacion_salida: { type: DataTypes.ENUM('ok', 'fuera_de_rango', 'sin_verificar'), allowNull: true, validate: { isIn: [['ok', 'fuera_de_rango', 'sin_verificar']] } },

  estado: { type: DataTypes.ENUM('abierto', 'cerrado', 'cierre_automatico'), allowNull: false, defaultValue: 'abierto', validate: { isIn: [['abierto', 'cerrado', 'cierre_automatico']] } },

  hora_salida_propuesta: { type: DataTypes.DATE, allowNull: true },
  nota_propuesta: { type: DataTypes.STRING(255), allowNull: true },

  aprobado_por: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
  aprobado_en: { type: DataTypes.DATE, allowNull: true },
}, {
  tableName: 'marcaciones_personal',
  createdAt: 'creado_en',
  updatedAt: 'actualizado_en',
});

module.exports = MarcacionPersonal;
