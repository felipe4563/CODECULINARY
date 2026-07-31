import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import Modal from '../../../components/ui/Modal';
import TarjetaMesa from './TarjetaMesa';

const LEYENDA = [
  { estado: 'disponible', label: 'Disponible', punto: 'bg-green-500' },
  { estado: 'ocupada', label: 'Ocupada', punto: 'bg-red-500' },
  { estado: 'reservada', label: 'Reservada', punto: 'bg-amber-500' },
];

export default function ModalMesas({ mesas, pedidoPorMesa, mesaSeleccionada, onSeleccionar, onClose }) {
  const [areaActiva, setAreaActiva] = useState('todas');
  const [busqueda, setBusqueda] = useState('');

  const areas = useMemo(() => {
    const nombres = new Set(mesas.map((m) => m.area?.nombre ?? 'Sin área'));
    return Array.from(nombres);
  }, [mesas]);

  const mesasFiltradas = mesas.filter((mesa) => {
    const area = mesa.area?.nombre ?? 'Sin área';
    if (areaActiva !== 'todas' && area !== areaActiva) return false;
    if (busqueda.trim() && !mesa.nombre.toLowerCase().includes(busqueda.trim().toLowerCase())) return false;
    return true;
  });

  function elegir(mesa) {
    if (mesa.estado !== 'disponible') return;
    onSeleccionar(mesa);
    onClose();
  }

  return (
    <Modal titulo="Elegir mesa" onClose={onClose} ancho="max-w-3xl">
      <div className="flex flex-col gap-3 -mt-1">
        {/* Buscador + leyenda */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar mesa..."
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-input bg-muted text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex items-center gap-3 shrink-0 pl-1">
            {LEYENDA.map((l) => (
              <span key={l.estado} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={`w-2 h-2 rounded-full ${l.punto}`} />
                {l.label}
              </span>
            ))}
          </div>
        </div>

        {/* Chips de área */}
        {areas.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            <button
              onClick={() => setAreaActiva('todas')}
              className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                areaActiva === 'todas' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              }`}
            >
              Todas ({mesas.length})
            </button>
            {areas.map((area) => (
              <button
                key={area}
                onClick={() => setAreaActiva(area)}
                className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                  areaActiva === area ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                }`}
              >
                {area} ({mesas.filter((m) => (m.area?.nombre ?? 'Sin área') === area).length})
              </button>
            ))}
          </div>
        )}

        {/* Grid de mesas */}
        {mesasFiltradas.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-muted-foreground">
            <p className="text-sm">No se encontraron mesas</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-[55vh] overflow-y-auto pr-1 -mr-1">
            {mesasFiltradas.map((mesa) => (
              <TarjetaMesa
                key={mesa.id}
                mesa={mesa}
                pedido={pedidoPorMesa[mesa.id]}
                seleccionada={mesaSeleccionada === mesa.id}
                clickable={mesa.estado === 'disponible'}
                onClick={() => elegir(mesa)}
              />
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
