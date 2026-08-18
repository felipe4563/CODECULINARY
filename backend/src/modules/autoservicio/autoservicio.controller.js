const svc = require('./autoservicio.service');

const MAX_ITEMS = 50;

function _esIdPositivo(v) {
  return Number.isInteger(v) && v > 0;
}

// Validación de los ítems en el borde público: este endpoint es anónimo (sólo
// lo protege el código QR de la mesa), así que el payload no puede confiarse.
// Sin esto, un `cantidad: -30` pasaba derecho a ventasService.crearCompleta:
// bajaba el total a casi cero (pago QR ridículo) y, al confirmarse, entraba
// como cantidad negativa en ajustarStockSucursal/_descontarInsumosPorVenta,
// INFLANDO el stock en vez de descontarlo.
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

// Mismo borde anónimo que _validarItems: puntos_canjear llega hasta
// ventasService._resolverCanje y de ahí a un descuento en Bs real. Un valor
// fraccionario (ej. 0.4) produciría descuento pero Cliente.puntos es
// INTEGER, así que el descuento posterior (puntos - 0.4) se redondea de
// vuelta al balance original al guardarse — un bug de descuento gratis
// repetible. No se valida el límite superior (contra el balance real del
// cliente) acá: eso ya lo hace _resolverCanje dentro de la transacción,
// con lock de fila.
function _validarPuntosCanjear(puntos_canjear) {
  if (puntos_canjear === undefined || puntos_canjear === null) return null;
  if (!Number.isInteger(puntos_canjear) || puntos_canjear < 0) return 'puntos_canjear debe ser un entero no negativo';
  return null;
}

async function obtenerMenu(req, res, next) {
  try { res.json({ ok: true, datos: await svc.obtenerMenu(req.params.codigo_qr) }); }
  catch (err) { next(err); }
}

async function validarCupon(req, res, next) {
  try {
    const { codigo, items } = req.body;
    if (!codigo || typeof codigo !== 'string') {
      return res.status(400).json({ ok: false, mensaje: 'codigo es requerido' });
    }
    res.json({ ok: true, datos: await svc.validarCupon(req.params.codigo_qr, { codigo, items }) });
  } catch (err) { next(err); }
}

async function crearPedido(req, res, next) {
  try {
    const { items, cupon_codigo, numero_documento, puntos_canjear } = req.body;
    const error = _validarItems(items) || _validarPuntosCanjear(puntos_canjear);
    if (error) return res.status(400).json({ ok: false, mensaje: error });
    res.status(201).json({
      ok: true,
      datos: await svc.crearPedido(req.params.codigo_qr, {
        items, cupon_codigo, numero_documento, puntos_canjear, clienteIdAutenticado: req.clienteId,
      }),
    });
  } catch (err) { next(err); }
}

async function estadoPedido(req, res, next) {
  try { res.json({ ok: true, datos: await svc.consultarEstadoPedido(req.params.codigo_qr, req.params.pedido_id) }); }
  catch (err) { next(err); }
}

module.exports = { obtenerMenu, validarCupon, crearPedido, estadoPedido };
