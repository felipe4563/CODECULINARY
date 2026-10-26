import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSucursales } from '../../api/sucursales';
import { getCategorias } from '../../api/categorias';
import { getProductos, copiarCatalogo } from '../../api/productos';
import { getCombosActivos } from '../../api/combos';
import Modal from '../../components/ui/Modal';

const NOMBRES_CREADOS = {
  categorias: 'Categorías',
  grupos_opciones: 'Grupos de opciones',
  productos: 'Productos',
  combos: 'Combos',
};

const alternar = (lista, id) => (lista.includes(id) ? lista.filter(x => x !== id) : [...lista, id]);

// Copia categorías, productos y combos de otra sucursal hacia la sucursal elegida (destino).
export default function CopiarCatalogoModal({ destinoId, onClose }) {
  const qc = useQueryClient();
  const [origenId, setOrigenId] = useState('');
  const [categoriaIds, setCategoriaIds] = useState([]);
  const [productoIds, setProductoIds] = useState([]);
  const [comboIds, setComboIds] = useState([]);

  const { data: sucursales = [] } = useQuery({ queryKey: ['sucursales'], queryFn: getSucursales });
  const destino = sucursales.find(s => s.id === destinoId);
  const origenes = sucursales.filter(s => s.id !== destinoId);
  const origen = origenId ? parseInt(origenId) : null;

  const { data: categorias = [], isLoading: cargandoCat } = useQuery({
    queryKey: ['copiar-categorias', origen],
    queryFn: () => getCategorias({ sucursal_id: origen }),
    enabled: origen != null,
  });
  const { data: productos = [], isLoading: cargandoProd } = useQuery({
    queryKey: ['copiar-productos', origen],
    queryFn: () => getProductos({ sucursal_id: origen }),
    enabled: origen != null,
  });
  const { data: combos = [], isLoading: cargandoCombos } = useQuery({
    queryKey: ['copiar-combos', origen],
    queryFn: () => getCombosActivos({ sucursal_id: origen }),
    enabled: origen != null,
  });

  const copiar = useMutation({
    mutationFn: () => copiarCatalogo({
      origen_id: origen,
      destino_id: destinoId,
      categoria_ids: categoriaIds,
      producto_ids: productoIds,
      combo_ids: comboIds,
    }),
    onSuccess: () => {
      ['categorias', 'productos', 'grupos-opciones', 'combos', 'productos-catalogo']
        .forEach(k => qc.invalidateQueries({ queryKey: [k] }));
    },
  });

  function cambiarOrigen(valor) {
    setOrigenId(valor);
    setCategoriaIds([]);
    setProductoIds([]);
    setComboIds([]);
    copiar.reset();
  }

  const resultado = copiar.data;
  const hayEleccion = categoriaIds.length + productoIds.length + comboIds.length > 0;
  const cargando = cargandoCat || cargandoProd || cargandoCombos;
  const productosActivos = productos.filter(p => p.activo);

  if (resultado) {
    const { creados = {}, omitidos = [] } = resultado;
    return (
      <Modal titulo="Copia terminada" onClose={onClose} ancho="max-w-lg">
        <div className="space-y-4">
          <ul className="text-sm text-foreground space-y-1">
            {Object.entries(NOMBRES_CREADOS).map(([clave, etiqueta]) => (
              <li key={clave} className="flex justify-between">
                <span>{etiqueta} creados</span>
                <span className="font-semibold">{creados[clave] ?? 0}</span>
              </li>
            ))}
          </ul>
          {omitidos.length > 0 && (
            <div>
              <p className="text-sm font-medium text-foreground mb-1">Omitidos ({omitidos.length})</p>
              <ul className="border border-border rounded-xl max-h-48 overflow-y-auto divide-y divide-border text-sm">
                {omitidos.map((o, i) => (
                  <li key={i} className="px-3 py-2">
                    <span className="text-xs text-muted-foreground uppercase">{o.tipo}</span>{' '}
                    <span className="font-medium text-foreground">{o.nombre}</span>
                    <p className="text-xs text-muted-foreground">{o.motivo}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex justify-end">
            <button onClick={onClose} className="px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-sm font-medium transition-colors">
              Cerrar
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal titulo="Copiar desde otra sucursal" onClose={onClose} ancho="max-w-lg">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Destino: <span className="font-medium text-foreground">{destino?.nombre ?? '...'}</span>
        </p>

        <div>
          <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">Copiar desde</label>
          <select
            value={origenId}
            onChange={e => cambiarOrigen(e.target.value)}
            className="w-full bg-background border border-input rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">Seleccionar sucursal...</option>
            {origenes.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </div>

        {origen != null && cargando && <p className="text-sm text-muted-foreground">Cargando...</p>}

        {origen != null && !cargando && (
          <div className="border border-border rounded-xl max-h-72 overflow-y-auto divide-y divide-border">
            {categorias.map(cat => {
              const prods = productosActivos.filter(p => p.categoria_id === cat.id);
              const catMarcada = categoriaIds.includes(cat.id);
              return (
                <div key={cat.id} className="px-3 py-2">
                  <label className="flex items-center gap-2.5 text-sm font-semibold text-foreground cursor-pointer">
                    <input type="checkbox" checked={catMarcada} onChange={() => setCategoriaIds(alternar(categoriaIds, cat.id))} className="rounded border-input" />
                    {cat.nombre}
                  </label>
                  {prods.map(p => (
                    <label key={p.id} className="flex items-center gap-2.5 text-sm text-foreground cursor-pointer pl-6 pt-1">
                      <input
                        type="checkbox"
                        checked={catMarcada || productoIds.includes(p.id)}
                        disabled={catMarcada}
                        onChange={() => setProductoIds(alternar(productoIds, p.id))}
                        className="rounded border-input"
                      />
                      <span className="truncate">{p.nombre}</span>
                    </label>
                  ))}
                </div>
              );
            })}
            {combos.length > 0 && (
              <div className="px-3 py-2">
                <p className="text-sm font-semibold text-foreground">Combos</p>
                {combos.map(c => (
                  <label key={c.id} className="flex items-center gap-2.5 text-sm text-foreground cursor-pointer pl-6 pt-1">
                    <input type="checkbox" checked={comboIds.includes(c.id)} onChange={() => setComboIds(alternar(comboIds, c.id))} className="rounded border-input" />
                    <span className="truncate">{c.nombre}</span>
                  </label>
                ))}
              </div>
            )}
            {categorias.length === 0 && combos.length === 0 && (
              <p className="px-3 py-4 text-sm text-muted-foreground text-center">Esta sucursal no tiene catálogo.</p>
            )}
          </div>
        )}

        {copiar.isError && (
          <p className="text-sm text-destructive">{copiar.error?.response?.data?.mensaje ?? 'Error al copiar'}</p>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border border-border rounded-xl text-sm text-foreground hover:bg-accent transition-colors">
            Cancelar
          </button>
          <button
            onClick={() => copiar.mutate()}
            disabled={!origen || !hayEleccion || copiar.isPending}
            className="px-4 py-2 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground rounded-xl text-sm font-medium transition-colors"
          >
            {copiar.isPending ? 'Copiando...' : 'Copiar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
