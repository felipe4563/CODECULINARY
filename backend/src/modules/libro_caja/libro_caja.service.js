const { Op } = require('sequelize');
const { LibroCaja, SesionCaja, Usuario } = require('../../models');

const INCLUDE_LB = [
  { model: SesionCaja, as: 'sesion_caja', attributes: ['id', 'estado', 'abierto_en'] },
  { model: Usuario, as: 'usuario', attributes: ['id', 'nombre'] },
];

// Offset fijo de Bolivia: un datetime sin offset se parsea en la hora local
// del proceso de Node, que puede no coincidir con la del negocio (-04:00).
function _filtroFecha(desde, hasta) {
  if (!desde && !hasta) return {};
  const range = {};
  if (desde) range[Op.gte] = new Date(`${desde}T00:00:00-04:00`);
  if (hasta) range[Op.lte] = new Date(`${hasta}T23:59:59-04:00`);
  return { creado_en: range };
}

async function _verificarSesionEnAlcance(sesion_caja_id, alcance) {
  const sesion = await SesionCaja.findByPk(sesion_caja_id);
  if (!sesion) throw Object.assign(new Error('Sesión de caja no encontrada'), { status: 404 });
  if (alcance && !alcance.acceso_todas && sesion.sucursal_id !== alcance.sucursal_id) {
    throw Object.assign(new Error('Sesión de caja no encontrada'), { status: 404 });
  }
  return sesion;
}

async function listar({ sesion_caja_id, desde, hasta } = {}, alcance) {
  if (sesion_caja_id) {
    await _verificarSesionEnAlcance(sesion_caja_id, alcance);
    return LibroCaja.findAll({
      where: { sesion_caja_id, ..._filtroFecha(desde, hasta) },
      include: INCLUDE_LB, order: [['creado_en', 'DESC']],
    });
  }

  const include = alcance && !alcance.acceso_todas
    ? [{ ...INCLUDE_LB[0], where: { sucursal_id: alcance.sucursal_id } }, INCLUDE_LB[1]]
    : INCLUDE_LB;

  return LibroCaja.findAll({ where: _filtroFecha(desde, hasta), include, order: [['creado_en', 'DESC']] });
}

async function crear(usuario_id, { sesion_caja_id, tipo, concepto, monto, metodo_pago = 'efectivo' }, alcance) {
  if (!['ingreso', 'egreso'].includes(tipo)) throw Object.assign(new Error('tipo debe ser ingreso o egreso'), { status: 400 });
  await _verificarSesionEnAlcance(sesion_caja_id, alcance);
  const entrada = await LibroCaja.create({ sesion_caja_id, usuario_id, tipo, concepto, monto, metodo_pago });

  // El cierre de caja calcula "esperado en caja" restando sesion.total_gastos
  // (no sumando egresos del libro en vivo), así que un egreso en efectivo
  // cargado acá tiene que reflejarse ahí también — si no, el arqueo del
  // cierre no cuadra con el efectivo real que salió de la caja.
  if (tipo === 'egreso' && metodo_pago === 'efectivo') {
    await SesionCaja.increment('total_gastos', { by: parseFloat(monto), where: { id: sesion_caja_id } });
  }

  return entrada;
}

module.exports = { listar, crear };
