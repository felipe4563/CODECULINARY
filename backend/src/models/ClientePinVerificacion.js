const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Fila transitoria: alguien pidió crear un PIN para este cliente y está
// esperando que confirme el código de 6 dígitos que le mandamos por email.
// Se borra al confirmarse o queda vencida (ver clientePublico.service.js).
// cliente_id es único — una solicitud nueva reemplaza cualquier pendiente
// anterior de ese mismo cliente.
const ClientePinVerificacion = sequelize.define('ClientePinVerificacion', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  cliente_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, unique: true },
  // NULL mientras la fila representa un pedido de recuperación de PIN: en
  // ese flujo todavía no se conoce el PIN nuevo cuando se manda el código,
  // recién se define al confirmar (ver recuperarPinConfirmar).
  pin_hash: { type: DataTypes.STRING(255), allowNull: true },
  email: { type: DataTypes.STRING(255), allowNull: false },
  codigo_hash: { type: DataTypes.STRING(255), allowNull: false },
  intentos: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  expira_en: { type: DataTypes.DATE, allowNull: false },
}, {
  tableName: 'cliente_pin_verificaciones',
  createdAt: 'creado_en',
  updatedAt: false,
});

module.exports = ClientePinVerificacion;
