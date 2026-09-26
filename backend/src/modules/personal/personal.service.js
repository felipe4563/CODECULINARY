const { Op } = require('sequelize');
const { MarcacionPersonal, HorarioPersonal, Usuario, Rol, Sucursal } = require('../../models');

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

  // Solo se bloquea cuando el sistema está SEGURO de que está fuera del
  // radio (hay GPS del navegador y coordenadas de la sucursal para
  // comparar). 'sin_verificar' nunca bloquea — no hay con qué comparar, y
  // bloquear ahí dejaría a alguien sin poder marcar por un problema técnico
  // de su celular (GPS apagado, sin señal, permiso denegado).
  if (verificacion === 'fuera_de_rango') {
    throw Object.assign(new Error('Estás fuera del radio permitido para marcar en esta sucursal'), { status: 409 });
  }

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

// Reglas de "cuándo es la salida real" compartidas entre el cron (que ya las
// implementaba) y las correcciones manuales — evita que una corrección o
// aprobación pinee la salida al día de la entrada cuando el turno cruza la
// medianoche.
function _normalizarHoraSalida(horaEntrada, candidata) {
  const entrada = new Date(horaEntrada);
  let salida = new Date(candidata);
  if (isNaN(salida.getTime())) {
    throw Object.assign(new Error('Hora de salida inválida'), { status: 400 });
  }
  if (salida <= entrada) {
    salida = new Date(salida.getTime() + 24 * 60 * 60 * 1000);
  }
  if (salida.getTime() - entrada.getTime() > 24 * 60 * 60 * 1000) {
    throw Object.assign(new Error('La hora de salida no puede ser más de 24 horas después de la entrada'), { status: 400 });
  }
  return salida;
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
  const salidaNormalizada = _normalizarHoraSalida(marcacion.hora_entrada, hora_salida_propuesta);
  await marcacion.update({ hora_salida_propuesta: salidaNormalizada, nota_propuesta: nota_propuesta || null });
  return marcacion;
}

const DIAS_SEMANA = [0, 1, 2, 3, 4, 5, 6];

// Para los selectores de sucursal/empleado de "Control de Personal" — se
// devuelven acá (en vez de pedirle al frontend que use GET /sucursales o
// GET /usuarios) para no acoplar esta pantalla a los permisos
// sucursales.ver/usuarios.ver de otros módulos, que un rol con solo
// personal.administrar no tendría por qué tener.
async function filtros() {
  const [sucursales, empleados] = await Promise.all([
    Sucursal.findAll({ where: { activo: 1 }, attributes: ['id', 'nombre'], order: [['nombre', 'ASC']] }),
    Usuario.findAll({
      where: { activo: 1 },
      attributes: ['id', 'nombre'],
      include: [{ model: Rol, as: 'rol', attributes: ['id', 'nombre'] }],
      order: [['nombre', 'ASC']],
    }),
  ]);
  return { sucursales, empleados };
}

async function obtenerHorario(usuario_id) {
  const usuario = await Usuario.findByPk(usuario_id);
  if (!usuario) throw Object.assign(new Error('Usuario no encontrado'), { status: 404 });
  const filas = await HorarioPersonal.findAll({ where: { usuario_id } });
  const porDia = {};
  filas.forEach((f) => { porDia[f.dia_semana] = f; });
  return DIAS_SEMANA.map((dia_semana) => {
    const f = porDia[dia_semana];
    return {
      dia_semana,
      trabaja: f ? !!f.trabaja : true,
      hora_entrada: f ? f.hora_entrada : null,
      hora_salida: f ? f.hora_salida : null,
    };
  });
}

async function guardarHorario(usuario_id, dias) {
  const usuario = await Usuario.findByPk(usuario_id);
  if (!usuario) throw Object.assign(new Error('Usuario no encontrado'), { status: 404 });
  if (!Array.isArray(dias) || dias.length !== 7) {
    throw Object.assign(new Error('Se requieren los 7 días de la semana'), { status: 400 });
  }
  const diasVistos = new Set();
  for (const d of dias) {
    if (!DIAS_SEMANA.includes(d.dia_semana) || diasVistos.has(d.dia_semana)) {
      throw Object.assign(new Error('dia_semana inválido o repetido'), { status: 400 });
    }
    diasVistos.add(d.dia_semana);
    if (d.trabaja && (!d.hora_entrada || !d.hora_salida)) {
      throw Object.assign(new Error('Los días laborales requieren hora de entrada y salida'), { status: 400 });
    }
  }
  for (const d of dias) {
    await HorarioPersonal.upsert({
      usuario_id,
      dia_semana: d.dia_semana,
      trabaja: d.trabaja ? 1 : 0,
      hora_entrada: d.trabaja ? d.hora_entrada : null,
      hora_salida: d.trabaja ? d.hora_salida : null,
    });
  }
  return obtenerHorario(usuario_id);
}

// Deliberadamente sin restricción de sucursal por acceso_todas_sucursales:
// "Control de Personal" es cross-sucursal para cualquiera con
// personal.administrar (ver spec y Global Constraints de este plan).
async function listarMarcaciones({ sucursal_id, usuario_id, desde, hasta } = {}) {
  const where = {};
  if (sucursal_id) where.sucursal_id = sucursal_id;
  if (usuario_id) where.usuario_id = usuario_id;
  if (desde || hasta) {
    where.fecha = {};
    if (desde) where.fecha[Op.gte] = desde;
    if (hasta) where.fecha[Op.lte] = hasta;
  }
  return MarcacionPersonal.findAll({
    where,
    include: [
      { model: Usuario, as: 'usuario', attributes: ['id', 'nombre'] },
      { model: Sucursal, as: 'sucursal', attributes: ['id', 'nombre'] },
      { model: Usuario, as: 'aprobador', attributes: ['id', 'nombre'] },
    ],
    order: [['fecha', 'DESC'], ['hora_entrada', 'DESC']],
  });
}

async function resolverCierreAutomatico(marcacion_id, admin_usuario_id, { hora_salida } = {}) {
  const marcacion = await MarcacionPersonal.findByPk(marcacion_id);
  if (!marcacion) throw Object.assign(new Error('Marcación no encontrada'), { status: 404 });
  if (marcacion.estado !== 'cierre_automatico') {
    throw Object.assign(new Error('Esta marcación no está pendiente de revisión'), { status: 409 });
  }
  if (!hora_salida) throw Object.assign(new Error('hora_salida es requerida'), { status: 400 });
  const salidaNormalizada = _normalizarHoraSalida(marcacion.hora_entrada, hora_salida);
  await marcacion.update({
    hora_salida: salidaNormalizada,
    estado: 'cerrado',
    aprobado_por: admin_usuario_id,
    aprobado_en: new Date(),
  });
  return marcacion;
}

module.exports = { marcar, miEstado, proponerSalida, filtros, obtenerHorario, guardarHorario, listarMarcaciones, resolverCierreAutomatico };
