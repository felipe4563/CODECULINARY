import { ChefHat, X } from 'lucide-react';
import { useImpresionStore } from '../../store/impresionStore';
import { imprimirBluetoothCocina } from '../../utils/rawbt';

// Flota sobre cualquier pantalla mientras haya un ticket de cocina Bluetooth
// esperando a que alguien lo mande — ver store/impresionStore.js para el
// porqué de que no se dispare solo.
export default function BotonCocinaPendiente() {
  const cocinaPendiente = useImpresionStore((s) => s.cocinaPendiente);
  const limpiarCocinaPendiente = useImpresionStore((s) => s.limpiarCocinaPendiente);

  if (!cocinaPendiente) return null;

  const imprimir = () => {
    imprimirBluetoothCocina(cocinaPendiente);
    limpiarCocinaPendiente();
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 bg-card border border-border rounded-2xl shadow-lg p-2 pl-4 animate-in fade-in slide-in-from-bottom-2">
      <ChefHat className="w-4 h-4 text-primary shrink-0" />
      <span className="text-sm font-medium text-foreground">Ticket de cocina pendiente</span>
      <button
        onClick={imprimir}
        className="px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-sm font-semibold transition-colors"
      >
        Imprimir cocina
      </button>
      <button
        onClick={limpiarCocinaPendiente}
        title="Descartar"
        className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
