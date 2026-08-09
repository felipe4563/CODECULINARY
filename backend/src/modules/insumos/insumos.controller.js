const svc = require('./insumos.service');

function _alcance(req) {
  return { sucursal_id: req.usuario.sucursal_id, acceso_todas: req.usuario.acceso_todas, usuario_id: req.usuario.id };
}

async function listarInsumos(req, res, next) {
  try { res.json({ ok: true, datos: await svc.listarInsumos(_alcance(req)) }); }
  catch (err) { next(err); }
}

async function crearInsumo(req, res, next) {
  try { res.status(201).json({ ok: true, datos: await svc.crearInsumo(req.body) }); }
  catch (err) { next(err); }
}

async function actualizarInsumo(req, res, next) {
  try { res.json({ ok: true, datos: await svc.actualizarInsumo(req.params.id, req.body) }); }
  catch (err) { next(err); }
}

async function desactivarInsumo(req, res, next) {
  try { await svc.desactivarInsumo(req.params.id); res.json({ ok: true, datos: null }); }
  catch (err) { next(err); }
}

async function ajustarStock(req, res, next) {
  try {
    const { cantidad, nota } = req.body;
    if (cantidad === undefined || cantidad === null) {
      return res.status(400).json({ ok: false, mensaje: 'cantidad es requerida' });
    }
    const alcance = _alcance(req);
    const datos = await svc.ajustarStockInsumoSucursal({
      insumo_id: req.params.id, sucursal_id: alcance.sucursal_id, tipo: 'ajuste',
      cantidad, usuario_id: alcance.usuario_id, nota,
    });
    res.json({ ok: true, datos });
  } catch (err) { next(err); }
}

async function obtenerReceta(req, res, next) {
  try { res.json({ ok: true, datos: await svc.listarRecetaProducto(req.params.producto_id) }); }
  catch (err) { next(err); }
}

async function guardarReceta(req, res, next) {
  try { res.json({ ok: true, datos: await svc.guardarRecetaProducto(req.params.producto_id, req.body.lineas) }); }
  catch (err) { next(err); }
}

async function totalGastado(req, res, next) {
  try {
    const { desde, hasta } = req.query;
    res.json({ ok: true, datos: { total: await svc.totalGastadoInsumos({ desde, hasta }) } });
  } catch (err) { next(err); }
}

async function reporteCompras(req, res, next) {
  try {
    const { desde, hasta } = req.query;
    res.json({ ok: true, datos: await svc.reporteComprasInsumos({ desde, hasta }) });
  } catch (err) { next(err); }
}

module.exports = {
  listarInsumos, crearInsumo, actualizarInsumo, desactivarInsumo, ajustarStock,
  obtenerReceta, guardarReceta, totalGastado, reporteCompras,
};
