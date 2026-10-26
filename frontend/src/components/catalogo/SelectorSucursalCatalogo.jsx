import { useQuery } from '@tanstack/react-query';
import { getSucursales } from '../../api/sucursales';
import { useSucursalCatalogo } from '../../store/catalogoSucursalStore';

// Selector de sucursal del catálogo; solo lo ven los usuarios con acceso a todas.
export default function SelectorSucursalCatalogo() {
  const { sucursalId, esGlobal, setSucursalId } = useSucursalCatalogo();
  const { data: sucursales = [] } = useQuery({
    queryKey: ['sucursales'],
    queryFn: getSucursales,
    enabled: esGlobal,
  });

  if (!esGlobal) return null;

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="catalogo-sucursal" className="text-sm text-muted-foreground">Sucursal</label>
      <select
        id="catalogo-sucursal"
        value={sucursalId ?? ''}
        onChange={e => setSucursalId(parseInt(e.target.value))}
        className="bg-background border border-input rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      >
        {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
      </select>
    </div>
  );
}
