import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer, CheckCircle2, AlertTriangle } from 'lucide-react';
import { getEstadoAgentes } from '../../api/impresion';
import socket from '../../socket';

export default function EstadoAgentesImpresion() {
  const qc = useQueryClient();
  const { data: agentes = [], isLoading } = useQuery({
    queryKey: ['estado-agentes'],
    queryFn: getEstadoAgentes,
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

  if (isLoading || agentes.length === 0) return null;

  return (
    <div className="bg-card rounded-2xl border border-border p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <Printer className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-foreground">Agentes de impresión</h3>
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
              <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium shrink-0">
                <AlertTriangle className="w-3.5 h-3.5" /> Desconectado
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
