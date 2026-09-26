import { useState } from 'react';
import { UserCheck, CalendarClock, ClipboardList } from 'lucide-react';
import { usePermisos } from '../../hooks/usePermisos';
import TabHorarios from './tabs/TabHorarios';
import TabRegistros from './tabs/TabRegistros';

const TABS = [
  { id: 'horarios', label: 'Horarios', Icono: CalendarClock, Comp: TabHorarios },
  { id: 'registros', label: 'Registros', Icono: ClipboardList, Comp: TabRegistros },
];

export default function ControlPersonalPage() {
  const { tienePermiso } = usePermisos();
  const [tab, setTab] = useState('horarios');

  if (!tienePermiso('personal', 'administrar')) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
        <UserCheck className="w-10 h-10" />
        <p className="font-medium">No tenés permiso para ver esta pantalla</p>
      </div>
    );
  }

  const tabActivo = TABS.find(t => t.id === tab) || TABS[0];
  const TabActivo = tabActivo.Comp;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-primary/10 rounded-xl shrink-0">
          <UserCheck className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-foreground">Control de Personal</h1>
          <p className="text-xs text-muted-foreground">Horarios semanales y registros de asistencia</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map(({ id, label, Icono }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors border ${
              tab === id
                ? 'bg-primary text-primary-foreground border-primary shadow-sm shadow-primary/20'
                : 'bg-card text-muted-foreground border-border hover:text-foreground hover:bg-muted/50'
            }`}>
            <Icono className="w-4 h-4 shrink-0" />
            {label}
          </button>
        ))}
      </div>

      <div className="bg-card rounded-2xl border border-border shadow-sm p-3 sm:p-6">
        <TabActivo />
      </div>
    </div>
  );
}
