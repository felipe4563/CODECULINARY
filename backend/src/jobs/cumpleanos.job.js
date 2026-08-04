const { Op, fn, col, where } = require('sequelize');
const { Cliente, Cupon, Configuracion } = require('../models');

// parseInt(...) || default fallaría con valores en 0 (0 es falsy en JS), y
// 0 es un valor válido tanto para días de anticipación como de vigencia.
function _entero(valor, porDefecto) {
  const n = parseInt(valor, 10);
  return Number.isFinite(n) ? n : porDefecto;
}

async function _configCumple() {
  const rows = await Configuracion.findAll({
    where: { clave: ['cumple_activo', 'cumple_dias_anticipacion', 'cumple_tipo', 'cumple_valor', 'cumple_vigencia_dias'] },
  });
  const cfg = rows.reduce((o, r) => { o[r.clave] = r.valor; return o; }, {});
  return {
    activo: cfg.cumple_activo === 'true',
    diasAnticipacion: _entero(cfg.cumple_dias_anticipacion, 5),
    tipo: cfg.cumple_tipo === 'fijo' ? 'fijo' : 'porcentaje',
    valor: Number.isFinite(parseFloat(cfg.cumple_valor)) ? parseFloat(cfg.cumple_valor) : 10,
    vigenciaDias: _entero(cfg.cumple_vigencia_dias, 10),
  };
}

// "Hoy" en hora de Bolivia (-04:00), mismo criterio que _rangoDiaBolivia en
// ventas.service.js — evita depender de la zona horaria del proceso/VPS.
function _hoyBolivia() {
  return new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function _sumarDias(fechaISO, dias) {
  const d = new Date(`${fechaISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d;
}

// Revisa qué clientes cumplen años dentro de `diasAnticipacion` días a
// partir de hoy y, si el programa está activo, les genera un cupón personal
// (exclusivo de su cliente_id) — uno por cliente por año calendario: el
// código incluye el año, así que si el job ya corrió ese año para ese
// cliente, lo detecta por el código repetido y lo salta.
async function generarCuponesCumpleanos() {
  const cfg = await _configCumple();
  if (!cfg.activo) return { generados: 0 };

  const objetivo = _sumarDias(_hoyBolivia(), cfg.diasAnticipacion);
  const mes = objetivo.getUTCMonth() + 1;
  const dia = objetivo.getUTCDate();
  const year = objetivo.getUTCFullYear();

  const clientes = await Cliente.findAll({
    where: {
      fecha_nacimiento: { [Op.ne]: null },
      [Op.and]: [
        where(fn('MONTH', col('fecha_nacimiento')), mes),
        where(fn('DAY', col('fecha_nacimiento')), dia),
      ],
    },
  });

  const fechaExpiracion = _sumarDias(objetivo.toISOString().slice(0, 10), cfg.vigenciaDias).toISOString().slice(0, 10);

  let generados = 0;
  for (const cliente of clientes) {
    const codigo = `CUMPLE${cliente.id}-${year}`;
    const existente = await Cupon.findOne({ where: { codigo } });
    if (existente) continue;

    await Cupon.create({
      codigo, tipo: cfg.tipo, valor: cfg.valor, fecha_expiracion: fechaExpiracion,
      usos_maximos: 1, cliente_id: cliente.id, activo: 1,
    });
    generados++;
  }

  return { generados };
}

module.exports = { generarCuponesCumpleanos };
