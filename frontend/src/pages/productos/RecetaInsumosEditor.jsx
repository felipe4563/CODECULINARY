import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getInsumos } from '../../api/insumos';
import { getRecetaProducto, guardarRecetaProducto } from '../../api/insumos';
import { Wheat, Plus, X } from 'lucide-react';

const BASE = '__base__';

// Qué insumo(s) descuenta este producto al venderse. Una línea sin opción
// (BASE) se descuenta siempre; una línea atada a una opción específica solo
// se descuenta si el cliente eligió esa opción — ver
// docs/superpowers/specs/2026-08-08-insumos-recetas-design.md.
export default function RecetaInsumosEditor({ productoId, gruposAsociados, gruposOpcionesCompletos }) {
  const qc = useQueryClient();
  const [lineas, setLineas] = useState(null); // null = todavía no cargado
  const [toast, setToast] = useState('');

  const { data: insumos = [] } = useQuery({ queryKey: ['insumos'], queryFn: getInsumos });
  const { data: receta } = useQuery({
    queryKey: ['receta-producto', productoId],
    queryFn: () => getRecetaProducto(productoId),
    enabled: !!productoId,
  });

  useEffect(() => {
    if (receta && lineas === null) {
      setLineas(receta.map(r => ({ insumo_id: r.insumo_id, opcion_id: r.opcion_id, cantidad: r.cantidad })));
    }
  }, [receta, lineas]);

  const opcionesDisponibles = gruposAsociados
    .map(ga => gruposOpcionesCompletos.find(g => g.id === ga.id))
    .filter(Boolean)
    .flatMap(g => (g.opciones ?? []).map(o => ({ ...o, grupoNombre: g.nombre })));

  const mutGuardar = useMutation({
    mutationFn: () => guardarRecetaProducto(productoId, (lineas ?? []).filter(l => l.insumo_id && l.cantidad > 0).map(l => ({
      insumo_id: Number(l.insumo_id), opcion_id: l.opcion_id ? Number(l.opcion_id) : null, cantidad: Number(l.cantidad),
    }))),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['receta-producto', productoId] });
      setToast('Receta guardada');
      setTimeout(() => setToast(''), 2500);
    },
    onError: (err) => {
      setToast(err?.response?.data?.mensaje ?? 'Error al guardar la receta');
      setTimeout(() => setToast(''), 3000);
    },
  });

  if (!productoId) {
    return (
      <div className="border-t border-border pt-4">
        <p className="text-xs text-muted-foreground italic">Guardá el producto primero para poder configurar su receta de insumos.</p>
      </div>
    );
  }

  const lista = lineas ?? [];

  function agregarLinea() {
    setLineas([...(lineas ?? []), { insumo_id: '', opcion_id: null, cantidad: '' }]);
  }
  function quitarLinea(i) {
    setLineas(lista.filter((_, idx) => idx !== i));
  }
  function actualizarLinea(i, campo, valor) {
    setLineas(lista.map((l, idx) => idx === i ? { ...l, [campo]: valor } : l));
  }

  return (
    <div className="border-t border-border pt-4 space-y-3">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          <Wheat className="w-3.5 h-3.5" /> Receta (consumo de insumos)
        </label>
        <button type="button" onClick={agregarLinea} className="text-xs text-primary font-medium hover:underline flex items-center gap-1">
          <Plus className="w-3.5 h-3.5" /> Agregar
        </button>
      </div>

      {lista.length === 0 && (
        <p className="text-xs text-muted-foreground">Sin receta configurada: este producto no descuenta ningún insumo al venderse.</p>
      )}

      <div className="space-y-2">
        {lista.map((l, i) => (
          <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto_auto] gap-2 items-center bg-muted rounded-xl px-3 py-2">
            <select
              value={l.insumo_id}
              onChange={e => actualizarLinea(i, 'insumo_id', e.target.value)}
              className="w-full min-w-0 bg-background border border-input rounded-lg px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Insumo...</option>
              {insumos.map(ins => <option key={ins.id} value={ins.id}>{ins.nombre} ({ins.unidad_medida})</option>)}
            </select>

            <select
              value={l.opcion_id ?? BASE}
              onChange={e => actualizarLinea(i, 'opcion_id', e.target.value === BASE ? null : e.target.value)}
              className="w-full min-w-0 bg-background border border-input rounded-lg px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value={BASE}>Base (siempre)</option>
              {opcionesDisponibles.map(o => (
                <option key={o.id} value={o.id}>{o.grupoNombre}: {o.nombre}</option>
              ))}
            </select>

            <input
              type="number" step="0.001" min="0"
              value={l.cantidad}
              onChange={e => actualizarLinea(i, 'cantidad', e.target.value)}
              placeholder="Cantidad"
              className="w-full sm:w-24 min-w-0 bg-background border border-input rounded-lg px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />

            <button type="button" onClick={() => quitarLinea(i)} className="justify-self-end sm:justify-self-auto p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => mutGuardar.mutate()}
          disabled={mutGuardar.isPending}
          className="px-3 py-1.5 rounded-lg bg-secondary hover:bg-secondary/80 text-secondary-foreground text-xs font-semibold transition-colors disabled:opacity-60"
        >
          {mutGuardar.isPending ? 'Guardando...' : 'Guardar receta'}
        </button>
        {toast && <span className="text-xs text-muted-foreground">{toast}</span>}
      </div>
    </div>
  );
}
