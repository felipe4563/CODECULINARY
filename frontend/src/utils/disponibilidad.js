const NOMBRES_DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

// Texto legible para mostrar en las listas de combos/promociones: cuándo
// está vigente algo que tiene fecha_inicio/fecha_fin opcionales y
// dias_semana opcional (CSV de 0=domingo..6=sábado).
export function describirDisponibilidad({ fecha_inicio, fecha_fin, dias_semana }) {
  const partes = [];

  if (fecha_inicio && fecha_fin) partes.push(`${fecha_inicio} al ${fecha_fin}`);
  else if (fecha_inicio) partes.push(`desde ${fecha_inicio}`);
  else if (fecha_fin) partes.push(`hasta ${fecha_fin}`);

  if (dias_semana) {
    const dias = dias_semana.split(',').map((d) => NOMBRES_DIAS[parseInt(d.trim(), 10)]).filter(Boolean);
    partes.push(dias.join(', '));
  }

  return partes.length === 0 ? 'Siempre disponible' : partes.join(' · ');
}
