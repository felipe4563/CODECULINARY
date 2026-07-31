import { useState } from 'react';
import Modal from '../../../components/ui/Modal';
import { calcularPrecioPesable } from '../../../utils/precio';

export default function ModalPeso({ producto, pesoInicial, onConfirmar, onClose, textoConfirmar = 'Agregar' }) {
  const [peso, setPeso] = useState(pesoInicial != null ? String(pesoInicial) : '');

  const pesoNum = parseFloat(peso);
  const pesoValido = pesoNum > 0;
  const precioKg = parseFloat(producto.precio);
  const precioCalculado = pesoValido ? calcularPrecioPesable(pesoNum, precioKg) : null;

  function confirmar() {
    if (!pesoValido) return;
    onConfirmar(pesoNum);
  }

  return (
    <Modal titulo={`${producto.nombre} — por peso`} onClose={onClose} ancho="max-w-sm">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Precio por kg: Bs {precioKg.toFixed(2)}</p>

        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
            Peso (kg) *
          </label>
          <input
            autoFocus
            type="number"
            min="0.001"
            step="0.001"
            value={peso}
            onChange={(e) => setPeso(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') confirmar(); }}
            placeholder="0.000"
            className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
          />
        </div>

        <div className="bg-muted rounded-xl p-4 text-center">
          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Precio calculado</p>
          <p className="text-2xl font-bold text-foreground">
            {precioCalculado !== null ? `Bs ${precioCalculado.toFixed(2)}` : '—'}
          </p>
        </div>

        <div className="flex justify-end gap-3 pt-1">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors">
            Cancelar
          </button>
          <button
            onClick={confirmar}
            disabled={!pesoValido}
            className="px-5 py-2 rounded-xl text-sm bg-primary hover:bg-primary/90 text-primary-foreground font-semibold transition-colors disabled:opacity-60"
          >
            {textoConfirmar}
          </button>
        </div>
      </div>
    </Modal>
  );
}
