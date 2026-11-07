import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react';
import { getEstadoAgentes } from '../../api/impresion';
import { reconectarAgenteLocal } from '../../utils/impresionLocal';
import socket from '../../socket';

// El botón le habla al agente instalado en ESTA PC (127.0.0.1), no a uno
// remoto: un navegador no puede llegar al agente de otra computadora ni
// arrancar un programa cerrado, así que si no responde solo se puede avisar.
const MENSAJES = {
  reconectado: { tono: 'ok', texto: 'Agente reconectado.' },
  agente_viejo: { tono: 'aviso', texto: 'El agente de esta PC es una versión anterior sin esta opción. Reinstálalo para poder reconectarlo desde aquí.' },
  sin_agente: { tono: 'aviso', texto: 'No hay un agente de impresión funcionando en esta PC. Ábrelo desde su acceso directo o reinicia la PC (arranca solo al iniciar).' },
};

// "hace 5 min", "hace 3 h", "hace 2 días". El backend manda desde cuándo
// está caída cada caja; con desde_inicio_servidor solo sabe que es "al
// menos" desde que arrancó (se reinició y ese agente nunca volvió), de ahí
// el "más de".
function duracion(iso, ahora) {
  const min = Math.max(0, Math.floor((ahora - new Date(iso).getTime()) / 60_000));
  if (min < 1) return null;
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} ${d === 1 ? 'día' : 'días'}`;
}

function textoDesconexion(agente, ahora) {
  if (!agente.desconectado_desde) return 'Desconectado';
  const dur = duracion(agente.desconectado_desde, ahora);
  if (!dur) return 'Desconectado hace un momento';
  return `Desconectado hace ${agente.desde_inicio_servidor ? 'más de ' : ''}${dur}`;
}

function mensajeDe(resultado) {
  if (resultado.estado === 'sin_servidor') {
    return { tono: 'aviso', texto: `El agente está abierto pero no logra conectarse al servidor${resultado.error ? ` (${resultado.error})` : ''}. Revisa la conexión a Internet de esta PC.` };
  }
  return MENSAJES[resultado.estado];
}

export default function EstadoAgentesImpresion() {
  const qc = useQueryClient();
  const [reconectando, setReconectando] = useState(false);
  const [mensaje, setMensaje] = useState(null);
  // Re-render cada minuto para que el "hace X" avance sin esperar al refetch.
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const { data: agentes = [], isLoading } = useQuery({
    queryKey: ['estado-agentes'],
    queryFn: () => getEstadoAgentes(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  useEffect(() => {
    function onEstado() {
      qc.invalidateQueries({ queryKey: ['estado-agentes'] });
    }
    socket.on('agente:estado', onEstado);
    return () => socket.off('agente:estado', onEstado);
  }, [qc]);

  async function reconectar() {
    setReconectando(true);
    setMensaje(null);
    const resultado = await reconectarAgenteLocal();
    setMensaje(mensajeDe(resultado));
    qc.invalidateQueries({ queryKey: ['estado-agentes'] });
    setReconectando(false);
  }

  if (isLoading || agentes.length === 0) return null;

  const hayDesconectados = agentes.some((a) => !a.conectado);

  return (
    <div className="bg-card rounded-2xl border border-border p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Printer className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Agentes de impresión</h3>
        </div>
        {hayDesconectados && (
          <button
            type="button"
            onClick={reconectar}
            disabled={reconectando}
            className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg border border-border hover:bg-muted disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${reconectando ? 'animate-spin' : ''}`} />
            {reconectando ? 'Reconectando…' : 'Reconectar agente de esta PC'}
          </button>
        )}
      </div>
      <div className="space-y-1.5">
        {agentes.map((a) => (
          <div key={a.caja_id} className="flex items-center justify-between text-xs gap-2">
            <span className="text-muted-foreground truncate">
              {a.sucursal_nombre ? `${a.sucursal_nombre} — ` : ''}{a.caja_nombre}
            </span>
            {a.conectado ? (
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium shrink-0">
                <CheckCircle2 className="w-3.5 h-3.5" /> Conectado
              </span>
            ) : (
              <span
                className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium shrink-0"
                title={a.desconectado_desde ? `Sin conexión desde ${new Date(a.desconectado_desde).toLocaleString('es-BO')}` : undefined}
              >
                <AlertTriangle className="w-3.5 h-3.5" /> {textoDesconexion(a, ahora)}
              </span>
            )}
          </div>
        ))}
      </div>
      {mensaje && (
        <p className={`mt-3 text-xs ${mensaje.tono === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
          {mensaje.texto}
        </p>
      )}
    </div>
  );
}
