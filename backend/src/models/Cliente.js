const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Cliente = sequelize.define('Cliente', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  nombre: { type: DataTypes.STRING(255), allowNull: false },
  tipo_documento: { type: DataTypes.STRING(50), defaultValue: 'CI' },
  numero_documento: { type: DataTypes.STRING(50), unique: true },
  email: { type: DataTypes.STRING(255) },
  telefono: { type: DataTypes.STRING(50) },
  direccion: { type: DataTypes.STRING(255) },
  fecha_nacimiento: { type: DataTypes.DATEONLY },
  puntos: { type: DataTypes.INTEGER, defaultValue: 0 },
  pin_hash: { type: DataTypes.STRING(255), allowNull: true },
  pin_intentos_fallidos: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  pin_bloqueado_hasta: { type: DataTypes.DATE, allowNull: true },
}, {
  tableName: 'clientes',
  createdAt: 'creado_en',
  updatedAt: 'actualizado_en',
});

module.exports = Cliente;
