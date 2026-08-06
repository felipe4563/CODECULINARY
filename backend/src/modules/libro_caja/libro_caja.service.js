const { Op } = require('sequelize');
const { LibroCaja, SesionCaja, Usuario } = require('../../models');
const { emitir } = require('../../socket');

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

  const where = _filtroFecha(desde, hasta);
  if (alcance && !alcance.acceso_todas) {
    // Filtrar por sucursal vía un `where` en el include de sesion_caja lo
    // convertiría en INNER JOIN, ocultando los movimientos sin sesión
    // (sesion_caja_id null, ej. compras recibidas o gastos "sin sesión").
    // En vez de eso, se arma la lista de sesiones de la sucursal y se filtra
    // a nivel de libro_caja con OR, dejando pasar también los sin sesión.
    const sesionesSucursal = await SesionCaja.findAll({
      where: { sucursal_id: alcance.sucursal_id }, attributes: ['id'],
    });
    const sesionIds = sesionesSucursal.map((s) => s.id);
    where[Op.or] = [{ sesion_caja_id: null }, { sesion_caja_id: { [Op.in]: sesionIds } }];
  }

  return LibroCaja.findAll({ where, include: INCLUDE_LB, order: [['creado_en', 'DESC']] });
}

// `sesion_caja_id` es opcional: el libro de caja también sirve para anotar
// gastos/ingresos fuera de una sesión de caja abierta (ej. fuera de horario
// de atención) — no todo movimiento de plata pasa necesariamente por una
// caja registradora activa.
async function crear(usuario_id, { sesion_caja_id, tipo, concepto, monto, metodo_pago = 'efectivo' }, alcance) {
  if (!['ingreso', 'egreso'].includes(tipo)) throw Object.assign(new Error('tipo debe ser ingreso o egreso'), { status: 400 });
  if (sesion_caja_id) await _verificarSesionEnAlcance(sesion_caja_id, alcance);
  const entrada = await LibroCaja.create({ sesion_caja_id: sesion_caja_id || null, usuario_id, tipo, concepto, monto, metodo_pago });

  // El cierre de caja calcula "esperado en caja" restando sesion.total_gastos
  // (no sumando egresos del libro en vivo), así que un egreso en efectivo
  // cargado acá tiene que reflejarse ahí también — si no, el arqueo del
  // cierre no cuadra con el efectivo real que salió de la caja. Sin sesión
  // no hay nada que reconciliar (no afecta ningún arqueo).
  if (sesion_caja_id && tipo === 'egreso' && metodo_pago === 'efectivo') {
    await SesionCaja.increment('total_gastos', { by: parseFloat(monto), where: { id: sesion_caja_id } });
  }

  // Avisa a pantallas abiertas (ej. Dashboard) para que refresquen sin
  // esperar al polling — mismo patrón que ventas.service.js usa para ventas.
  emitir('restaurante:actualizar', { tipo: 'gasto_nuevo' }, alcance?.sucursal_id);

  return entrada;
}

module.exports = { listar, crear };
