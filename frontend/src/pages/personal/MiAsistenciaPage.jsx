import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, LogIn, LogOut, AlertCircle, MapPin } from 'lucide-react';
import { marcarAsistencia, getMiEstadoAsistencia, proponerHoraSalida } from '../../api/personal';

// Nunca rechaza: si el navegador no soporta geolocalización, el usuario la
// niega, o se agota el tiempo de espera, se resuelve con lat/lng null — la
// marcación sigue adelante igual, solo queda "sin_verificar" (ver spec).
function _obtenerUbicacion() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ lat: null, lng: null });
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve({ lat: null, lng: null }),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  });
}

function _horasTrabajadas(entrada, salida) {
  if (!salida) return '—';
  const ms = new Date(salida) - new Date(entrada);
  const horas = Math.floor(ms / 3600000);
  const minutos = Math.round((ms % 3600000) / 60000);
  return `${horas}h ${minutos}m`;
}

function _fechaHora(iso) {
  return new Date(iso).toLocaleString('es-BO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function VerificacionBadge({ v }) {
  const estilos = {
    ok: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400',
    fuera_de_rango: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
    sin_verificar: 'bg-muted text-muted-foreground',
  };
  const texto = { ok: 'Ubicación OK', fuera_de_rango: 'Fuera de rango', sin_verificar: 'Sin verificar' };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${estilos[v] || estilos.sin_verificar}`}>{texto[v] || 'Sin verificar'}</span>;
}

function AvisoCorreccion({ marcacion, onEnviado }) {
  const [hora, setHora] = useState('');
  const [nota, setNota] = useState('');
  const [error, setError] = useState(null);

  const proponer = useMutation({
    mutationFn: () => proponerHoraSalida(marcacion.id, {
      hora_salida_propuesta: `${marcacion.fecha}T${hora}:00-04:00`,
      nota_propuesta: nota || undefined,
    }),
    onSuccess: onEnviado,
    onError: (err) => setError(err?.response?.data?.mensaje ?? 'No se pudo enviar la corrección'),
  });

  return (
    <div className="rounded-2xl border border-amber-300 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-900/10 p-4 space-y-3">
      <div className="flex items-start gap-2">
        <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <p className="text-sm text-amber-800 dark:text-amber-300">
          No marcaste tu salida el <strong>{marcacion.fecha}</strong> — ¿a qué hora te fuiste?
        </p>
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <input type="time" value={hora} onChange={(e) => setHora(e.target.value)}
          className="px-3 py-2 text-sm rounded-xl border border-input bg-background text-foreground" />
        <input type="text" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Nota (opcional)"
          className="flex-1 px-3 py-2 text-sm rounded-xl border border-input bg-background text-foreground" />
        <button
          onClick={() => proponer.mutate()}
          disabled={!hora || proponer.isPending}
          className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
        >
          Enviar
        </button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

export default function MiAsistenciaPage() {
  const qc = useQueryClient();
  const [error, setError] = useState(null);

  const { data: estado, isLoading } = useQuery({
    queryKey: ['mi-estado-asistencia'],
    queryFn: getMiEstadoAsistencia,
  });

  const marcar = useMutation({
    mutationFn: async () => marcarAsistencia(await _obtenerUbicacion()),
    onSuccess: () => { setError(null); qc.invalidateQueries({ queryKey: ['mi-estado-asistencia'] }); },
    onError: (err) => setError(err?.response?.data?.mensaje ?? 'No se pudo registrar la marcación'),
  });

  const abierta = estado?.marcacion_abierta ?? null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
          <Clock className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">Mi Asistencia</h1>
          <p className="text-xs text-muted-foreground">Marcá tu entrada y salida del turno</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">Cargando...</div>
      ) : (
        <>
          {estado.correccion_pendiente && (
            <AvisoCorreccion
              marcacion={estado.correccion_pendiente}
              onEnviado={() => qc.invalidateQueries({ queryKey: ['mi-estado-asistencia'] })}
            />
          )}

          <div className="rounded-2xl border border-border bg-card p-6 flex flex-col items-center gap-4">
            {abierta ? (
              <>
                <p className="text-sm text-muted-foreground">Entraste a las {_fechaHora(abierta.hora_entrada)}</p>
                <VerificacionBadge v={abierta.verificacion_entrada} />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No tenés una entrada abierta ahora mismo</p>
            )}

            <button
              onClick={() => marcar.mutate()}
              disabled={marcar.isPending}
              className={`w-full sm:w-auto px-8 py-4 rounded-2xl text-white font-bold text-base flex items-center justify-center gap-2 transition-colors disabled:opacity-60 ${
                abierta ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'
              }`}
            >
              {abierta ? <LogOut className="w-5 h-5" /> : <LogIn className="w-5 h-5" />}
              {marcar.isPending ? 'Marcando...' : abierta ? 'Marcar salida' : 'Marcar entrada'}
            </button>
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="w-3.5 h-3.5" /> Usamos tu ubicación solo para verificar que estás en el local
            </p>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-sm font-bold text-foreground">Últimos 14 días</h2>
            </div>
            {estado.historial.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">Todavía no marcaste ninguna asistencia</p>
            ) : (
              <div className="divide-y divide-border">
                {estado.historial.map((m) => (
                  <div key={m.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                    <div>
                      <p className="font-medium text-foreground">{m.fecha}</p>
                      <p className="text-xs text-muted-foreground">
                        {_fechaHora(m.hora_entrada)} — {m.hora_salida ? _fechaHora(m.hora_salida) : 'en curso'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-muted-foreground">{_horasTrabajadas(m.hora_entrada, m.hora_salida)}</span>
                      {m.estado === 'cierre_automatico' && (
                        <span className="px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 text-xs font-medium">Cierre automático</span>
                      )}
                      <VerificacionBadge v={m.verificacion_entrada} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
