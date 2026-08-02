const { Cupon } = require('../../models');
const { estaActivoHoy } = require('../../utils/disponibilidad');

function _normalizarCodigo(codigo) {
  return (codigo || '').trim().toUpperCase();
}

function _validarTipoValor(tipo, valor) {
  if (!['fijo', 'porcentaje'].includes(tipo)) {
    throw Object.assign(new Error("El tipo debe ser 'fijo' o 'porcentaje'"), { status: 400 });
  }
  if (!(parseFloat(valor) > 0)) {
    throw Object.assign(new Error('El valor debe ser mayor a 0'), { status: 400 });
  }
  if (tipo === 'porcentaje' && parseFloat(valor) > 100) {
    throw Object.assign(new Error('El porcentaje no puede superar 100'), { status: 400 });
  }
}

async function listar() {
  return Cupon.findAll({ order: [['creado_en', 'DESC']] });
}

async function obtener(id) {
  const cupon = await Cupon.findByPk(id);
  if (!cupon) throw Object.assign(new Error('Cupón no encontrado'), { status: 404 });
  return cupon;
}

async function crear({ codigo, tipo = 'fijo', valor, fecha_expiracion, activo = 1 }, usuario_id) {
  const codigoNorm = _normalizarCodigo(codigo);
  if (!codigoNorm) throw Object.assign(new Error('El código es requerido'), { status: 400 });
  _validarTipoValor(tipo, valor);

  const existente = await Cupon.findOne({ where: { codigo: codigoNorm } });
  if (existente) throw Object.assign(new Error('Ya existe un cupón con ese código'), { status: 409 });

  return Cupon.create({
    codigo: codigoNorm, tipo, valor, fecha_expiracion: fecha_expiracion || null, activo, creado_por: usuario_id || null,
  });
}

async function actualizar(id, { tipo, valor, fecha_expiracion, activo }) {
  const cupon = await obtener(id);
  const tipoFinal = tipo ?? cupon.tipo;
  const valorFinal = valor ?? cupon.valor;
  if (tipo !== undefined || valor !== undefined) _validarTipoValor(tipoFinal, valorFinal);

  const datos = {};
  if (tipo !== undefined) datos.tipo = tipo;
  if (valor !== undefined) datos.valor = valor;
  if (fecha_expiracion !== undefined) datos.fecha_expiracion = fecha_expiracion || null;
  if (activo !== undefined) datos.activo = activo;
  await cupon.update(datos);
  return cupon;
}

async function eliminar(id) {
  const cupon = await obtener(id);
  if (cupon.usado) {
    // Ya está referenciado por una venta histórica: no se puede borrar sin
    // romper esa venta, así que solo se desactiva (mismo patrón que combos).
    await cupon.update({ activo: 0 });
    return { eliminado: false };
  }
  await cupon.destroy();
  return { eliminado: true };
}

// Valida un código de cupón contra `subtotal` y calcula su descuento en Bs,
// sin marcarlo como usado. `transaction`: si se pasa, bloquea la fila del
// cupón (la validación real, dentro de la transacción que finaliza la
// venta); sin transacción es solo una previsualización rápida en el
// checkout — nunca la fuente de verdad del descuento final, para que dos
// cobros concurrentes con el mismo código de un solo uso no lo apliquen dos veces.
async function resolver(codigo, subtotal, transaction) {
  if (!codigo) return { cupon: null, descuento: 0 };
  const codigoNorm = _normalizarCodigo(codigo);
  const cupon = await Cupon.findOne({
    where: { codigo: codigoNorm },
    ...(transaction ? { transaction, lock: transaction.LOCK.UPDATE } : {}),
  });
  if (!cupon || !cupon.activo || cupon.usado) {
    throw Object.assign(new Error('El cupón no es válido o ya fue utilizado'), { status: 400 });
  }
  if (!estaActivoHoy({ fecha_fin: cupon.fecha_expiracion })) {
    throw Object.assign(new Error('El cupón está vencido'), { status: 400 });
  }
  const bruto = cupon.tipo === 'porcentaje' ? subtotal * (parseFloat(cupon.valor) / 100) : parseFloat(cupon.valor);
  return { cupon, descuento: Math.min(subtotal, Math.max(0, bruto)) };
}

// Previsualización pública (sin transacción) para el checkout: valida y
// devuelve el descuento calculado, sin persistir nada.
async function validar(codigo, subtotal) {
  const { cupon, descuento } = await resolver(codigo, subtotal);
  return { codigo: cupon.codigo, tipo: cupon.tipo, valor: parseFloat(cupon.valor), descuento };
}

module.exports = { listar, obtener, crear, actualizar, eliminar, resolver, validar };
