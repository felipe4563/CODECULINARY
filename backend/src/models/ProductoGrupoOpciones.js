const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ProductoGrupoOpciones = sequelize.define('ProductoGrupoOpciones', {
  producto_id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true },
  grupo_opciones_id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true },
  orden: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  obligatorio: { type: DataTypes.TINYINT(1), allowNull: false, defaultValue: 0 },
}, {
  tableName: 'producto_grupos_opciones',
  timestamps: false,
});

module.exports = ProductoGrupoOpciones;
