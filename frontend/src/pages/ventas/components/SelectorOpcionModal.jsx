import { useState, useEffect } from 'react';
import Modal from '../../../components/ui/Modal';

function etiquetaOpcion(opcion) {
  return opcion.precio_adicional > 0
    ? `${opcion.nombre} (+Bs ${opcion.precio_adicional.toFixed(2)})`
    : opcion.nombre;
}

export default function SelectorOpcionModal({ producto, onElegir, onClose }) {
  const grupos = producto.grupos_opciones ?? [];
  const [paso, setPaso] = useState(0);
  const [selecciones, setSelecciones] = useState({}); // { [grupoId]: opcion[] }
  const [multipleElegidas, setMultipleElegidas] = useState([]); // opcion[]

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMultipleElegidas([]);
  }, [paso]);

  const grupoActual = grupos[paso];
  const esUltimoPaso = paso === grupos.length - 1;

  function construirResultado(seleccionesFinales) {
    const partes = grupos
      .map((g) => {
        const elegidas = seleccionesFinales[g.id] ?? [];
        if (elegidas.length === 0) return null;
        return `${g.nombre}: ${elegidas.map(etiquetaOpcion).join(', ')}`;
      })
      .filter(Boolean);
    const nota = partes.length === 0 ? null : (() => {
      const texto = partes.join(' · ');
      return texto.length > 255 ? `${texto.slice(0, 252)}...` : texto;
    })();

    const todasElegidas = Object.values(seleccionesFinales).flat();
    const opcionIds = todasElegidas.map((o) => o.id);
    const extra = todasElegidas.reduce((sum, o) => sum + (o.precio_adicional || 0), 0);

    return { nota, opcionIds, extra };
  }

  function avanzar(seleccionesActualizadas) {
    if (esUltimoPaso) {
      onElegir(construirResultado(seleccionesActualizadas));
    } else {
      setSelecciones(seleccionesActualizadas);
      setPaso((p) => p + 1);
    }
  }

  function elegirUnica(opcion) {
    avanzar({ ...selecciones, [grupoActual.id]: [opcion] });
  }

  function saltarPaso() {
    avanzar({ ...selecciones, [grupoActual.id]: [] });
  }

  function toggleMultiple(opcion) {
    setMultipleElegidas((prev) =>
      prev.some((o) => o.id === opcion.id) ? prev.filter((o) => o.id !== opcion.id) : [...prev, opcion]
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
                  onClick={() => toggleMultiple(opcion)}
                  className={`px-4 py-2 rounded-full text-sm font-semibold border transition-all ${
                    multipleElegidas.some((o) => o.id === opcion.id)
                      ? 'bg-primary border-primary text-primary-foreground'
                      : 'bg-card border-border text-muted-foreground hover:border-primary/50'
                  }`}
                >
                  {etiquetaOpcion(opcion)}
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
                onClick={() => elegirUnica(opcion)}
                className="px-4 py-2 rounded-full text-sm font-semibold bg-card border border-border text-muted-foreground hover:border-primary/50 hover:text-foreground transition-all"
              >
                {etiquetaOpcion(opcion)}
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
