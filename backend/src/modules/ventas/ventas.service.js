const { Op } = require('sequelize');
const {
  Pedido, DetallePedido, Mesa, Producto, Cliente, SesionCaja, LibroCaja, Configuracion, PagoQr, Opcion, Combo, Promocion, Cupon, sequelize,
} = require('../../models');
const { emitir } = require('../../socket');
const { ajustarStockSucursal } = require('../inventario/stock.service');
const codepayClient = require('../../integrations/codepay/codepay.client');
const { calcularPrecioPesable, redondearAMedio } = require('../../utils/precio');
const { estaActivoHoy } = require('../../utils/disponibilidad');
const { resolver: _resolverCupon } = require('../cupones/cupones.service');

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

// Suma el precio_adicional de las opciones elegidas (ej. "sabor: fresa +2 Bs").
// Se recalcula siempre desde la BD y nunca se confía en un precio que mande
// el cliente, para que nadie pueda inflar/desinflar el total del pedido.
async function _extraPorOpciones(opcion_ids = []) {
  if (!opcion_ids || opcion_ids.length === 0) return 0;
  const opciones = await Opcion.findAll({ where: { id: opcion_ids } });
  return opciones.reduce((sum, o) => sum + parseFloat(o.precio_adicional || 0), 0);
}

// Si el producto tiene una promoción vigente hoy, devuelve el precio ya
// descontado; si no, su precio normal. Se recalcula siempre desde la BD, no
// desde lo que muestre el catálogo que ya tenga el cliente en pantalla.
async function _precioConPromocion(producto) {
  const base = parseFloat(producto.precio);
  // Si hay más de una promoción activa para el mismo producto, gana la más
  // reciente — mismo criterio que usa el frontend al armar su mapa de
  // promociones (la última que procesa pisa a las anteriores). Sin este
  // orden explícito, el resultado dependía del plan de ejecución de MySQL y
  // podía no coincidir con lo que el cliente vio en pantalla al cobrar.
  // Una promoción puede afectar a varios productos (belongsToMany) — se
  // filtra vía el `where` sobre la asociación, equivalente a un INNER JOIN.
  const promo = await Promocion.findOne({
    where: { activo: 1 },
    include: [{ model: Producto, as: 'productos', attributes: [], where: { id: producto.id }, through: { attributes: [] } }],
    order: [['id', 'DESC']],
  });
  if (!promo || !estaActivoHoy(promo)) return base;
  const descuento = promo.tipo === 'porcentaje' ? base * (parseFloat(promo.valor) / 100) : parseFloat(promo.valor);
  return redondearAMedio(Math.max(0, base - descuento));
}

// Lee la configuración del programa de fidelidad (puntos por Bs gastado y
// valor en Bs de cada punto al canjear). `transaction` es opcional: se pasa
// dentro de _finalizarVenta (fuente de verdad) y se omite en las
// validaciones tempranas antes de abrir la transacción.
async function _configFidelidad(transaction) {
  const rows = await Configuracion.findAll({
    where: { clave: ['fidelidad_activa', 'puntos_por_bs', 'valor_punto_bs', 'fidelidad_canje_efectivo', 'fidelidad_canje_qr'] },
    transaction,
  });
  const cfg = rows.reduce((o, r) => { o[r.clave] = r.valor; return o; }, {});
  return {
    activa: cfg.fidelidad_activa === 'true',
    puntosPorBs: parseFloat(cfg.puntos_por_bs || 0),
    valorPunto: parseFloat(cfg.valor_punto_bs || 0),
    // Default true por retrocompatibilidad (antes de esta config, el canje
    // en efectivo siempre estaba permitido). El de QR default false: recién
    // se puede sostener porque iniciarPagoQr reserva los puntos al generar
    // el QR (ver más abajo) — antes de eso, no había forma de hacerlo bien.
    canjeEfectivo: cfg.fidelidad_canje_efectivo !== 'false',
    canjeQr: cfg.fidelidad_canje_qr === 'true',
  };
}

