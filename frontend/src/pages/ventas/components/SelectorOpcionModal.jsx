import { useState, useEffect } from 'react';
import Modal from '../../../components/ui/Modal';

export default function SelectorOpcionModal({ producto, onElegir, onClose }) {
  const grupos = producto.grupos_opciones ?? [];
  const [paso, setPaso] = useState(0);
  const [selecciones, setSelecciones] = useState({}); // { [grupoId]: string[] }
  const [multipleElegidas, setMultipleElegidas] = useState([]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMultipleElegidas([]);
  }, [paso]);

  const grupoActual = grupos[paso];
  const esUltimoPaso = paso === grupos.length - 1;

  function construirNotaFinal(seleccionesFinales) {
    const partes = grupos
      .map((g) => {
        const elegidas = seleccionesFinales[g.id] ?? [];
        if (elegidas.length === 0) return null;
        return `${g.nombre}: ${elegidas.join(', ')}`;
      })
      .filter(Boolean);
    if (partes.length === 0) return null;
    const texto = partes.join(' · ');
    return texto.length > 255 ? `${texto.slice(0, 252)}...` : texto;
  }

  function avanzar(seleccionesActualizadas) {
    if (esUltimoPaso) {
      onElegir(construirNotaFinal(seleccionesActualizadas));
    } else {
      setSelecciones(seleccionesActualizadas);
      setPaso((p) => p + 1);
    }
  }

  function elegirUnica(opcionNombre) {
    avanzar({ ...selecciones, [grupoActual.id]: [opcionNombre] });
  }

  function saltarPaso() {
    avanzar({ ...selecciones, [grupoActual.id]: [] });
  }

  function toggleMultiple(opcionNombre) {
    setMultipleElegidas((prev) =>
      prev.includes(opcionNombre) ? prev.filter((o) => o !== opcionNombre) : [...prev, opcionNombre]
    );
  }

  function confirmarMultiple() {
    avanzar({ ...selecciones, [grupoActual.id]: multipleElegidas });
  }

  return (
    <Modal titulo={`${producto.nombre} — ${grupoActual.nombre}`} onClose={onClose}>
      <div className="space-y-4">
        {grupos.length > 1 && (
          <p className="text-xs text-gray-400">Paso {paso + 1} de {grupos.length}</p>
        )}

        {grupoActual.tipo_seleccion === 'multiple' ? (
          <>
            <div className="flex flex-wrap gap-2">
              {grupoActual.opciones.map((opcion) => (
                <button
                  key={opcion.id}
                  type="button"
                  onClick={() => toggleMultiple(opcion.nombre)}
                  className={`px-4 py-2 rounded-full text-sm font-semibold border transition-all ${
                    multipleElegidas.includes(opcion.nombre)
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-blue-400 dark:hover:border-blue-500'
                  }`}
                >
                  {opcion.nombre}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={confirmarMultiple}
              disabled={grupoActual.obligatorio && multipleElegidas.length === 0}
              className="w-full px-4 py-2 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {esUltimoPaso ? 'Agregar' : 'Continuar'}
            </button>
          </>
        ) : (
          <div className="flex flex-wrap gap-2">
            {grupoActual.opciones.map((opcion) => (
              <button
                key={opcion.id}
                type="button"
                onClick={() => elegirUnica(opcion.nombre)}
                className="px-4 py-2 rounded-full text-sm font-semibold bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-blue-400 dark:hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400 transition-all"
              >
                {opcion.nombre}
              </button>
            ))}
          </div>
        )}

        {!grupoActual.obligatorio && (
          <button
            type="button"
            onClick={saltarPaso}
            className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            Saltar este paso
          </button>
        )}
      </div>
    </Modal>
  );
}
