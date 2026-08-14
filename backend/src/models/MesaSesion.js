const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Registro de "quién está sentado en esta mesa ahora" — separado de
// mesa.estado. Mientras cerrada_en sea NULL, la mesa admite pedidos de
// autoservicio (ver mesas.service.js#obtenerSesionActiva) y el sistema
// avisa si el staff intenta abrir un pedido nuevo en la misma mesa en vez
// de mezclarlo con la sesión existente.
const MesaSesion = sequelize.define('MesaSesion', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  mesa_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  sucursal_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  abierta_en: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  cerrada_en: { type: DataTypes.DATE, allowNull: true },
  abierta_por: { type: DataTypes.ENUM('staff', 'autoservicio'), allowNull: false, defaultValue: 'staff' },
}, {
  tableName: 'mesa_sesiones',
  timestamps: false,
});

module.exports = MesaSesion;
