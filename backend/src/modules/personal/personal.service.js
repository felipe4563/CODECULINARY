const { Op } = require('sequelize');
const { MarcacionPersonal, Sucursal } = require('../../models');

// Mismo criterio que _rangoDiaBolivia en ventas.service.js: el día
// calendario del turno se calcula en hora Bolivia (-04:00), no en la hora
// del proceso de Node/VPS.
function _fechaBolivia(referencia = new Date()) {
  return new Date(referencia.getTime() - 4 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const RADIO_TIERRA_METROS = 6371000;

function _distanciaMetros(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return RADIO_TIERRA_METROS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Nunca bloquea: si no hay ubicación del navegador o la sucursal todavía no
// tiene coordenadas cargadas, la marcación queda "sin_verificar" pero se
// deja marcar igual (ver spec — nunca se le niega el marcado a nadie por un
// problema de GPS).
async function _verificarUbicacion(sucursal_id, lat, lng) {
  if (lat == null || lng == null) return 'sin_verificar';
  const sucursal = await Sucursal.findByPk(sucursal_id);
  if (!sucursal || sucursal.latitud == null || sucursal.longitud == null) return 'sin_verificar';
  const distancia = _distanciaMetros(parseFloat(sucursal.latitud), parseFloat(sucursal.longitud), lat, lng);
  return distancia <= sucursal.radio_geocerca_metros ? 'ok' : 'fuera_de_rango';
}

// Alterna automáticamente: si el empleado no tiene una marcación abierta,
// crea la entrada; si ya tiene una, la cierra como salida. Nunca puede
// existir una segunda fila 'abierto' para el mismo usuario porque solo se
// crea en la rama donde `abierta` es null.
async function marcar({ usuario_id, sucursal_id, lat, lng }) {
  const abierta = await MarcacionPersonal.findOne({ where: { usuario_id, estado: 'abierto' } });
  const verificacion = await _verificarUbicacion(sucursal_id, lat, lng);

  if (!abierta) {
    return MarcacionPersonal.create({
      usuario_id,
      sucursal_id,
      fecha: _fechaBolivia(),
      hora_entrada: new Date(),
      lat_entrada: lat ?? null,
      lng_entrada: lng ?? null,
      verificacion_entrada: verificacion,
      hora_salida: null,
      lat_salida: null,
      lng_salida: null,
      verificacion_salida: null,
      estado: 'abierto',
    });
  }

  await abierta.update({
    hora_salida: new Date(),
    lat_salida: lat ?? null,
    lng_salida: lng ?? null,
    verificacion_salida: verificacion,
    estado: 'cerrado',
  });
  return abierta;
}

async function miEstado(usuario_id) {
  const marcacion_abierta = await MarcacionPersonal.findOne({ where: { usuario_id, estado: 'abierto' } });

  const desde = new Date();
  desde.setDate(desde.getDate() - 14);
  const historial = await MarcacionPersonal.findAll({
    where: { usuario_id, fecha: { [Op.gte]: _fechaBolivia(desde) } },
    order: [['fecha', 'DESC'], ['hora_entrada', 'DESC']],
  });

  // Solo se muestra un aviso de corrección a la vez, el más antiguo sin
  // resolver — si el empleado tiene varios cierres automáticos pendientes,
  // van apareciendo de a uno según los va completando (ver spec).
  const correccion_pendiente = await MarcacionPersonal.findOne({
    where: { usuario_id, estado: 'cierre_automatico', hora_salida_propuesta: null },
    order: [['fecha', 'ASC']],
  });

  return { marcacion_abierta, historial, correccion_pendiente };
}

async function proponerSalida(usuario_id, marcacion_id, { hora_salida_propuesta, nota_propuesta } = {}) {
  const marcacion = await MarcacionPersonal.findOne({ where: { id: marcacion_id, usuario_id } });
  if (!marcacion) throw Object.assign(new Error('Marcación no encontrada'), { status: 404 });
  if (marcacion.estado !== 'cierre_automatico') {
    throw Object.assign(new Error('Esta marcación no requiere corrección'), { status: 409 });
  }
  if (!hora_salida_propuesta) {
    throw Object.assign(new Error('hora_salida_propuesta es requerida'), { status: 400 });
  }
  await marcacion.update({ hora_salida_propuesta, nota_propuesta: nota_propuesta || null });
  return marcacion;
}

module.exports = { marcar, miEstado, proponerSalida };
