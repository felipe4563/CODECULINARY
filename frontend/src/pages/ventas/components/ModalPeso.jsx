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
        <p className="text-sm text-gray-500 dark:text-gray-400">Precio por kg: Bs {precioKg.toFixed(2)}</p>

        <div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
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
            className="w-full bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
          />
        </div>

        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4 text-center">
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Precio calculado</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">
            {precioCalculado !== null ? `Bs ${precioCalculado.toFixed(2)}` : '—'}
          </p>
        </div>

        <div className="flex justify-end gap-3 pt-1">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            Cancelar
          </button>
          <button
            onClick={confirmar}
            disabled={!pesoValido}
            className="px-5 py-2 rounded-xl text-sm bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-colors disabled:opacity-60"
          >
            {textoConfirmar}
          </button>
        </div>
      </div>
    </Modal>
  );
}