// Valida y calcula el descuento en Bs de canjear `puntos_canjear` puntos del
// cliente. Se llama dos veces: sin transacción, como validación temprana
// (antes de abrir la transacción, para dar un error rápido), y de nuevo
// dentro de la transacción de _finalizarVenta con lock de fila, que es la
// que realmente descuenta los puntos — nunca se confía en el balance leído
// fuera de la transacción para el descuento real. `metodoPago` filtra por lo
// que el negocio permitió en Configuración (efectivo y QR se controlan por
// separado).
async function _resolverCanje(cliente_id, puntos_canjear, cfg, transaction, metodoPago = 'efectivo') {
  const permitido = metodoPago === 'qr' ? cfg.canjeQr : cfg.canjeEfectivo;
  if (!cfg.activa || !permitido || !cliente_id || !puntos_canjear) return { puntos: 0, descuento: 0, cliente: null };
  const cliente = await Cliente.findByPk(cliente_id, transaction ? { transaction, lock: transaction.LOCK.UPDATE } : {});
  if (!cliente || puntos_canjear > cliente.puntos) {
    throw Object.assign(new Error('El cliente no tiene suficientes puntos'), { status: 400 });
  }
  return { puntos: puntos_canjear, descuento: puntos_canjear * cfg.valorPunto, cliente };
}

// Traduce un ítem del pedido (cantidad o peso) a los valores que se guardan
// en detalle_pedidos, según si el producto se vende por peso o por unidad.
// `precioBase` ya viene con la promoción aplicada (ver _precioConPromocion) y
// `extra` es la suma de precio_adicional de las opciones elegidas (ej. sabor).
// `monto_recibido` en efectivo se autocompleta en el frontend a partir del
// total ya calculado ahí (el cajero no lo tipea), así que una diferencia de
// fracción de centavo entre ese cálculo y el recálculo del backend (p. ej.
// por redondeo de punto flotante en descuentos porcentuales) no debería
// bloquear la venta — solo importa la diferencia a nivel de centavo real.
function _montoInsuficiente(monto_recibido, monto_neto) {
  if (!monto_recibido) return true;
  return parseFloat(monto_recibido) < monto_neto - 0.005;
}

function _datosLinea(item, producto, precioBase, extra = 0) {
  if (producto.es_pesable) {
    const pesoCrudo = parseFloat(item.peso);
    if (!(pesoCrudo > 0)) {
      throw Object.assign(
        new Error(`El producto "${producto.nombre}" se vende por peso: el peso (kg) es requerido y debe ser mayor a 0`),
        { status: 400 }
      );
    }
    const peso = Math.round(pesoCrudo * 1000) / 1000;
    return { cantidad: 1, precio: calcularPrecioPesable(peso, precioBase) + extra, peso };
  }
  return { cantidad: item.cantidad ?? 1, precio: precioBase + extra, peso: null };
}

