const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// opcion_id NULL = consumo base (siempre que se venda el producto).
// opcion_id con valor = solo se descuenta si el cliente eligió esa opción.
const RecetaInsumo = sequelize.define('RecetaInsumo', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  producto_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  opcion_id: { type: DataTypes.INTEGER.UNSIGNED },
  insumo_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  cantidad: { type: DataTypes.DECIMAL(10, 3), allowNull: false },
}, { tableName: 'receta_insumos', timestamps: false });

module.exports = RecetaInsumo;
