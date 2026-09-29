import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, Pencil } from 'lucide-react';
import { getFiltrosPersonal, getMarcacionesPersonal, resolverMarcacionPersonal, editarMarcacionPersonal } from '../../../api/personal';
import { getConfiguracionPublica, logoSrc } from '../../../api/configuracion';
import { useAuth } from '../../../hooks/useAuth';
import { exportarPDF } from '../../reportes/utils/exportarPDF';

function _horasTrabajadas(entrada, salida) {
  if (!salida) return '—';
  const totalMinutos = Math.round((new Date(salida) - new Date(entrada)) / 60000);
  const horas = Math.floor(totalMinutos / 60);
  const minutos = totalMinutos % 60;
  return `${horas}h ${minutos}m`;
}

function _fechaHora(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-BO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/La_Paz' });
}

function FilaResolver({ marcacion, onResuelto }) {
  const [hora, setHora] = useState(() => {
    const base = marcacion.hora_salida_propuesta || marcacion.hora_salida;
    return base
      ? new Date(base).toLocaleTimeString('en-GB', { timeZone: 'America/La_Paz', hour: '2-digit', minute: '2-digit' })
      : '';
  });
  const [error, setError] = useState(null);

  const resolver = useMutation({
    mutationFn: () => resolverMarcacionPersonal(marcacion.id, `${marcacion.fecha}T${hora}:00-04:00`),
    onSuccess: onResuelto,
    onError: (err) => setError(err?.response?.data?.mensaje ?? 'No se pudo resolver'),
  });

  return (
    <div className="flex flex-wrap items-center gap-2 mt-2">
      <input type="time" value={hora} onChange={(e) => setHora(e.target.value)}
        className="px-2 py-1 text-xs rounded-lg border border-input bg-background text-foreground" />
      <button onClick={() => resolver.mutate()} disabled={!hora || resolver.isPending}
        className="px-3 py-1 rounded-lg bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-60">
        {resolver.isPending ? 'Guardando...' : 'Aprobar salida'}
      </button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}

function _horaLocal(iso, fallback) {
  const base = iso || fallback;
  return base
    ? new Date(base).toLocaleTimeString('en-GB', { timeZone: 'America/La_Paz', hour: '2-digit', minute: '2-digit' })
    : '';
}

function FilaEditar({ marcacion, onGuardado, onCancelar }) {
  const [horaEntrada, setHoraEntrada] = useState(() => _horaLocal(marcacion.hora_entrada));
  const [horaSalida, setHoraSalida] = useState(() => _horaLocal(marcacion.hora_salida_propuesta, marcacion.hora_salida));
  const [error, setError] = useState(null);

  const editar = useMutation({
    mutationFn: () => editarMarcacionPersonal(marcacion.id, {
      hora_entrada: `${marcacion.fecha}T${horaEntrada}:00-04:00`,
      hora_salida: `${marcacion.fecha}T${horaSalida}:00-04:00`,
    }),
    onSuccess: onGuardado,
    onError: (err) => setError(err?.response?.data?.mensaje ?? 'No se pudo editar la marcación'),
  });

  return (
    <div className="flex flex-wrap items-end gap-2 mt-2">
      <div className="flex flex-col gap-0.5">
        <label className="text-[11px] text-muted-foreground">Entrada</label>
        <input type="time" value={horaEntrada} onChange={(e) => setHoraEntrada(e.target.value)}
          className="px-2 py-1 text-xs rounded-lg border border-input bg-background text-foreground" />
      </div>
      <div className="flex flex-col gap-0.5">
        <label className="text-[11px] text-muted-foreground">Salida</label>
        <input type="time" value={horaSalida} onChange={(e) => setHoraSalida(e.target.value)}
          className="px-2 py-1 text-xs rounded-lg border border-input bg-background text-foreground" />
      </div>
      <button onClick={() => editar.mutate()} disabled={!horaEntrada || !horaSalida || editar.isPending}
        className="px-3 py-1 rounded-lg bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-60">
        {editar.isPending ? 'Guardando...' : 'Guardar'}
      </button>
      <button onClick={onCancelar} className="px-3 py-1 rounded-lg border border-input text-xs text-muted-foreground">
        Cancelar
      </button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}

export default function TabRegistros() {
  const { usuario } = useAuth();
  const [sucursalId, setSucursalId] = useState('todas');
  const [empleadoId, setEmpleadoId] = useState('todos');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [exportando, setExportando] = useState(false);
  const [editandoId, setEditandoId] = useState(null);

  const { data: filtros } = useQuery({ queryKey: ['personal-filtros'], queryFn: getFiltrosPersonal });
  const { data: config = {} } = useQuery({ queryKey: ['configuracion-publica'], queryFn: getConfiguracionPublica });

  const params = {
    sucursal_id: sucursalId !== 'todas' ? sucursalId : undefined,
    usuario_id: empleadoId !== 'todos' ? empleadoId : undefined,
    desde: desde || undefined,
    hasta: hasta || undefined,
  };

  const { data: marcaciones = [], refetch } = useQuery({
    queryKey: ['personal-marcaciones', params.sucursal_id, params.usuario_id, params.desde, params.hasta],
    queryFn: () => getMarcacionesPersonal(params),
  });

  const exportar = async () => {
    setExportando(true);
    try {
      exportarPDF({
        titulo: 'Registros de Asistencia',
        subtitulo: `${desde || 'Todo el historial'} — ${hasta || 'hoy'}`,
        empresa: config.nombre_negocio,
        logo: logoSrc(config.logo),
        direccion: config.direccion,
        telefono: config.telefono,
        generadoPor: usuario?.nombre,
        columnas: ['Empleado', 'Sucursal', 'Fecha', 'Entrada', 'Salida', 'Horas', 'Estado', 'Verif. entrada', 'Verif. salida', 'Aprobado por', 'Aprobado el'],
        filas: marcaciones.map((m) => [
          m.usuario?.nombre || '-',
          m.sucursal?.nombre || '-',
          m.fecha,
          _fechaHora(m.hora_entrada),
          _fechaHora(m.hora_salida),
          _horasTrabajadas(m.hora_entrada, m.hora_salida),
          m.estado,
          m.verificacion_entrada,
          m.verificacion_salida || '-',
          m.aprobador?.nombre || '-',
          _fechaHora(m.aprobado_en),
        ]),
        nombreArchivo: `registros-asistencia-${desde || 'todo'}-${hasta || 'hoy'}.pdf`,
      });
    } finally {
      setExportando(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Sucursal</label>
          <select value={sucursalId} onChange={(e) => setSucursalId(e.target.value)}
            className="px-3 py-2 text-sm rounded-xl border border-input bg-background text-foreground">
            <option value="todas">Todas</option>
            {(filtros?.sucursales ?? []).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Empleado</label>
          <select value={empleadoId} onChange={(e) => setEmpleadoId(e.target.value)}
            className="px-3 py-2 text-sm rounded-xl border border-input bg-background text-foreground">
            <option value="todos">Todos</option>
            {(filtros?.empleados ?? []).map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Desde</label>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)}
            className="px-3 py-2 text-sm rounded-xl border border-input bg-background text-foreground" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Hasta</label>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)}
            className="px-3 py-2 text-sm rounded-xl border border-input bg-background text-foreground" />
        </div>
        <button onClick={exportar} disabled={!marcaciones.length || exportando}
          className="self-end flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-xl text-sm font-medium">
          <Download className="w-4 h-4" /> Exportar
        </button>
      </div>

      <div className="space-y-2">
        {marcaciones.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Sin registros para este filtro</p>
        ) : marcaciones.map((m) => (
          <div key={m.id} className={`p-3 rounded-xl border ${m.estado === 'cierre_automatico' ? 'border-red-300 dark:border-red-800/50 bg-red-50 dark:bg-red-900/10' : 'border-border'}`}>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <div>
                <p className="font-medium text-foreground">{m.usuario?.nombre} · {m.sucursal?.nombre}</p>
                <p className="text-xs text-muted-foreground">
                  {m.fecha} · {_fechaHora(m.hora_entrada)} — {m.hora_salida ? _fechaHora(m.hora_salida) : 'en curso'} ({_horasTrabajadas(m.hora_entrada, m.hora_salida)})
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-xs">
                <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{m.verificacion_entrada}</span>
                {m.verificacion_salida && <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{m.verificacion_salida}</span>}
                {m.estado === 'cierre_automatico' && (
                  <span className="px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 font-medium">Cierre automático</span>
                )}
                {m.estado !== 'abierto' && editandoId !== m.id && (
                  <button onClick={() => setEditandoId(m.id)} title="Editar entrada y salida"
                    className="p-1 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
            {m.estado === 'cierre_automatico' && editandoId !== m.id && (
              <>
                {m.hora_salida_propuesta && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Propuesta del empleado: {_fechaHora(m.hora_salida_propuesta)}{m.nota_propuesta ? ` — "${m.nota_propuesta}"` : ''}
                  </p>
                )}
                <FilaResolver marcacion={m} onResuelto={refetch} />
              </>
            )}
            {editandoId === m.id && (
              <FilaEditar marcacion={m} onCancelar={() => setEditandoId(null)}
                onGuardado={() => { setEditandoId(null); refetch(); }} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