const INCLUDE_PEDIDO_COMPLETO = [
  { model: Mesa, as: 'mesa', attributes: ['id', 'nombre', 'estado'] },
  { model: Cliente, as: 'cliente', attributes: ['id', 'nombre', 'numero_documento', 'puntos'] },
  {
    model: DetallePedido, as: 'detalles',
    include: [
      { model: Producto, as: 'producto', attributes: ['id', 'nombre', 'precio'], required: false },
      {
        model: Combo, as: 'combo', attributes: ['id', 'nombre', 'descripcion'], required: false,
        include: [{ model: Producto, as: 'productos', attributes: ['id', 'nombre'], through: { attributes: ['cantidad'] } }],
      },
    ],
  },
  { model: Cupon, as: 'cupon', attributes: ['id', 'codigo', 'tipo', 'valor'], required: false },
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
async function _finalizarVenta({ pedido, detalles, metodo_pago, monto_recibido, descuento = 0, propina = 0, usuario_id, puntos_canjear = 0, cupon_codigo, canjeYaReservado = false }, transaction) {
  const cfgFidelidad = await _configFidelidad(transaction);

  let puntosCanjeados, descuentoPuntos, clienteBloqueado;
  let cupon, descuentoCupon;
  if (canjeYaReservado) {
    // Pago QR: los puntos y el cupón ya se reservaron al generar el QR (ver
    // iniciarPagoQr), porque el monto cobrado quedó fijo desde ese momento.
    // Acá solo se usa lo que ya quedó persistido en el pedido — no se vuelve
    // a tocar el saldo del cliente ni el contador de usos del cupón.
    puntosCanjeados = pedido.puntos_canjeados || 0;
    descuentoPuntos = puntosCanjeados * cfgFidelidad.valorPunto;
    clienteBloqueado = null;
    cupon = null;
    descuentoCupon = parseFloat(pedido.descuento_cupon || 0);
  } else {
    ({ puntos: puntosCanjeados, descuento: descuentoPuntos, cliente: clienteBloqueado } =
      await _resolverCanje(pedido.cliente_id, puntos_canjear, cfgFidelidad, transaction, metodo_pago));
    ({ cupon, descuento: descuentoCupon } =
      await _resolverCupon(cupon_codigo, parseFloat(pedido.total) - parseFloat(descuento), pedido.cliente_id, transaction, detalles));
  }

  const monto_neto = Math.max(0, parseFloat(pedido.total) - parseFloat(descuento) - descuentoPuntos - descuentoCupon + parseFloat(propina));
  const cambio = metodo_pago === 'efectivo' ? parseFloat(monto_recibido) - monto_neto : 0;
  const puntosGanados = (pedido.cliente_id && cfgFidelidad.activa) ? Math.floor(monto_neto * cfgFidelidad.puntosPorBs) : 0;

  const datosPedido = {
    estado: 'completado', metodo_pago, monto_recibido: monto_recibido || monto_neto, cambio, descuento, propina,
    puntos_ganados: puntosGanados, puntos_canjeados: puntosCanjeados, descuento_cupon: descuentoCupon,
  };
  if (!canjeYaReservado) datosPedido.cupon_id = cupon ? cupon.id : null;
  await pedido.update(datosPedido, { transaction });

  if (cupon) await cupon.update({ usos_actuales: cupon.usos_actuales + 1, usado_en: new Date() }, { transaction });

  // Si el canje ya se reservó (QR), el saldo solo se mueve para acreditar lo
  // ganado. Si no (efectivo), falta descontar el canje además de acreditar.
  const faltaDescontarCanje = !canjeYaReservado && puntosCanjeados > 0;
  if (pedido.cliente_id && (puntosGanados > 0 || faltaDescontarCanje)) {
    const cliente = clienteBloqueado ?? await Cliente.findByPk(pedido.cliente_id, { transaction, lock: transaction.LOCK.UPDATE });
    if (cliente) {
      const delta = puntosGanados - (faltaDescontarCanje ? puntosCanjeados : 0);
      await cliente.update({ puntos: cliente.puntos + delta }, { transaction });
    }
  }

  if (pedido.tipo !== 'llevar' && pedido.mesa_id) {
    // 'listo' también cuenta como pedido activo sin cobrar todavía — si acá
    // solo se mira 'pendiente', un pedido que ya pasó a 'listo' en cocina
    // pero no se cobró queda huérfano: la mesa se libera igual y el pedido
    // sigue apareciendo en pantalla como si nada.
    const activos = await Pedido.count({ where: { mesa_id: pedido.mesa_id, estado: ['pendiente', 'listo'] }, transaction });
    if (activos === 0) {
      await Mesa.update({ estado: 'disponible' }, { where: { id: pedido.mesa_id }, transaction });
    }
  }

  await LibroCaja.create({
    sesion_caja_id: pedido.sesion_caja_id, usuario_id, tipo: 'ingreso', concepto: `Venta #${pedido.id}`, monto: monto_neto, metodo_pago, referencia_id: pedido.id,
  }, { transaction });

  await SesionCaja.increment('total_ventas', { by: monto_neto, where: { id: pedido.sesion_caja_id }, transaction });

  for (const detalle of detalles) {
    if (detalle.combo_id) {
      const combo = await Combo.findByPk(detalle.combo_id, {
        include: [{ model: Producto, as: 'productos', attributes: ['id', 'stock'], through: { attributes: ['cantidad'] } }],
        transaction,
      });
      if (!combo) continue;
      for (const p of combo.productos) {
        if (p.stock === null) continue;
        await ajustarStockSucursal({
          producto_id: p.id, sucursal_id: pedido.sucursal_id, tipo: 'venta', cantidad: detalle.cantidad * p.ComboProducto.cantidad,
          usuario_id, nota: `Venta #${pedido.id} (combo ${combo.nombre})`, transaction,
        });
      }
      continue;
    }
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

  // El ticket de caja va solo a la sala de la caja que hizo la venta (no a
  // toda la sucursal): si hay dos cajas en la misma sucursal, cada una tiene
  // su propio agente/impresora y no deben imprimirse tickets cruzados.
  let caja_id = null;
  if (pedido.sesion_caja_id) {
    const sesion = await SesionCaja.findByPk(pedido.sesion_caja_id, { attributes: ['caja_id'] });
    caja_id = sesion ? sesion.caja_id : null;
  }

  const datosCaja = { pedido: pedido.toJSON(), metodo_pago, cambio, config: cfg, numero_orden_diario };
  emitir('print:caja', datosCaja, sucursal_id, caja_id);

  let datosCocina = null;
  if (cfg.flujo_cocina === 'fisico') {
    // La cocina, en cambio, suele ser una sola impresora compartida por toda
    // la sucursal, sin importar qué caja vendió — se sigue emitiendo a nivel
    // de sucursal.
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
async function iniciarPagoQr(pedido, { descuento = 0, propina = 0, puntos_canjear = 0, cupon_codigo, items } = {}) {
  const cfgFidelidad = await _configFidelidad();

  // El monto que se le cobra al cliente por CodePay queda fijo desde que se
  // genera el QR, así que el canje de puntos (si el negocio lo permite para
  // QR) se reserva ANTES de pedir el QR: se descuentan del cliente de una
  // y se guardan en el pedido. Si algo falla más abajo, se revierten. Si el
  // pago termina fallando/expirando, _revertirPagoQr los devuelve.
  let puntosCanjeados = 0;
  let descuentoPuntos = 0;
  if (cfgFidelidad.canjeQr && pedido.cliente_id && puntos_canjear) {
    await sequelize.transaction(async (t) => {
      const { puntos, descuento: desc, cliente } = await _resolverCanje(pedido.cliente_id, puntos_canjear, cfgFidelidad, t, 'qr');
      if (cliente && puntos > 0) {
        await cliente.update({ puntos: cliente.puntos - puntos }, { transaction: t });
        await pedido.update({ puntos_canjeados: puntos }, { transaction: t });
      }
      puntosCanjeados = puntos;
      descuentoPuntos = desc;
    });
  }

  // Mismo motivo que los puntos: el cupón se resuelve y se marca como usado
  // (incrementa usos_actuales) ACÁ, antes de pedir el QR — si no, dos QR
  // generados en simultáneo para el mismo cupón de un solo uso podrían
  // pasar la validación los dos. Si algo fallara después (el QR o el cobro
  // en sí), se revierte con _devolverCuponReservado / _revertirPagoQr.
  let cuponReservado = null;
  let descuentoCupon = 0;
  if (cupon_codigo) {
    try {
      await sequelize.transaction(async (t) => {
        const { cupon, descuento: desc } = await _resolverCupon(cupon_codigo, parseFloat(pedido.total) - parseFloat(descuento), pedido.cliente_id, t, items);
        await cupon.update({ usos_actuales: cupon.usos_actuales + 1, usado_en: new Date() }, { transaction: t });
        await pedido.update({ cupon_id: cupon.id, descuento_cupon: desc }, { transaction: t });
        cuponReservado = cupon;
        descuentoCupon = desc;
      });
    } catch (err) {
      if (puntosCanjeados > 0) await _devolverPuntosCanjeados(pedido, puntosCanjeados);
      throw err;
    }
  }

  try {
    const estadoPrevio = pedido.estado;
    const monto_neto = Math.max(0, parseFloat(pedido.total) - parseFloat(descuento) - descuentoPuntos - descuentoCupon + parseFloat(propina));
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
  } catch (err) {
    if (puntosCanjeados > 0) await _devolverPuntosCanjeados(pedido, puntosCanjeados);
    if (cuponReservado) await _devolverCuponReservado(pedido, cuponReservado.id);
    throw err;
  }
}

// Devuelve al cliente los puntos reservados para un intento de pago QR que
// no llegó a generarse (o que falló/expiró/fue rechazado) — usado por
// iniciarPagoQr (si el propio generarQr falla) y por _revertirPagoQr.
async function _devolverPuntosCanjeados(pedido, puntos) {
  await sequelize.transaction(async (t) => {
    const cliente = await Cliente.findByPk(pedido.cliente_id, { transaction: t, lock: t.LOCK.UPDATE });
    if (cliente) await cliente.update({ puntos: cliente.puntos + puntos }, { transaction: t });
    await Pedido.update({ puntos_canjeados: 0 }, { where: { id: pedido.id }, transaction: t });
  });
}

// Devuelve el uso reservado de un cupón para un intento de pago QR que no
// llegó a generarse (o que falló/expiró/fue rechazado) — mismo rol que
// _devolverPuntosCanjeados pero para el contador usos_actuales del cupón.
async function _devolverCuponReservado(pedido, cupon_id) {
  await sequelize.transaction(async (t) => {
    const cupon = await Cupon.findByPk(cupon_id, { transaction: t, lock: t.LOCK.UPDATE });
    if (cupon) await cupon.update({ usos_actuales: Math.max(0, cupon.usos_actuales - 1) }, { transaction: t });
    await Pedido.update({ cupon_id: null, descuento_cupon: 0 }, { where: { id: pedido.id }, transaction: t });
  });
}

async function _revertirPagoQr(pagoQrInicial, nuevoEstado) {
  await sequelize.transaction(async (t) => {
    const pagoQr = await PagoQr.findByPk(pagoQrInicial.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!pagoQr || pagoQr.estado !== 'pendiente') return; // ya resuelto por otra llamada concurrente
    await pagoQr.update({ estado: nuevoEstado }, { transaction: t });

    const pedido = await Pedido.findByPk(pagoQr.pedido_id, { transaction: t, lock: t.LOCK.UPDATE });
    if (pedido && pedido.puntos_canjeados > 0) {
      const cliente = await Cliente.findByPk(pedido.cliente_id, { transaction: t, lock: t.LOCK.UPDATE });
      if (cliente) await cliente.update({ puntos: cliente.puntos + pedido.puntos_canjeados }, { transaction: t });
    }
    if (pedido && pedido.cupon_id) {
      const cupon = await Cupon.findByPk(pedido.cupon_id, { transaction: t, lock: t.LOCK.UPDATE });
      if (cupon) await cupon.update({ usos_actuales: Math.max(0, cupon.usos_actuales - 1) }, { transaction: t });
    }
    await Pedido.update(
      { estado: pagoQr.estado_previo, puntos_canjeados: 0, cupon_id: null, descuento_cupon: 0 },
      { where: { id: pagoQr.pedido_id }, transaction: t }
    );
  });
}

async function _confirmarPagoQr(pagoQrInicial) {
  const pedidoId = await sequelize.transaction(async (t) => {
    const pagoQr = await PagoQr.findByPk(pagoQrInicial.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!pagoQr || pagoQr.estado !== 'pendiente') return null; // ya resuelto por otra llamada concurrente

    const pedido = await Pedido.findByPk(pagoQr.pedido_id, { include: INCLUDE_PEDIDO_COMPLETO, transaction: t });
    const detalles = pedido.detalles.map((d) => ({ producto_id: d.producto_id, combo_id: d.combo_id, cantidad: d.cantidad }));

    await _finalizarVenta({
      pedido, detalles, metodo_pago: 'qr', monto_recibido: pagoQr.monto_neto,
      descuento: pedido.descuento, propina: pedido.propina, usuario_id: pedido.usuario_id,
      canjeYaReservado: true,
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

async function crearCompleta({ tipo, mesa_id, nombre_cliente, documento_cliente, tipo_documento, notas, items, metodo_pago, monto_recibido, descuento = 0, propina = 0, sesion_caja_id, usuario_id, cliente_id, puntos_canjear = 0, cupon_codigo }) {
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
    if (item.combo_id) {
      const combo = await Combo.findByPk(item.combo_id);
      if (!combo) throw Object.assign(new Error('Combo no encontrado'), { status: 404 });
      if (!combo.activo || !estaActivoHoy(combo)) {
        throw Object.assign(new Error(`El combo "${combo.nombre}" no está disponible`), { status: 409 });
      }
      const linea = { cantidad: item.cantidad ?? 1, precio: parseFloat(combo.precio), peso: null };
      productos.push({ item, combo, linea });
      continue;
    }
    const producto = await Producto.findByPk(item.producto_id);
    if (!producto) throw Object.assign(new Error('Producto no encontrado'), { status: 404 });
    if (!producto.activo || !producto.es_vendible) throw Object.assign(new Error('Producto no disponible'), { status: 409 });
    const extra = await _extraPorOpciones(item.opcion_ids);
    const precioBase = await _precioConPromocion(producto);
    const linea = _datosLinea(item, producto, precioBase, extra);
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

  const cfgFidelidad = await _configFidelidad();
  const { descuento: descuentoPuntos } = await _resolverCanje(cliente_id, puntos_canjear, cfgFidelidad, null, metodo_pago);

  const total = productos.reduce((sum, { linea }) => sum + linea.cantidad * linea.precio, 0);
  const itemsCupon = productos.map(({ item, combo, linea }) => ({ producto_id: combo ? null : item.producto_id, cantidad: linea.cantidad, precio: linea.precio }));
  const { descuento: descuentoCupon } = await _resolverCupon(cupon_codigo, total - parseFloat(descuento), cliente_id, undefined, itemsCupon);
  const monto_neto = Math.max(0, total - parseFloat(descuento) - descuentoPuntos - descuentoCupon + parseFloat(propina));

  if (metodo_pago === 'efectivo' && _montoInsuficiente(monto_recibido, monto_neto)) {
    throw Object.assign(new Error('Monto recibido insuficiente'), { status: 400 });
  }

  const numero_llevar = tipo === 'llevar' ? await _siguienteNumeroLlevar() : null;
  const estadoInicial = metodo_pago === 'qr' ? 'pendiente' : 'completado';

  const pedidoId = await sequelize.transaction(async (t) => {
    const pedido = await Pedido.create({
      mesa_id: tipo === 'mesa' ? mesa_id : null,
      tipo, numero_llevar, usuario_id, cliente_id: cliente_id || null, sesion_caja_id, sucursal_id, notas,
      estado: estadoInicial, total, descuento, propina, metodo_pago: 'efectivo',
      nombre_cliente: nombre_cliente || (tipo === 'llevar' ? 'Cliente' : 'Público General'),
      documento_cliente,
      tipo_documento: tipo_documento || 'Ticket',
    }, { transaction: t });

    const detalles = [];
    for (const { item, combo, linea } of productos) {
      await DetallePedido.create({
        pedido_id: pedido.id,
        producto_id: combo ? null : item.producto_id,
        combo_id: combo ? item.combo_id : null,
        cantidad: linea.cantidad, precio: linea.precio, peso: linea.peso, nota: item.nota,
      }, { transaction: t });
      detalles.push({ producto_id: combo ? null : item.producto_id, combo_id: combo ? item.combo_id : null, cantidad: linea.cantidad, precio: linea.precio });
    }

    if (metodo_pago !== 'qr') {
      await _finalizarVenta({ pedido, detalles, metodo_pago, monto_recibido, descuento, propina, usuario_id, puntos_canjear, cupon_codigo }, t);
    }

    return pedido.id;
  });

  if (metodo_pago === 'qr') {
    const pedidoPendiente = await Pedido.findByPk(pedidoId);
    const pago_qr = await iniciarPagoQr(pedidoPendiente, { descuento, propina, puntos_canjear, cupon_codigo, items: itemsCupon });
    emitir('restaurante:actualizar', { tipo: 'pedido_nuevo' }, sucursal_id);
    return { pedido: await obtener(pedidoId), pago_qr };
  }

  const creado = await obtener(pedidoId);
  emitir('restaurante:actualizar', { tipo: 'pedido_cobrado' }, sucursal_id);
  const datos_impresion = await _emitirImpresion(creado, metodo_pago, parseFloat(monto_recibido || monto_neto) - monto_neto, sucursal_id);
  return { ...creado.toJSON(), datos_impresion };
}

async function agregarItem(pedido_id, { producto_id, combo_id, cantidad = 1, nota, peso, opcion_ids }, alcance) {
  const pedido = await Pedido.findByPk(pedido_id);
  if (!pedido) throw Object.assign(new Error('Pedido no encontrado'), { status: 404 });
  _verificarAlcance(pedido, alcance);
  if (pedido.estado !== 'pendiente') throw Object.assign(new Error('El pedido no está pendiente'), { status: 409 });

  if (combo_id) {
    const combo = await Combo.findByPk(combo_id);
    if (!combo) throw Object.assign(new Error('Combo no encontrado'), { status: 404 });
    if (!combo.activo || !estaActivoHoy(combo)) {
      throw Object.assign(new Error(`El combo "${combo.nombre}" no está disponible`), { status: 409 });
    }
    const item = await DetallePedido.create({
      pedido_id, combo_id, producto_id: null, cantidad, precio: parseFloat(combo.precio), peso: null, nota,
    });
    await _recalcularTotal(pedido_id);
    emitir('restaurante:actualizar', { tipo: 'pedido_items' });
    return item;
  }

  const producto = await Producto.findByPk(producto_id);
  if (!producto) throw Object.assign(new Error('Producto no encontrado'), { status: 404 });
  if (!producto.activo || !producto.es_vendible) throw Object.assign(new Error('Producto no disponible'), { status: 409 });

  const extra = await _extraPorOpciones(opcion_ids);
  const precioBase = await _precioConPromocion(producto);
  const linea = _datosLinea({ cantidad, peso }, producto, precioBase, extra);

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
    const precioBase = await _precioConPromocion(producto);
    const linea = _datosLinea({ peso }, producto, precioBase);
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

async function cobrar(pedido_id, usuario_id, { metodo_pago, monto_recibido, descuento = 0, propina = 0, cliente_id, puntos_canjear = 0, cupon_codigo }, alcance) {
  const pedido = await Pedido.findByPk(pedido_id, { include: INCLUDE_PEDIDO_COMPLETO });
  if (!pedido) throw Object.assign(new Error('Pedido no encontrado'), { status: 404 });
  _verificarAlcance(pedido, alcance);
  if (!['pendiente', 'listo'].includes(pedido.estado)) throw Object.assign(new Error('El pedido no puede cobrarse'), { status: 409 });
  if (!pedido.sesion_caja_id) throw Object.assign(new Error('No hay sesión de caja activa en este pedido'), { status: 409 });

  const sesion = await SesionCaja.findByPk(pedido.sesion_caja_id);
  if (!sesion || sesion.estado !== 'abierta') throw Object.assign(new Error('La sesión de caja está cerrada'), { status: 409 });

  // El cliente se puede asignar recién al cobrar (el pedido pudo crearse sin
  // uno). Una vez asignado no se pisa, para no perder puntos ya calculados.
  if (cliente_id && !pedido.cliente_id) {
    await pedido.update({ cliente_id });
  }

  const cfgFidelidad = await _configFidelidad();
  const { descuento: descuentoPuntos } = await _resolverCanje(pedido.cliente_id, puntos_canjear, cfgFidelidad, null, metodo_pago);
  const itemsCupon = pedido.detalles.map((d) => ({ producto_id: d.producto_id, cantidad: d.cantidad, precio: parseFloat(d.precio) }));
  const { descuento: descuentoCupon } = await _resolverCupon(cupon_codigo, parseFloat(pedido.total) - parseFloat(descuento), pedido.cliente_id, undefined, itemsCupon);
  const monto_neto = Math.max(0, parseFloat(pedido.total) - parseFloat(descuento) - descuentoPuntos - descuentoCupon + parseFloat(propina));

  if (metodo_pago === 'efectivo' && _montoInsuficiente(monto_recibido, monto_neto)) {
    throw Object.assign(new Error('Monto recibido insuficiente'), { status: 400 });
  }

  if (metodo_pago === 'qr') {
    // El cupón (igual que los puntos) se reserva dentro de iniciarPagoQr,
    // porque el monto cobrado por QR queda fijo desde que se genera.
    const pago_qr = await iniciarPagoQr(pedido, { descuento, propina, puntos_canjear, cupon_codigo, items: itemsCupon });
    return { pedido: await obtener(pedido_id), pago_qr };
  }

  const detalles = pedido.detalles.map((d) => ({ producto_id: d.producto_id, combo_id: d.combo_id, cantidad: d.cantidad, precio: parseFloat(d.precio) }));
  await sequelize.transaction((t) => _finalizarVenta({ pedido, detalles, metodo_pago, monto_recibido, descuento, propina, usuario_id, puntos_canjear, cupon_codigo }, t));

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
    const activos = await Pedido.count({ where: { mesa_id: pedido.mesa_id, estado: ['pendiente', 'listo'] } });
    if (activos === 0) {
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
