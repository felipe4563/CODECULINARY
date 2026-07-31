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
          <p className="text-xs text-muted-foreground">Paso {paso + 1} de {grupos.length}</p>
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
                      ? 'bg-primary border-primary text-primary-foreground'
                      : 'bg-card border-border text-muted-foreground hover:border-primary/50'
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
              className="w-full px-4 py-2 rounded-xl text-sm font-semibold bg-primary hover:bg-primary/90 text-primary-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
                className="px-4 py-2 rounded-full text-sm font-semibold bg-card border border-border text-muted-foreground hover:border-primary/50 hover:text-foreground transition-all"
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
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Saltar este paso
          </button>
        )}
      </div>
    </Modal>
  );
}
