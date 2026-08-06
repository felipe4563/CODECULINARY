import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Ticket, X } from 'lucide-react';
import { validarCupon, getCuponesDisponibles } from '../../../api/cupones';

function etiquetaValor(c) {
  return c.tipo === 'porcentaje' ? `${parseFloat(c.valor)}%` : `Bs ${parseFloat(c.valor).toFixed(2)}`;
}

// Input de código de cupón para el checkout. `subtotal` es la base sobre la
// que se calcula el descuento (antes de aplicarlo); `onAplicar`/`onQuitar`
// viven en el padre porque necesita el descuento en Bs para recalcular el
// total. La validación acá es solo una previsualización — el servidor
// vuelve a validar y recién ahí marca el cupón como usado, al cobrar.
//
// Si el cliente tiene cupones exclusivos asignados a él, se listan para
// elegir en vez de tener que dictar/tipear el código — los cupones públicos
// (promociones abiertas) siguen ingresándose a mano en el campo de texto.
export default function CuponInput({ subtotal, cupon, onAplicar, onQuitar, clienteId, items }) {
  const [codigo, setCodigo] = useState('');
  const [error, setError] = useState(null);

  const { data: disponibles = [] } = useQuery({
    queryKey: ['cupones-disponibles', clienteId],
    queryFn: () => getCuponesDisponibles(clienteId),
    enabled: !!clienteId && !cupon,
  });

  const aplicar = useMutation({
    mutationFn: (codigoParam) => validarCupon(codigoParam, subtotal, clienteId, items),
    onSuccess: (datos) => {
      onAplicar(datos.codigo, datos.descuento);
      setCodigo('');
      setError(null);
    },
    onError: (err) => setError(err?.response?.data?.mensaje ?? 'Cupón inválido'),
  });

  if (cupon) {
    return (
      <div className="flex items-center justify-between gap-2 bg-muted/50 border border-border rounded-xl p-3">
        <div className="flex items-center gap-2 min-w-0">
          <Ticket className="w-4 h-4 text-primary shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground font-mono truncate">{cupon.codigo}</p>
            <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">-Bs {cupon.descuento.toFixed(2)}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onQuitar}
          className="p-1 rounded-lg text-muted-foreground hover:text-destructive transition-colors shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {disponibles.length > 0 && (
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <Ticket className="w-3.5 h-3.5" /> Cupones de este cliente
          </label>
          <div className="flex flex-col gap-1.5">
            {disponibles.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => aplicar.mutate(c.codigo)}
                disabled={aplicar.isPending}
                className="flex items-center justify-between gap-2 bg-muted/50 hover:bg-muted border border-border rounded-xl px-3 py-2 text-left transition-colors disabled:opacity-60"
              >
                <span className="text-sm font-mono font-semibold text-foreground truncate">{c.codigo}</span>
                <span className="text-xs text-primary font-medium shrink-0">{etiquetaValor(c)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <Ticket className="w-3.5 h-3.5" />
          {disponibles.length > 0 ? '¿Tiene otro código?' : 'Cupón de descuento (opcional)'}
        </label>
        <div className="flex gap-2">
          <input
            value={codigo}
            onChange={(e) => { setCodigo(e.target.value.toUpperCase()); setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && codigo.trim()) { e.preventDefault(); aplicar.mutate(codigo.trim()); } }}
            placeholder="PROMO10"
            className="flex-1 bg-background border border-input rounded-xl px-3 py-2 text-sm text-foreground font-mono placeholder:font-sans placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
          />
          <button
            type="button"
            onClick={() => aplicar.mutate(codigo.trim())}
            disabled={!codigo.trim() || aplicar.isPending}
            className="shrink-0 px-4 py-2 rounded-xl text-sm font-medium bg-primary hover:bg-primary/90 text-primary-foreground transition-colors disabled:opacity-60"
          >
            {aplicar.isPending ? 'Validando...' : 'Aplicar'}
          </button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}
