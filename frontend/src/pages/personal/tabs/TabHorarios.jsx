import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getFiltrosPersonal, getHorarioPersonal, guardarHorarioPersonal } from '../../../api/personal';

const NOMBRES_DIA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export default function TabHorarios() {
  const qc = useQueryClient();
  const [usuarioId, setUsuarioId] = useState('');
  const [dias, setDias] = useState(null);
  const [error, setError] = useState(null);
  const [guardado, setGuardado] = useState(false);

  const { data: filtros } = useQuery({ queryKey: ['personal-filtros'], queryFn: getFiltrosPersonal });

  const { data: horario, isLoading: cargandoHorario } = useQuery({
    queryKey: ['personal-horario', usuarioId],
    queryFn: () => getHorarioPersonal(usuarioId),
    enabled: !!usuarioId,
  });

  // Sincronizar el formulario con lo que llega del servidor la primera vez
  // que carga para este empleado (mismo patrón que TabNegocio.jsx: setState
  // condicional durante el render, en vez de onSuccess que ya no existe en
  // useQuery de TanStack Query v5). selectUsuario limpia `dias` a null para
  // que esto vuelva a sincronizar al cambiar de empleado.
  if (!cargandoHorario && horario && dias === null) {
    setDias(horario);
  }

  const selectUsuario = (id) => {
    setUsuarioId(id);
    setDias(null);
    setGuardado(false);
    setError(null);
  };

  const guardar = useMutation({
    mutationFn: () => guardarHorarioPersonal(usuarioId, dias),
    onSuccess: (data) => {
      setDias(data);
      setError(null);
      setGuardado(true);
      qc.invalidateQueries({ queryKey: ['personal-horario', usuarioId] });
    },
    onError: (err) => setError(err?.response?.data?.mensaje ?? 'No se pudo guardar el horario'),
  });

  const actualizarDia = (dia_semana, cambios) => {
    setDias((prev) => prev.map((d) => (d.dia_semana === dia_semana ? { ...d, ...cambios } : d)));
    setGuardado(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-1 max-w-sm">
        <label className="text-xs font-medium text-muted-foreground">Empleado</label>
        <select value={usuarioId} onChange={(e) => selectUsuario(e.target.value)}
          className="px-3 py-2 text-sm rounded-xl border border-input bg-background text-foreground">
          <option value="">Seleccioná un empleado</option>
          {(filtros?.empleados ?? []).map((e) => (
            <option key={e.id} value={e.id}>{e.nombre} ({e.rol?.nombre})</option>
          ))}
        </select>
      </div>

      {dias && (
        <div className="space-y-2">
          {dias.map((d) => (
            <div key={d.dia_semana} className="flex flex-wrap items-center gap-3 p-3 rounded-xl border border-border">
              <label className="flex items-center gap-2 w-32 shrink-0">
                <input
                  type="checkbox"
                  checked={d.trabaja}
                  onChange={(e) => actualizarDia(d.dia_semana, {
                    trabaja: e.target.checked,
                    hora_entrada: e.target.checked ? (d.hora_entrada || '08:00') : null,
                    hora_salida: e.target.checked ? (d.hora_salida || '17:00') : null,
                  })}
                />
                <span className="text-sm font-medium text-foreground">{NOMBRES_DIA[d.dia_semana]}</span>
              </label>
              {d.trabaja ? (
                <div className="flex items-center gap-2">
                  <input type="time" value={(d.hora_entrada || '').slice(0, 5)}
                    onChange={(e) => actualizarDia(d.dia_semana, { hora_entrada: e.target.value })}
                    className="px-2 py-1.5 text-sm rounded-lg border border-input bg-background text-foreground" />
                  <span className="text-sm text-muted-foreground">a</span>
                  <input type="time" value={(d.hora_salida || '').slice(0, 5)}
                    onChange={(e) => actualizarDia(d.dia_semana, { hora_salida: e.target.value })}
                    className="px-2 py-1.5 text-sm rounded-lg border border-input bg-background text-foreground" />
                </div>
              ) : (
                <span className="text-sm text-muted-foreground italic">Día libre</span>
              )}
            </div>
          ))}

          {error && <p className="text-sm text-destructive">{error}</p>}
          {guardado && <p className="text-sm text-emerald-600 dark:text-emerald-400">Horario guardado</p>}

          <button onClick={() => guardar.mutate()} disabled={guardar.isPending}
            className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-60">
            {guardar.isPending ? 'Guardando...' : 'Guardar horario'}
          </button>
        </div>
      )}
    </div>
  );
}
