const { Op } = require('sequelize');
const { MarcacionPersonal, HorarioPersonal } = require('../models');

// Cubre cómodamente el turno más largo razonable, incluyendo uno nocturno,
// sin arriesgarse a cerrar uno que sigue genuinamente en curso (ver spec).
const UMBRAL_CIERRE_AUTOMATICO_HORAS = 16;
// Tope conservador para el caso raro de una entrada marcada un día sin
// horario configurado (día libre, o todavía no se cargó ningún horario).
const HORAS_SALIDA_POR_DEFECTO_SIN_HORARIO = 8;

// `fecha` es un DATEONLY 'YYYY-MM-DD' — se parsea a mediodía UTC para que
// ningún huso horario lo corra al día calendario anterior o siguiente antes
// de leer su día de la semana.
function _diaSemanaDe(fecha) {
  return new Date(`${fecha}T12:00:00Z`).getUTCDay();
}

async function cerrarMarcacionesAbandonadas() {
  const limite = new Date(Date.now() - UMBRAL_CIERRE_AUTOMATICO_HORAS * 60 * 60 * 1000);
  const abiertas = await MarcacionPersonal.findAll({
    where: { estado: 'abierto', hora_entrada: { [Op.lt]: limite } },
  });

  let cerrados = 0;
  for (const marcacion of abiertas) {
    const diaSemana = _diaSemanaDe(marcacion.fecha);
    const horario = await HorarioPersonal.findOne({ where: { usuario_id: marcacion.usuario_id, dia_semana: diaSemana } });

    let horaSalida;
    if (horario && horario.trabaja && horario.hora_salida) {
      horaSalida = new Date(`${marcacion.fecha}T${horario.hora_salida}-04:00`);
      // Turno nocturno: si la hora de salida configurada cae "antes" que la
      // entrada dentro del mismo día calendario (ej. entrada 22:00, salida
      // 02:00), en realidad es la madrugada del día siguiente.
      if (horaSalida <= marcacion.hora_entrada) {
        horaSalida = new Date(horaSalida.getTime() + 24 * 60 * 60 * 1000);
      }
      // Salvaguarda: si la entrada se marcó tarde (después de la hora de
      // salida programada de ese mismo día), el rollover de arriba empujaría
      // la salida calculada casi un día completo hacia adelante — eso
      // generaría horas extra no aprobadas (ver spec, Goal 2). Si el cálculo
      // por horario excede el umbral de cierre automático, o cae en el
      // futuro, se descarta y se usa el tope por defecto.
      const excedeUmbral = horaSalida.getTime() - marcacion.hora_entrada.getTime() > UMBRAL_CIERRE_AUTOMATICO_HORAS * 60 * 60 * 1000;
      const enElFuturo = horaSalida.getTime() > Date.now();
      if (excedeUmbral || enElFuturo) {
        horaSalida = new Date(marcacion.hora_entrada.getTime() + HORAS_SALIDA_POR_DEFECTO_SIN_HORARIO * 60 * 60 * 1000);
      }
    } else {
      horaSalida = new Date(marcacion.hora_entrada.getTime() + HORAS_SALIDA_POR_DEFECTO_SIN_HORARIO * 60 * 60 * 1000);
    }

    await marcacion.update({ hora_salida: horaSalida, verificacion_salida: 'sin_verificar', estado: 'cierre_automatico' });
    cerrados++;
  }
  return { cerrados };
}

module.exports = { cerrarMarcacionesAbandonadas };
