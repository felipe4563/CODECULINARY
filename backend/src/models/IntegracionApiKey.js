const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const IntegracionApiKey = sequelize.define('IntegracionApiKey', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  sucursal_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  nombre_app: { type: DataTypes.STRING(100), allowNull: false },
  api_key_hash: { type: DataTypes.STRING(255), allowNull: false },
  activo: { type: DataTypes.BOOLEAN, defaultValue: true },
}, {
  tableName: 'integraciones_api_keys',
  createdAt: 'creado_en',
  updatedAt: 'actualizado_en',
});

module.exports = IntegracionApiKey;
