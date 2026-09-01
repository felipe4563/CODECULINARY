const { Op, fn, col, literal } = require('sequelize');
const {
  Pedido, DetallePedido, Mesa, Cliente, Producto, Combo, Usuario,
  RegistroInventario, Compra, Proveedor, LibroCaja, SesionCaja, Sucursal,
  Opcion, GrupoOpciones,
} = require('../../models');

// Offset fijo de Bolivia: un datetime sin offset se parsea en la hora local
// del proceso de Node, que puede no coincidir con la del negocio (-04:00).
function filtroFecha(desde, hasta) {
  if (!desde && !hasta) return {};
  const range = {};
  if (desde) range[Op.gte] = new Date(`${desde}T00:00:00-04:00`);
  if (hasta) range[Op.lte] = new Date(`${hasta}T23:59:59-04:00`);
  return { creado_en: range };
}

const INCLUDE_SUCURSAL = { model: Sucursal, as: 'sucursal', attributes: ['id', 'nombre'] };

const LIMITE_DEFAULT = 20;
const LIMITE_MAX = 100;

function _paginaLimite(filtros = {}) {
  const pagina = Math.max(parseInt(filtros.pagina, 10) || 1, 1);
  const limiteReq = filtros.limite === undefined ? LIMITE_DEFAULT : parseInt(filtros.limite, 10);
  const limite = limiteReq === 0 ? 0 : Math.min(Math.max(limiteReq || LIMITE_DEFAULT, 1), LIMITE_MAX);
  return { pagina, limite };
}

function _whereVentas(filtros, alcance) {
  const { desde, hasta, usuario_id, metodo_pago, tipo, origen } = filtros;
  const where = { estado: 'completado', ...filtroFecha(desde, hasta) };
  if (!alcance.acceso_todas) where.sucursal_id = alcance.sucursal_id;
  else if (filtros.sucursal_id) where.sucursal_id = filtros.sucursal_id;
  if (usuario_id) where.usuario_id = usuario_id;
  if (metodo_pago) where.metodo_pago = metodo_pago;
  if (tipo) where.tipo = tipo;
  if (origen) where.origen = origen;
  return where;
}

async function ventas(filtros = {}, alcance) {
  const where = _whereVentas(filtros, alcance);
  const { pagina, limite } = _paginaLimite(filtros);

  const { rows, count } = await Pedido.findAndCountAll({
    where,
    include: [
      { model: Mesa,    as: 'mesa',    attributes: ['id', 'nombre'] },
      { model: Cliente, as: 'cliente', attributes: ['id', 'nombre'] },
      { model: Usuario, as: 'usuario', attributes: ['id', 'nombre'] },
      INCLUDE_SUCURSAL,
      {
        model: DetallePedido, as: 'detalles',
        include: [
          { model: Producto, as: 'producto', attributes: ['id', 'nombre'] },
          { model: Combo, as: 'combo', attributes: ['id', 'nombre'] },
          {
            model: Opcion, as: 'opciones', attributes: ['id', 'nombre'], through: { attributes: [] },
            include: [{ model: GrupoOpciones, as: 'grupo', attributes: ['id', 'nombre'] }],
          },
        ],
      },
    ],
    order: [['creado_en', 'DESC']],
    distinct: true,
    ...(limite ? { limit: limite, offset: (pagina - 1) * limite } : {}),
  });

  return { filas: rows, pagina, limite, total: count, total_paginas: limite ? Math.ceil(count / limite) : 1 };
}

async function ventasResumen(filtros = {}, alcance) {
  const where = _whereVentas(filtros, alcance);

  const [totalVentas, ventasEfectivo, ventasQR, cantidad, cajerosRaw] = await Promise.all([
    Pedido.sum('total', { where }),
    Pedido.sum('total', { where: { ...where, metodo_pago: 'efectivo' } }),
    Pedido.sum('total', { where: { ...where, metodo_pago: 'qr' } }),
    Pedido.count({ where }),
    Pedido.findAll({
      where,
      include: [{ model: Usuario, as: 'usuario', attributes: ['id', 'nombre'] }],
      attributes: [],
      group: ['usuario.id', 'usuario.nombre'],
      raw: true,
    }),
  ]);

  const cajeros = cajerosRaw
    .map((f) => ({ id: f['usuario.id'], nombre: f['usuario.nombre'] }))
    .filter((c) => c.id != null);

  const filtrosResp = { cajeros };
  if (alcance.acceso_todas) {
    const sucursalesRaw = await Pedido.findAll({
      where, include: [INCLUDE_SUCURSAL], attributes: [],
      group: ['sucursal.id', 'sucursal.nombre'], raw: true,
    });
    filtrosResp.sucursales = sucursalesRaw
      .map((f) => ({ id: f['sucursal.id'], nombre: f['sucursal.nombre'] }))
      .filter((s) => s.id != null);
  }

  return {
    total_ventas: parseFloat(totalVentas || 0),
    ventas_efectivo: parseFloat(ventasEfectivo || 0),
    ventas_qr: parseFloat(ventasQR || 0),
    cantidad: cantidad || 0,
    filtros: filtrosResp,
  };
}

