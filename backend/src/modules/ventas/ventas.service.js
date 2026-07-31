const { Op } = require('sequelize');
const {
  Pedido, DetallePedido, Mesa, Producto, Cliente, SesionCaja, LibroCaja, Configuracion, PagoQr, sequelize,
} = require('../../models');
const { emitir } = require('../../socket');
const { ajustarStockSucursal } = require('../inventario/stock.service');
const codepayClient = require('../../integrations/codepay/codepay.client');
const { calcularPrecioPesable } = require('../../utils/precio');

// Rango del día calendario en hora de Bolivia (-04:00), sin depender de la
// zona horaria del proceso de Node/VPS. Por defecto usa el momento actual;
// se puede pasar una fecha de referencia para obtener el rango del día en
// que ocurrió esa fecha (p. ej. el día en que se creó un pedido).
function _rangoDiaBolivia(referencia = new Date()) {
  const fecha = new Date(referencia.getTime() - 4 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return {
    inicio: new Date(`${fecha}T00:00:00-04:00`),
    fin: new Date(`${fecha}T23:59:59.999-04:00`),
  };
}

// Traduce un ítem del pedido (cantidad o peso) a los valores que se guardan
// en detalle_pedidos, según si el producto se vende por peso o por unidad.
function _datosLinea(item, producto) {
  if (producto.es_pesable) {
    const pesoCrudo = parseFloat(item.peso);
    if (!(pesoCrudo > 0)) {
      throw Object.assign(
        new Error(`El producto "${producto.nombre}" se vende por peso: el peso (kg) es requerido y debe ser mayor a 0`),
        { status: 400 }
      );
    }
    const peso = Math.round(pesoCrudo * 1000) / 1000;
    return { cantidad: 1, precio: calcularPrecioPesable(peso, parseFloat(producto.precio)), peso };
  }
  return { cantidad: item.cantidad ?? 1, precio: parseFloat(producto.precio), peso: null };
}

const INCLUDE_PEDIDO_COMPLETO = [
  { model: Mesa, as: 'mesa', attributes: ['id', 'nombre', 'estado'] },
  { model: Cliente, as: 'cliente', attributes: ['id', 'nombre', 'numero_documento'] },
  {
    model: DetallePedido, as: 'detalles',
    include: [{ model: Producto, as: 'producto', attributes: ['id', 'nombre', 'precio'] }],
  },
];

async function listar({ estado, mesa_id, sucursal_id, acceso_todas } = {}) {
  const where = {};
  if (estado) {
    where.estado = estado.includes(',') ? { [Op.in]: estado.split(',') } : estado;
  }
  if (mesa_id) where.mesa_id = mesa_id;
  if (!acceso_todas) where.sucursal_id = sucursal_id;
  return Pedido.findAll({ where, include: INCLUDE_PEDIDO_COMPLETO, order: [['creado_en', 'DESC']] });
}

async function listarCocina({ sucursal_id, acceso_todas } = {}) {
  const where = { estado: { [Op.in]: ['pendiente', 'listo'] } };
  if (!acceso_todas) where.sucursal_id = sucursal_id;
  return Pedido.findAll({
    where,
    include: INCLUDE_PEDIDO_COMPLETO,
    order: [['creado_en', 'ASC']],
  });
}

function _verificarAlcance(pedido, alcance) {
  if (alcance && !alcance.acceso_todas && pedido.sucursal_id !== alcance.sucursal_id) {
    throw Object.assign(new Error('Pedido no encontrado'), { status: 404 });
  }
}

async function obtener(id, alcance) {
  const p = await Pedido.findByPk(id, { include: INCLUDE_PEDIDO_COMPLETO });
  if (!p) throw Object.assign(new Error('Pedido no encontrado'), { status: 404 });
  _verificarAlcance(p, alcance);
  return p;
}

async function reimprimir(id, alcance) {
  const pedido = await obtener(id, alcance);
  if (pedido.estado !== 'completado') {
    throw Object.assign(new Error('Solo se puede reimprimir un pedido completado'), { status: 409 });
  }
  // El ticket reimpreso debe ser idéntico al original: no se puede dejar que
  // _emitirImpresion recalcule numero_orden_diario "en vivo" (eso daría el
  // conteo de HOY, no el que tenía el pedido al momento de venderse). Se
  // recalcula el número que tenía ese pedido en su propio día de creación y
  // se pasa como override.
  const numero_orden_diario = await _numeroOrdenDiarioOriginal(pedido);
  return _emitirImpresion(
    pedido, pedido.metodo_pago, parseFloat(pedido.cambio || 0), pedido.sucursal_id, numero_orden_diario
  );
}

// Cuenta cuántos pedidos no cancelados se crearon el mismo día calendario
// (hora Bolivia) que `pedido`, hasta (e incluyendo) su propio `creado_en`.
// Es el mismo número que _emitirImpresion le asignó cuando se imprimió por
// primera vez, reutilizando el mismo rango de día y el mismo filtro de
// exclusión de cancelados.
//
// `creado_en` es un TIMESTAMP de MySQL con precisión de segundo (ver
// database/migrations/007_pedidos.sql), así que dos pedidos creados dentro
// del mismo segundo comparten el mismo valor. Para desempatar sin depender
// de sub-segundos se usa `id` (autoincremental, refleja el orden real de
// creación) como criterio secundario.
async function _numeroOrdenDiarioOriginal(pedido) {
  const { inicio } = _rangoDiaBolivia(pedido.creado_en);
  return Pedido.count({
    where: {
      estado: { [Op.ne]: 'cancelado' },
      creado_en: { [Op.gte]: inicio },
      [Op.or]: [
        { creado_en: { [Op.lt]: pedido.creado_en } },
        { creado_en: pedido.creado_en, id: { [Op.lte]: pedido.id } },
      ],
    },
  });
}

async function _siguienteNumeroLlevar() {
  const { inicio, fin } = _rangoDiaBolivia();
  const count = await Pedido.count({
    where: {
      tipo: 'llevar',
      creado_en: { [Op.between]: [inicio, fin] },
    },
  });
  return count + 1;
}

async function crear({ mesa_id, tipo = 'mesa', usuario_id, cliente_id, sesion_caja_id, notas, nombre_cliente, documento_cliente, tipo_documento }) {
  if (!sesion_caja_id) {
    throw Object.assign(new Error('No hay caja abierta. Abre la caja antes de crear una orden.'), { status: 409 });
  }
  const sesionActiva = await SesionCaja.findByPk(sesion_caja_id);
  if (!sesionActiva || sesionActiva.estado !== 'abierta') {
    throw Object.assign(new Error('La sesión de caja no está abierta.'), { status: 409 });
  }
  const sucursal_id = sesionActiva.sucursal_id;

  if (tipo === 'mesa') {
    const mesa = await Mesa.findByPk(mesa_id);
    if (!mesa) throw Object.assign(new Error('Mesa no encontrada'), { status: 404 });

    const pedido = await Pedido.create({
      mesa_id, tipo: 'mesa', usuario_id, cliente_id, sesion_caja_id, sucursal_id, notas,
      nombre_cliente: nombre_cliente || 'Público General',
      documento_cliente,
      tipo_documento: tipo_documento || 'Ticket',
    });
    await mesa.update({ estado: 'ocupada' });
    const resultado = await obtener(pedido.id);
    emitir('restaurante:actualizar', { tipo: 'pedido_nuevo' }, sucursal_id);
    return resultado;
  }

  // tipo === 'llevar'
  const numero_llevar = await _siguienteNumeroLlevar();
  const pedido = await Pedido.create({
    mesa_id: null, tipo: 'llevar', numero_llevar, usuario_id, cliente_id, sesion_caja_id, sucursal_id, notas,
    nombre_cliente: nombre_cliente || 'Cliente',
    documento_cliente,
    tipo_documento: tipo_documento || 'Ticket',
  });
  const resultado = await obtener(pedido.id);
  emitir('restaurante:actualizar', { tipo: 'pedido_nuevo' }, sucursal_id);
  return resultado;
}

/**
 * Completa una venta ya decidida (efectivo, o confirmación de un pago QR):
 * marca el pedido completado, descuenta stock, registra el ingreso en el
 * libro de caja y libera la mesa si corresponde. Debe correr dentro de una
 * transacción activa.
 */
async function _finalizarVenta({ pedido, detalles, metodo_pago, monto_recibido, descuento = 0, propina = 0, usuario_id }, transaction) {
  const monto_neto = parseFloat(pedido.total) - parseFloat(descuento) + parseFloat(propina);
  const cambio = metodo_pago === 'efectivo' ? parseFloat(monto_recibido) - monto_neto : 0;

  await pedido.update({
    estado: 'completado', metodo_pago, monto_recibido: monto_recibido || monto_neto, cambio, descuento, propina,
  }, { transaction });

  if (pedido.tipo !== 'llevar' && pedido.mesa_id) {
    const pendientes = await Pedido.count({ where: { mesa_id: pedido.mesa_id, estado: 'pendiente' }, transaction });
    if (pendientes === 0) {
      await Mesa.update({ estado: 'disponible' }, { where: { id: pedido.mesa_id }, transaction });
    }
  }

  await LibroCaja.create({
    sesion_caja_id: pedido.sesion_caja_id, usuario_id, tipo: 'ingreso', concepto: `Venta #${pedido.id}`, monto: monto_neto, metodo_pago, referencia_id: pedido.id,
  }, { transaction });

  await SesionCaja.increment('total_ventas', { by: monto_neto, where: { id: pedido.sesion_caja_id }, transaction });

  for (const detalle of detalles) {
    const producto = await Producto.findByPk(detalle.producto_id, { transaction });
    if (producto && producto.stock !== null) {
      await ajustarStockSucursal({
        producto_id: detalle.producto_id, sucursal_id: pedido.sucursal_id, tipo: 'venta', cantidad: detalle.cantidad,
        usuario_id, nota: `Venta #${pedido.id}`, transaction,
      });
    }
  }

  return monto_neto;
}

async function _emitirImpresion(pedido, metodo_pago, cambio, sucursal_id, numeroOrdenDiarioOverride) {
  const cfgRows = await Configuracion.findAll({ where: { clave: ['nombre_negocio', 'simbolo_moneda', 'direccion', 'telefono', 'flujo_cocina'] } });
  const cfg = cfgRows.reduce((o, r) => { o[r.clave] = r.valor; return o; }, {});

  // Los llamadores normales (crearCompleta, cobrar, _confirmarPagoQr) no
  // pasan override: se recalcula en vivo, como siempre. `reimprimir` sí pasa
  // un valor explícito (el número que tenía el pedido el día que se vendió)
  // para que el ticket reimpreso salga idéntico al original.
  let numero_orden_diario = numeroOrdenDiarioOverride;
  if (numero_orden_diario === undefined) {
    const { inicio: inicioDia, fin: finDia } = _rangoDiaBolivia();
    numero_orden_diario = await Pedido.count({
      where: { creado_en: { [Op.between]: [inicioDia, finDia] }, estado: { [Op.ne]: 'cancelado' } },
    });
  }

  const datosCaja = { pedido: pedido.toJSON(), metodo_pago, cambio, config: cfg, numero_orden_diario };
  emitir('print:caja', datosCaja, sucursal_id);

  let datosCocina = null;
  if (cfg.flujo_cocina === 'fisico') {
    datosCocina = { pedido: pedido.toJSON(), config: cfg, numero_orden_diario };
    emitir('print:cocina', datosCocina, sucursal_id);
  }

  // Se devuelve además del emit por socket para que el navegador que hizo la
  // venta pueda mandarlo directo al agente local (ver print-agent/agent.js),
  // sin depender de que el socket del agente esté conectado al servidor.
  return { caja: datosCaja, cocina: datosCocina };
}

/**
 * Genera un QR de cobro con CodePay para un pedido ya persistido (con su
 * total ya calculado) y deja el pedido en 'pendiente_pago' hasta que se
 * confirme (ver consultarEstadoPagoQr / procesarWebhookPagoQr).
 */
async function iniciarPagoQr(pedido, { descuento = 0, propina = 0 } = {}) {
  const estadoPrevio = pedido.estado;
  const monto_neto = parseFloat(pedido.total) - parseFloat(descuento) + parseFloat(propina);
  const intentosPrevios = await PagoQr.count({ where: { pedido_id: pedido.id } });
  const order_id = `pedido_${pedido.id}_${intentosPrevios + 1}`;
  const expires_at = new Date(Date.now() + 30 * 60 * 1000);

  const cfg = await Configuracion.findOne({ where: { clave: 'nombre_negocio' } });
  const description = ((cfg && cfg.valor) || 'Venta').replace(/[^a-zA-Z0-9]/g, '').slice(0, 20) || 'Venta';

  const respuesta = await codepayClient.generarQr({
    order_id, amount: monto_neto, description, expires_at: expires_at.toISOString(),
  });

  await sequelize.transaction(async (t) => {
    await PagoQr.create({
      pedido_id: pedido.id, sucursal_id: pedido.sucursal_id, order_id,
      tx_id: respuesta.tx_id, estado: 'pendiente', estado_previo: estadoPrevio,
      monto_neto, comision: respuesta.commission_amount, monto_total: respuesta.amount,
      qr_code: respuesta.qr_code, expires_at,
    }, { transaction: t });

    await pedido.update({ estado: 'pendiente_pago', metodo_pago: 'qr', descuento, propina }, { transaction: t });
  });

  return {
    qr_code: respuesta.qr_code, tx_id: respuesta.tx_id, expires_at,
    monto_neto, comision: respuesta.commission_amount, monto_total: respuesta.amount,
  };
}

async function _revertirPagoQr(pagoQrInicial, nuevoEstado) {
  await sequelize.transaction(async (t) => {
    const pagoQr = await PagoQr.findByPk(pagoQrInicial.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!pagoQr || pagoQr.estado !== 'pendiente') return; // ya resuelto por otra llamada concurrente
    await pagoQr.update({ estado: nuevoEstado }, { transaction: t });
    await Pedido.update({ estado: pagoQr.estado_previo }, { where: { id: pagoQr.pedido_id }, transaction: t });
  });
}

async function _confirmarPagoQr(pagoQrInicial) {
  const pedidoId = await sequelize.transaction(async (t) => {
    const pagoQr = await PagoQr.findByPk(pagoQrInicial.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!pagoQr || pagoQr.estado !== 'pendiente') return null; // ya resuelto por otra llamada concurrente

    const pedido = await Pedido.findByPk(pagoQr.pedido_id, { include: INCLUDE_PEDIDO_COMPLETO, transaction: t });
    const detalles = pedido.detalles.map((d) => ({ producto_id: d.producto_id, cantidad: d.cantidad }));

    await _finalizarVenta({
      pedido, detalles, metodo_pago: 'qr', monto_recibido: pagoQr.monto_neto,
      descuento: pedido.descuento, propina: pedido.propina, usuario_id: pedido.usuario_id,
    }, t);
    await pagoQr.update({ estado: 'completado' }, { transaction: t });
    return pedido.id;
  });

  if (!pedidoId) return null;

  const completado = await obtener(pedidoId);
  emitir('restaurante:actualizar', { tipo: 'pedido_cobrado' }, completado.sucursal_id);
  await _emitirImpresion(completado, 'qr', 0, completado.sucursal_id);
  return completado;
}

async function consultarEstadoPagoQr(pedido_id, alcance) {
  const pedido = await Pedido.findByPk(pedido_id);
  if (!pedido) throw Object.assign(new Error('Pedido no encontrado'), { status: 404 });
  _verificarAlcance(pedido, alcance);

  const pagoQr = await PagoQr.findOne({ where: { pedido_id }, order: [['id', 'DESC']] });
  if (!pagoQr) throw Object.assign(new Error('No hay un pago QR para este pedido'), { status: 404 });

  // El webhook de CodePay puede confirmar/revertir el pago entre un poll y
  // el siguiente — si ya se resolvió (por el webhook), se devuelve directo
  // en vez de volver a filtrar por estado 'pendiente' (que ya no matchea y
  // antes producía un 404 acá, dejando el modal de cobro esperando
  // indefinidamente aunque el pago ya estuviera confirmado).
  if (pagoQr.estado !== 'pendiente') {
    return { estado: pagoQr.estado, pedido: await obtener(pedido_id) };
  }

  if (new Date() > pagoQr.expires_at) {
    await _revertirPagoQr(pagoQr, 'expirado');
    return { estado: 'expirado', pedido: await obtener(pedido_id) };
  }

  const estadoCodepay = await codepayClient.consultarEstado(pagoQr.tx_id);

  if (estadoCodepay.status === 'completed') {
    await _confirmarPagoQr(pagoQr);
    return { estado: 'completado', pedido: await obtener(pedido_id) };
  }
  if (estadoCodepay.status === 'failed') {
    await _revertirPagoQr(pagoQr, 'fallido');
    return { estado: 'fallido', pedido: await obtener(pedido_id) };
  }
  return { estado: 'pendiente', pedido: await obtener(pedido_id) };
}

async function cancelarPagoQr(pedido_id, alcance) {
  const pedido = await Pedido.findByPk(pedido_id);
  if (!pedido) throw Object.assign(new Error('Pedido no encontrado'), { status: 404 });
  _verificarAlcance(pedido, alcance);

  const pagoQr = await PagoQr.findOne({ where: { pedido_id, estado: 'pendiente' }, order: [['id', 'DESC']] });
  if (!pagoQr) throw Object.assign(new Error('No hay un pago QR pendiente para este pedido'), { status: 404 });

  await _revertirPagoQr(pagoQr, 'cancelado');
  return obtener(pedido_id);
}

/** Usado por el endpoint de webhook (Task 4). Idempotente. */
async function procesarWebhookPagoQr({ event, order_id }) {
  const pagoQr = await PagoQr.findOne({ where: { order_id } });
  if (!pagoQr || pagoQr.estado !== 'pendiente') return;

  if (event === 'payment.completed') {
    await _confirmarPagoQr(pagoQr);
  } else if (event === 'payment.failed') {
    await _revertirPagoQr(pagoQr, 'fallido');
  }
}

async function crearCompleta({ tipo, mesa_id, nombre_cliente, documento_cliente, tipo_documento, notas, items, metodo_pago, monto_recibido, descuento = 0, propina = 0, sesion_caja_id, usuario_id }) {
  if (!sesion_caja_id) {
    throw Object.assign(new Error('No hay caja abierta. Abre la caja antes de crear una orden.'), { status: 409 });
  }
  const sesionActiva = await SesionCaja.findByPk(sesion_caja_id);
  if (!sesionActiva || sesionActiva.estado !== 'abierta') {
    throw Object.assign(new Error('La sesión de caja no está abierta.'), { status: 409 });
  }
  const sucursal_id = sesionActiva.sucursal_id;

  if (!items || items.length === 0) {
    throw Object.assign(new Error('El pedido no tiene productos'), { status: 409 });
  }

  const productos = [];
  for (const item of items) {
    const producto = await Producto.findByPk(item.producto_id);
    if (!producto) throw Object.assign(new Error('Producto no encontrado'), { status: 404 });
    if (!producto.activo || !producto.es_vendible) throw Object.assign(new Error('Producto no disponible'), { status: 409 });
    const linea = _datosLinea(item, producto);
    productos.push({ item, producto, linea });
  }

  let mesa = null;
  if (tipo === 'mesa') {
    if (!mesa_id) throw Object.assign(new Error('mesa_id es requerido'), { status: 400 });
    mesa = await Mesa.findByPk(mesa_id);
    if (!mesa) throw Object.assign(new Error('Mesa no encontrada'), { status: 404 });
    if (mesa.estado !== 'disponible') throw Object.assign(new Error('Mesa ya ocupada'), { status: 409 });
  } else if (tipo !== 'llevar') {
    throw Object.assign(new Error("tipo debe ser 'mesa' o 'llevar'"), { status: 400 });
  }

  const total = productos.reduce((sum, { linea }) => sum + linea.cantidad * linea.precio, 0);
  const monto_neto = total - parseFloat(descuento) + parseFloat(propina);

  if (metodo_pago === 'efectivo') {
    if (!monto_recibido || parseFloat(monto_recibido) < monto_neto) {
      throw Object.assign(new Error('Monto recibido insuficiente'), { status: 400 });
    }
  }

  const numero_llevar = tipo === 'llevar' ? await _siguienteNumeroLlevar() : null;
  const estadoInicial = metodo_pago === 'qr' ? 'pendiente' : 'completado';

  const pedidoId = await sequelize.transaction(async (t) => {
    const pedido = await Pedido.create({
      mesa_id: tipo === 'mesa' ? mesa_id : null,
      tipo, numero_llevar, usuario_id, sesion_caja_id, sucursal_id, notas,
      estado: estadoInicial, total, descuento, propina, metodo_pago: 'efectivo',
      nombre_cliente: nombre_cliente || (tipo === 'llevar' ? 'Cliente' : 'Público General'),
      documento_cliente,
      tipo_documento: tipo_documento || 'Ticket',
    }, { transaction: t });

    const detalles = [];
    for (const { item, linea } of productos) {
      await DetallePedido.create({
        pedido_id: pedido.id, producto_id: item.producto_id, cantidad: linea.cantidad, precio: linea.precio, peso: linea.peso, nota: item.nota,
      }, { transaction: t });
      detalles.push({ producto_id: item.producto_id, cantidad: linea.cantidad });
    }

    if (metodo_pago !== 'qr') {
      await _finalizarVenta({ pedido, detalles, metodo_pago, monto_recibido, descuento, propina, usuario_id }, t);
    }

    return pedido.id;
  });

  if (metodo_pago === 'qr') {
    const pedidoPendiente = await Pedido.findByPk(pedidoId);
    const pago_qr = await iniciarPagoQr(pedidoPendiente, { descuento, propina });
    emitir('restaurante:actualizar', { tipo: 'pedido_nuevo' }, sucursal_id);
    return { pedido: await obtener(pedidoId), pago_qr };
  }

  const creado = await obtener(pedidoId);
  emitir('restaurante:actualizar', { tipo: 'pedido_cobrado' }, sucursal_id);
  const datos_impresion = await _emitirImpresion(creado, metodo_pago, parseFloat(monto_recibido || monto_neto) - monto_neto, sucursal_id);
  return { ...creado.toJSON(), datos_impresion };
}

async function agregarItem(pedido_id, { producto_id, cantidad = 1, nota, peso }, alcance) {
  const pedido = await Pedido.findByPk(pedido_id);
  if (!pedido) throw Object.assign(new Error('Pedido no encontrado'), { status: 404 });
  _verificarAlcance(pedido, alcance);
  if (pedido.estado !== 'pendiente') throw Object.assign(new Error('El pedido no está pendiente'), { status: 409 });

  const producto = await Producto.findByPk(producto_id);
  if (!producto) throw Object.assign(new Error('Producto no encontrado'), { status: 404 });
  if (!producto.activo || !producto.es_vendible) throw Object.assign(new Error('Producto no disponible'), { status: 409 });

  const linea = _datosLinea({ cantidad, peso }, producto);

  const item = await DetallePedido.create({
    pedido_id,
    producto_id,
    cantidad: linea.cantidad,
    precio: linea.precio,
    peso: linea.peso,
    nota,
  });

  await _recalcularTotal(pedido_id);
  emitir('restaurante:actualizar', { tipo: 'pedido_items' });
  return item;
}

async function actualizarItem(pedido_id, item_id, { cantidad, nota, estado, peso }, alcance) {
  const pedido = await Pedido.findByPk(pedido_id);
  if (!pedido) throw Object.assign(new Error('Pedido no encontrado'), { status: 404 });
  _verificarAlcance(pedido, alcance);
  const item = await DetallePedido.findOne({ where: { id: item_id, pedido_id } });
  if (!item) throw Object.assign(new Error('Item no encontrado'), { status: 404 });

  if (item.peso !== null && peso !== undefined) {
    const producto = await Producto.findByPk(item.producto_id);
    const linea = _datosLinea({ peso }, producto);
    await item.update({ peso: linea.peso, precio: linea.precio, nota, estado });
  } else {
    await item.update({ cantidad, nota, estado });
  }

  await _recalcularTotal(pedido_id);
  emitir('restaurante:actualizar', { tipo: 'pedido_items' });
  return item;
}

async function eliminarItem(pedido_id, item_id, alcance) {
  const pedido = await Pedido.findByPk(pedido_id);
  if (!pedido) throw Object.assign(new Error('Pedido no encontrado'), { status: 404 });
  _verificarAlcance(pedido, alcance);
  if (pedido.estado !== 'pendiente') throw Object.assign(new Error('Pedido no modificable'), { status: 409 });
  const item = await DetallePedido.findOne({ where: { id: item_id, pedido_id } });
  if (!item) throw Object.assign(new Error('Item no encontrado'), { status: 404 });
  await item.destroy();
  await _recalcularTotal(pedido_id);
  emitir('restaurante:actualizar', { tipo: 'pedido_items' });
}

async function cobrar(pedido_id, usuario_id, { metodo_pago, monto_recibido, descuento = 0, propina = 0 }, alcance) {
  const pedido = await Pedido.findByPk(pedido_id, { include: INCLUDE_PEDIDO_COMPLETO });
  if (!pedido) throw Object.assign(new Error('Pedido no encontrado'), { status: 404 });
  _verificarAlcance(pedido, alcance);
  if (!['pendiente', 'listo'].includes(pedido.estado)) throw Object.assign(new Error('El pedido no puede cobrarse'), { status: 409 });
  if (!pedido.sesion_caja_id) throw Object.assign(new Error('No hay sesión de caja activa en este pedido'), { status: 409 });

  const sesion = await SesionCaja.findByPk(pedido.sesion_caja_id);
  if (!sesion || sesion.estado !== 'abierta') throw Object.assign(new Error('La sesión de caja está cerrada'), { status: 409 });

  const monto_neto = parseFloat(pedido.total) - parseFloat(descuento) + parseFloat(propina);

  if (metodo_pago === 'efectivo' && (!monto_recibido || parseFloat(monto_recibido) < monto_neto)) {
    throw Object.assign(new Error('Monto recibido insuficiente'), { status: 400 });
  }

  if (metodo_pago === 'qr') {
    const pago_qr = await iniciarPagoQr(pedido, { descuento, propina });
    return { pedido: await obtener(pedido_id), pago_qr };
  }

  const detalles = pedido.detalles.map((d) => ({ producto_id: d.producto_id, cantidad: d.cantidad }));
  await sequelize.transaction((t) => _finalizarVenta({ pedido, detalles, metodo_pago, monto_recibido, descuento, propina, usuario_id }, t));

  const cobrado = await obtener(pedido_id);
  emitir('restaurante:actualizar', { tipo: 'pedido_cobrado' }, pedido.sucursal_id);
  const datos_impresion = await _emitirImpresion(cobrado, metodo_pago, parseFloat(monto_recibido) - monto_neto, pedido.sucursal_id);
  return { ...cobrado.toJSON(), datos_impresion };
}

async function cancelar(pedido_id, usuario_id, alcance) {
  const pedido = await Pedido.findByPk(pedido_id);
  if (!pedido) throw Object.assign(new Error('Pedido no encontrado'), { status: 404 });
  _verificarAlcance(pedido, alcance);
  if (pedido.estado !== 'pendiente') throw Object.assign(new Error('Solo se pueden cancelar pedidos pendientes'), { status: 409 });

  await pedido.update({ estado: 'cancelado' });

  if (pedido.tipo !== 'llevar' && pedido.mesa_id) {
    const pendientes = await Pedido.count({ where: { mesa_id: pedido.mesa_id, estado: 'pendiente' } });
    if (pendientes === 0) {
      await Mesa.update({ estado: 'disponible' }, { where: { id: pedido.mesa_id } });
    }
  }

  const cancelado = await obtener(pedido_id);
  emitir('restaurante:actualizar', { tipo: 'pedido_cancelado' });
  return cancelado;
}

async function _recalcularTotal(pedido_id) {
  const [result] = await sequelize.query(
    'SELECT COALESCE(SUM(cantidad * precio), 0) as total FROM detalle_pedidos WHERE pedido_id = ?',
    { replacements: [pedido_id], type: sequelize.QueryTypes.SELECT }
  );
  await Pedido.update({ total: result.total }, { where: { id: pedido_id } });
}

async function marcarListo(pedido_id, alcance) {
  const pedido = await Pedido.findByPk(pedido_id);
  if (!pedido) throw Object.assign(new Error('Pedido no encontrado'), { status: 404 });
  _verificarAlcance(pedido, alcance);
  if (pedido.estado !== 'pendiente') throw Object.assign(new Error('Solo pedidos pendientes pueden marcarse como listos'), { status: 409 });
  await pedido.update({ estado: 'listo' });
  const listo = await obtener(pedido_id);
  emitir('restaurante:actualizar', { tipo: 'pedido_listo' });
  return listo;
}

module.exports = {
  listar, listarCocina, obtener, reimprimir, crear, crearCompleta, agregarItem, actualizarItem, eliminarItem,
  cobrar, cancelar, marcarListo,
  consultarEstadoPagoQr, cancelarPagoQr, procesarWebhookPagoQr,
};
