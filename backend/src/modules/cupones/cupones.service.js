const { Cupon, Pedido, Cliente } = require('../../models');
const { estaActivoHoy } = require('../../utils/disponibilidad');

const INCLUDE_CUPON = [{ model: Cliente, as: 'cliente', attributes: ['id', 'nombre'], required: false }];

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

function _validarUsos(usos_maximos, limite_por_cliente) {
  const maxNum = parseInt(usos_maximos, 10);
  if (!(maxNum >= 1)) {
    throw Object.assign(new Error('El límite total de usos debe ser al menos 1'), { status: 400 });
  }
  if (limite_por_cliente !== undefined && limite_por_cliente !== null && limite_por_cliente !== '') {
    const porClienteNum = parseInt(limite_por_cliente, 10);
    if (!(porClienteNum >= 1)) {
      throw Object.assign(new Error('El límite por cliente debe ser al menos 1'), { status: 400 });
    }
    if (porClienteNum > maxNum) {
      throw Object.assign(new Error('El límite por cliente no puede ser mayor al límite total de usos'), { status: 400 });
    }
  }
}

async function listar() {
  return Cupon.findAll({ include: INCLUDE_CUPON, order: [['creado_en', 'DESC']] });
}

async function obtener(id) {
  const cupon = await Cupon.findByPk(id, { include: INCLUDE_CUPON });
  if (!cupon) throw Object.assign(new Error('Cupón no encontrado'), { status: 404 });
  return cupon;
}

async function crear({ codigo, tipo = 'fijo', valor, fecha_expiracion, activo = 1, usos_maximos = 1, limite_por_cliente, cliente_id }, usuario_id) {
  const codigoNorm = _normalizarCodigo(codigo);
  if (!codigoNorm) throw Object.assign(new Error('El código es requerido'), { status: 400 });
  _validarTipoValor(tipo, valor);
  _validarUsos(usos_maximos, limite_por_cliente);

  const existente = await Cupon.findOne({ where: { codigo: codigoNorm } });
  if (existente) throw Object.assign(new Error('Ya existe un cupón con ese código'), { status: 409 });

  const creado = await Cupon.create({
    codigo: codigoNorm, tipo, valor, fecha_expiracion: fecha_expiracion || null, activo,
    usos_maximos: usos_maximos || 1, limite_por_cliente: limite_por_cliente || null,
    cliente_id: cliente_id || null, creado_por: usuario_id || null,
  });
  return obtener(creado.id);
}

async function actualizar(id, { tipo, valor, fecha_expiracion, activo, usos_maximos, limite_por_cliente, cliente_id }) {
  const cupon = await obtener(id);
  const tipoFinal = tipo ?? cupon.tipo;
  const valorFinal = valor ?? cupon.valor;
  if (tipo !== undefined || valor !== undefined) _validarTipoValor(tipoFinal, valorFinal);

  if (usos_maximos !== undefined || limite_por_cliente !== undefined) {
    const maxFinal = usos_maximos !== undefined ? usos_maximos : cupon.usos_maximos;
    const porClienteFinal = limite_por_cliente !== undefined ? limite_por_cliente : cupon.limite_por_cliente;
    _validarUsos(maxFinal, porClienteFinal);
  }
  if (usos_maximos !== undefined && parseInt(usos_maximos, 10) < cupon.usos_actuales) {
    throw Object.assign(new Error(`El cupón ya se usó ${cupon.usos_actuales} veces; el límite no puede ser menor`), { status: 400 });
  }

  const datos = {};
  if (tipo !== undefined) datos.tipo = tipo;
  if (valor !== undefined) datos.valor = valor;
  if (fecha_expiracion !== undefined) datos.fecha_expiracion = fecha_expiracion || null;
  if (activo !== undefined) datos.activo = activo;
  if (usos_maximos !== undefined) datos.usos_maximos = usos_maximos;
  if (limite_por_cliente !== undefined) datos.limite_por_cliente = limite_por_cliente || null;
  if (cliente_id !== undefined) datos.cliente_id = cliente_id || null;
  await cupon.update(datos);
  return obtener(id);
}

async function eliminar(id) {
  const cupon = await obtener(id);
  if (cupon.usos_actuales > 0) {
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
// cobros concurrentes con el mismo código no superen su límite de usos.
// `cliente_id` es el cliente de la venta (si se eligió uno) — hace falta
// para los cupones exclusivos de un cliente o con límite por cliente.
async function resolver(codigo, subtotal, cliente_id, transaction) {
  if (!codigo) return { cupon: null, descuento: 0 };
  const codigoNorm = _normalizarCodigo(codigo);
  const cupon = await Cupon.findOne({
    where: { codigo: codigoNorm },
    ...(transaction ? { transaction, lock: transaction.LOCK.UPDATE } : {}),
  });
  if (!cupon || !cupon.activo) {
    throw Object.assign(new Error('El cupón no es válido'), { status: 400 });
  }
  if (cupon.usos_actuales >= cupon.usos_maximos) {
    throw Object.assign(new Error('El cupón ya alcanzó su límite de usos'), { status: 400 });
  }
  if (!estaActivoHoy({ fecha_fin: cupon.fecha_expiracion })) {
    throw Object.assign(new Error('El cupón está vencido'), { status: 400 });
  }
  if (cupon.cliente_id && cupon.cliente_id !== Number(cliente_id)) {
    throw Object.assign(new Error('Este cupón es exclusivo de otro cliente'), { status: 400 });
  }
  if (cupon.limite_por_cliente) {
    if (!cliente_id) {
      throw Object.assign(new Error('Este cupón requiere seleccionar un cliente'), { status: 400 });
    }
    const usosCliente = await Pedido.count({
      where: { cupon_id: cupon.id, cliente_id, estado: 'completado' },
      ...(transaction ? { transaction } : {}),
    });
    if (usosCliente >= cupon.limite_por_cliente) {
      throw Object.assign(new Error('Este cliente ya alcanzó el límite de usos de este cupón'), { status: 400 });
    }
  }
  const bruto = cupon.tipo === 'porcentaje' ? subtotal * (parseFloat(cupon.valor) / 100) : parseFloat(cupon.valor);
  return { cupon, descuento: Math.min(subtotal, Math.max(0, bruto)) };
}

// Previsualización pública (sin transacción) para el checkout: valida y
// devuelve el descuento calculado, sin persistir nada.
async function validar(codigo, subtotal, cliente_id) {
  const { cupon, descuento } = await resolver(codigo, subtotal, cliente_id);
  return { codigo: cupon.codigo, tipo: cupon.tipo, valor: parseFloat(cupon.valor), descuento };
}

module.exports = { listar, obtener, crear, actualizar, eliminar, resolver, validar };