async function ventasProductos(filtros = {}, alcance) {
  const where = _whereVentas(filtros, alcance);

  const filas = await DetallePedido.findAll({
    include: [
      { model: Pedido, attributes: [], where, required: true },
      { model: Producto, as: 'producto', attributes: ['nombre'], required: false },
      { model: Combo, as: 'combo', attributes: ['nombre'], required: false },
    ],
    attributes: [
      'producto_id',
      'combo_id',
      [fn('SUM', col('DetallePedido.cantidad')), 'cantidad'],
      [fn('SUM', literal('`DetallePedido`.`cantidad` * `DetallePedido`.`precio`')), 'monto'],
    ],
    group: ['DetallePedido.producto_id', 'DetallePedido.combo_id', 'producto.nombre', 'combo.nombre'],
    order: [[literal('cantidad'), 'DESC']],
    raw: true,
  });

  return filas.map((f) => ({
    id: f.producto_id ?? f.combo_id,
    tipo: f.producto_id ? 'producto' : 'combo',
    nombre: f['producto.nombre'] ?? f['combo.nombre'] ?? '(eliminado)',
    cantidad: parseFloat(f.cantidad || 0),
    monto: parseFloat(f.monto || 0),
  }));
}

async function inventario(filtros = {}, alcance = {}) {
  const { desde, hasta } = filtros;
  const where = filtroFecha(desde, hasta);
  if (!alcance.acceso_todas) where.sucursal_id = alcance.sucursal_id;
  else if (filtros.sucursal_id) where.sucursal_id = filtros.sucursal_id;
  return RegistroInventario.findAll({
    where,
    include: [
      { model: Producto, as: 'producto', attributes: ['id', 'nombre', 'stock'] },
      { model: Usuario,  as: 'usuario',  attributes: ['id', 'nombre'] },
      INCLUDE_SUCURSAL,
    ],
    order: [['creado_en', 'DESC']],
  });
}

async function compras(filtros = {}, alcance = {}) {
  const { desde, hasta } = filtros;
  const where = filtroFecha(desde, hasta);
  if (!alcance.acceso_todas) where.sucursal_id = alcance.sucursal_id;
  else if (filtros.sucursal_id) where.sucursal_id = filtros.sucursal_id;
  return Compra.findAll({
    where,
    include: [
      { model: Proveedor, as: 'proveedor', attributes: ['id', 'nombre'] },
      { model: Usuario,   as: 'usuario',   attributes: ['id', 'nombre'] },
      INCLUDE_SUCURSAL,
    ],
    order: [['creado_en', 'DESC']],
  });
}

async function caja(filtros = {}, alcance = {}) {
  const { desde, hasta } = filtros;
  const includeSesion = {
    model: SesionCaja,
    as: 'sesion_caja',
    attributes: ['id'],
    include: [INCLUDE_SUCURSAL],
  };
  if (!alcance.acceso_todas) includeSesion.where = { sucursal_id: alcance.sucursal_id };
  else if (filtros.sucursal_id) includeSesion.where = { sucursal_id: filtros.sucursal_id };

  const registros = await LibroCaja.findAll({
    where: filtroFecha(desde, hasta),
    include: [
      { model: Usuario, as: 'usuario', attributes: ['id', 'nombre'] },
      includeSesion,
    ],
    order: [['creado_en', 'DESC']],
  });

  return registros.map(r => {
    const plano = r.toJSON();
    plano.sucursal = plano.sesion_caja?.sucursal ?? null;
    delete plano.sesion_caja;
    return plano;
  });
}

module.exports = { ventas, ventasResumen, ventasProductos, inventario, compras, caja };
