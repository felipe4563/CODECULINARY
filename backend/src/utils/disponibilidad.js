// Determina si un combo/promoción está vigente "hoy" (hora de Bolivia,
// -04:00, igual criterio que _rangoDiaBolivia en ventas.service.js) según su
// rango de fechas opcional y sus días de la semana opcionales.
// `dias_semana` se guarda como CSV de números 0=domingo .. 6=sábado;
// null/vacío significa "todos los días".
function estaActivoHoy({ fecha_inicio, fecha_fin, dias_semana }, referencia = new Date()) {
  const bolivia = new Date(referencia.getTime() - 4 * 60 * 60 * 1000);
  const hoy = bolivia.toISOString().slice(0, 10);

  if (fecha_inicio && hoy < fecha_inicio) return false;
  if (fecha_fin && hoy > fecha_fin) return false;

  if (dias_semana) {
    const diaSemana = bolivia.getUTCDay(); // 0=domingo..6=sábado, sobre la fecha ya desplazada a hora Bolivia
    const permitidos = String(dias_semana).split(',').map((d) => parseInt(d.trim(), 10));
    if (!permitidos.includes(diaSemana)) return false;
  }

  return true;
}

module.exports = { estaActivoHoy };
