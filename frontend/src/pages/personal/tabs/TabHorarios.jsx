import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, User } from 'lucide-react';
import { getFiltrosPersonal, getHorarioPersonal, guardarHorarioPersonal } from '../../../api/personal';

const NOMBRES_DIA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export default function TabHorarios() {
  const qc = useQueryClient();
  const [usuarioId, setUsuarioId] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [dias, setDias] = useState(null);
  const [error, setError] = useState(null);
  const [guardado, setGuardado] = useState(false);

  const { data: filtros } = useQuery({ queryKey: ['personal-filtros'], queryFn: getFiltrosPersonal });
  const empleados = filtros?.empleados ?? [];
  const empleadosFiltrados = empleados.filter((e) =>
    e.nombre.toLowerCase().includes(busqueda.trim().toLowerCase())
  );
  const empleadoSeleccionado = empleados.find((e) => String(e.id) === String(usuarioId));

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
    <div className="flex flex-col md:flex-row gap-4">
      {/* Lista de empleados */}
      <div className="md:w-72 shrink-0 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar empleado..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="space-y-1.5 max-h-[60vh] md:max-h-[65vh] overflow-y-auto">
          {empleadosFiltrados.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Sin resultados</p>
          ) : empleadosFiltrados.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => selectUsuario(e.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-colors border ${
                String(usuarioId) === String(e.id)
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card border-border hover:bg-muted/50'
              }`}
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                String(usuarioId) === String(e.id) ? 'bg-primary-foreground/20' : 'bg-primary/10'
              }`}>
                <User className={`w-4 h-4 ${String(usuarioId) === String(e.id) ? 'text-primary-foreground' : 'text-primary'}`} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{e.nombre}</p>
                <p className={`text-xs truncate ${String(usuarioId) === String(e.id) ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
                  {e.rol?.nombre}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Editor de horario */}
      <div className="flex-1 min-w-0">
        {!usuarioId ? (
          <div className="flex flex-col items-center justify-center h-48 text-muted-foreground text-sm gap-2 border border-dashed border-border rounded-xl">
            <User className="w-8 h-8 opacity-40" />
            Seleccioná un empleado de la lista
          </div>
        ) : dias && (
        <div className="space-y-2">
          <h3 className="text-sm font-bold text-foreground mb-1">{empleadoSeleccionado?.nombre}</h3>
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
    </div>
  );
}
