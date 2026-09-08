const svc = require('./integraciones.service');

const MAX_ITEMS = 50;

function _esIdPositivo(v) {
  return Number.isInteger(v) && v > 0;
}

function _validarItems(items) {
  if (!Array.isArray(items) || items.length === 0) return 'items es requerido';
  if (items.length > MAX_ITEMS) return `No se pueden pedir más de ${MAX_ITEMS} ítems a la vez`;

  for (const item of items) {
    if (!item || typeof item !== 'object') return 'Ítem inválido';
    const tieneProducto = item.producto_id !== undefined && item.producto_id !== null;
    const tieneCombo = item.combo_id !== undefined && item.combo_id !== null;
    if (tieneProducto === tieneCombo) return 'Cada ítem debe tener producto_id o combo_id (uno solo)';
    if (tieneProducto && !_esIdPositivo(item.producto_id)) return 'producto_id inválido';
    if (tieneCombo && !_esIdPositivo(item.combo_id)) return 'combo_id inválido';
    if (!Number.isInteger(item.cantidad) || item.cantidad <= 0) return 'Cantidad inválida';
  }
  return null;
}

async function obtenerMenu(req, res, next) {
  try { res.json({ ok: true, datos: await svc.obtenerMenu(req.sucursal_id) }); }
  catch (err) { next(err); }
}

async function validarCupon(req, res, next) {
  try {
    const { codigo, items } = req.body;
    if (!codigo || typeof codigo !== 'string') {
      return res.status(400).json({ ok: false, mensaje: 'codigo es requerido' });
    }
    res.json({ ok: true, datos: await svc.validarCupon({ codigo, items }) });
  } catch (err) { next(err); }
}

async function crearPedido(req, res, next) {
  try {
    const { items, tipo, direccion_entrega, telefono_cliente, nombre_cliente, pago, cupon_codigo } = req.body;
    const errorItems = _validarItems(items);
    if (errorItems) return res.status(400).json({ ok: false, mensaje: errorItems });
    if (!['llevar', 'delivery'].includes(tipo)) {
      return res.status(400).json({ ok: false, mensaje: "tipo debe ser 'llevar' o 'delivery'" });
    }
    if (tipo === 'delivery' && !direccion_entrega) {
      return res.status(400).json({ ok: false, mensaje: 'direccion_entrega es requerida para delivery' });
    }
    if (!['prepago', 'contra_entrega'].includes(pago)) {
      return res.status(400).json({ ok: false, mensaje: "pago debe ser 'prepago' o 'contra_entrega'" });
    }
    const datos = await svc.crearPedido(req.sucursal_id, {
      items, tipo, direccion_entrega, telefono_cliente, nombre_cliente, pago, cupon_codigo,
      origen_app: req.integracionNombreApp,
    });
    res.status(201).json({ ok: true, datos });
  } catch (err) { next(err); }
}

async function estadoPedido(req, res, next) {
  try { res.json({ ok: true, datos: await svc.consultarEstadoPedido(req.sucursal_id, req.params.pedido_id) }); }
  catch (err) { next(err); }
}

module.exports = { obtenerMenu, validarCupon, crearPedido, estadoPedido };
