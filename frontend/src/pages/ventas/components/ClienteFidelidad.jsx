import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, X, Star } from 'lucide-react';
import { getClientes } from '../../../api/clientes';
import { getConfiguracion } from '../../../api/configuracion';

// Selector de cliente + canje de puntos, para usar dentro del modal de
// cobro. Si el programa de fidelidad está apagado en Configuración, no
// renderiza nada. `puntosCanjear` y `onCambiarPuntos` viven en el padre
// porque el padre necesita el descuento en Bs para recalcular el total.
export default function ClienteFidelidad({ cliente, onCambiarCliente, puntosCanjear, onCambiarPuntos, metodoPago = 'efectivo' }) {
  const [busqueda, setBusqueda] = useState('');
  const [buscando, setBuscando] = useState(false);

  const { data: config = {} } = useQuery({ queryKey: ['configuracion'], queryFn: getConfiguracion, staleTime: 60_000 });
  const fidelidadActiva = config.fidelidad_activa === 'true';
  const valorPunto = parseFloat(config.valor_punto_bs || 0);
  const canjePermitido = metodoPago === 'qr'
    ? config.fidelidad_canje_qr === 'true'
    : config.fidelidad_canje_efectivo !== 'false';

  const { data: resultados = [] } = useQuery({
    queryKey: ['clientes-buscar', busqueda],
    queryFn: () => getClientes({ buscar: busqueda }),
    enabled: buscando && busqueda.trim().length >= 2,
  });

  if (!fidelidadActiva) return null;

  if (!cliente) {
    return (
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <Star className="w-3.5 h-3.5" /> Cliente (opcional, para sumar puntos)
        </label>
        <div className="relative">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={busqueda}
            onChange={(e) => { setBusqueda(e.target.value); setBuscando(true); }}
            onFocus={() => setBuscando(true)}
            placeholder="Buscar por nombre o documento..."
            className="w-full bg-background border border-input rounded-xl pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
          />
        </div>
        {buscando && busqueda.trim().length >= 2 && (
          <div className="border border-border rounded-xl overflow-hidden max-h-40 overflow-y-auto">
            {resultados.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">Sin resultados</p>
            ) : resultados.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => { onCambiarCliente(c); setBuscando(false); setBusqueda(''); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center justify-between gap-2"
              >
                <span className="truncate text-foreground">{c.nombre}</span>
                <span className="text-xs text-muted-foreground shrink-0">{c.puntos} pts</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2 bg-muted/50 border border-border rounded-xl p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex items-center gap-2">
          <Star className="w-4 h-4 text-primary shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{cliente.nombre}</p>
            <p className="text-xs text-muted-foreground">{cliente.puntos} puntos disponibles</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => { onCambiarCliente(null); onCambiarPuntos(0, 0); }}
          className="p-1 rounded-lg text-muted-foreground hover:text-destructive transition-colors shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {cliente.puntos > 0 && valorPunto > 0 && (
        canjePermitido ? (
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground shrink-0">Canjear puntos</label>
            <input
              type="number" min="0" max={cliente.puntos}
              value={puntosCanjear}
              onChange={(e) => {
                const v = Math.max(0, Math.min(cliente.puntos, parseInt(e.target.value, 10) || 0));
                onCambiarPuntos(v, v * valorPunto);
              }}
              className="w-20 bg-background border border-input rounded-lg px-2 py-1 text-sm text-foreground text-center focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {puntosCanjear > 0 && (
              <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">-Bs {(puntosCanjear * valorPunto).toFixed(2)}</span>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic">
            El canje de puntos no está habilitado para {metodoPago === 'qr' ? 'pagos por QR' : 'pago en efectivo'}.
          </p>
        )
      )}
    </div>
  );
}
