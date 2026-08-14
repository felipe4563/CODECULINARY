import { useParams, Navigate } from 'react-router-dom';
import { Building2, Grid3x3, AlertCircle, ChefHat, Store, Star, Cake, Disc3 } from 'lucide-react';
import { usePermisos } from '../../hooks/usePermisos';
import TabNegocio from './tabs/TabNegocio';
import TabAreas from './tabs/TabAreas';
import TabMesas from './tabs/TabMesas';
import TabFlujo from './tabs/TabFlujo';
import TabFidelidad from './tabs/TabFidelidad';
import TabCumpleanos from './tabs/TabCumpleanos';
import TabRuleta from './tabs/TabRuleta';

const TABS = [
  { id: 'negocio', label: 'Negocio',      descripcion: 'Datos generales, logo y colores de marca',  Icono: Store,    Comp: TabNegocio },
  { id: 'areas',   label: 'Áreas',        descripcion: 'Zonas del local donde se ubican las mesas', Icono: Building2, Comp: TabAreas },
  { id: 'mesas',   label: 'Mesas',        descripcion: 'Mesas por área y su capacidad',             Icono: Grid3x3,  Comp: TabMesas },
  { id: 'flujo',   label: 'Flujo Cocina', descripcion: 'Cómo se comunica la sala con la cocina',    Icono: ChefHat,  Comp: TabFlujo },
  { id: 'fidelidad', label: 'Fidelidad', descripcion: 'Puntos por compra y valor de canje para clientes', Icono: Star, Comp: TabFidelidad },
  { id: 'cumpleanos', label: 'Cumpleaños', descripcion: 'Cupón automático de cumpleaños para clientes', Icono: Cake, Comp: TabCumpleanos },
  { id: 'ruleta', label: 'Ruleta', descripcion: 'Costo en puntos y límites de giro de la ruleta de premios', Icono: Disc3, Comp: TabRuleta },
];

export default function ConfiguracionPage() {
  const { tienePermiso } = usePermisos();
  const puedeVer    = tienePermiso('configuracion', 'ver');
  const puedeEditar = tienePermiso('configuracion', 'editar');
  const { tab } = useParams();

  if (!puedeVer) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
        <AlertCircle className="w-10 h-10" />
        <p className="font-medium">No tienes permiso para ver la configuración</p>
      </div>
    );
  }

  const tabActual = TABS.find(t => t.id === tab);
  if (!tabActual) return <Navigate to="/configuracion/negocio" replace />;

  const TabActivo = tabActual.Comp;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <tabActual.Icono className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-foreground">{tabActual.label}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{tabActual.descripcion}</p>
        </div>
      </div>

      <TabActivo puedeEditar={puedeEditar} />
    </div>
  );
}
