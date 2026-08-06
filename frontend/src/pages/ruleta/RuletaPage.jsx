import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Disc3, Plus, Pencil, Trash2, Search, X, RefreshCw, AlertCircle, Star } from 'lucide-react';
import {
  getPremiosRuleta, crearPremioRuleta, actualizarPremioRuleta, eliminarPremioRuleta,
} from '../../api/ruleta';
import { getClientes } from '../../api/clientes';
import { getProductos } from '../../api/productos';
import { getCombosActivos } from '../../api/combos';
import { usePermisos } from '../../hooks/usePermisos';
import Modal from '../../components/ui/Modal';
import { etiquetaValor } from './ruedaUtils';
import GirarRuletaPanel from './GirarRuletaPanel';

const TIPOS_PREMIO = [
  { id: 'porcentaje', label: '%' },
  { id: 'fijo', label: 'Bs' },
  { id: 'producto_gratis', label: 'Producto' },
  { id: 'combo_gratis', label: 'Combo' },
  { id: 'nada', label: 'Nada' },
];

/* ─── Tab Girar ─────────────────────────────────────────────────────────── */

function TabGirar() {
  const [cliente, setCliente] = useState(null);
  const [busqueda, setBusqueda] = useState('');
  const [buscando, setBuscando] = useState(false);

  const { data: resultadosCliente = [] } = useQuery({
    queryKey: ['clientes-buscar-ruleta', busqueda],
    queryFn: () => getClientes({ buscar: busqueda }),
    enabled: buscando && busqueda.trim().length >= 2,
  });

  if (!cliente) {
    return (
      <div className="max-w-md space-y-1.5">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <Star className="w-3.5 h-3.5" /> Buscar cliente
        </label>
        <div className="relative">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={busqueda}
            onChange={(e) => { setBusqueda(e.target.value); setBuscando(true); }}
            onFocus={() => setBuscando(true)}
            placeholder="Buscar por nombre o documento..."
            className="w-full bg-background border border-input rounded-xl pl-9 pr-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
          />
        </div>
        {buscando && busqueda.trim().length >= 2 && (
          <div className="border border-border rounded-xl overflow-hidden max-h-48 overflow-y-auto">
            {resultadosCliente.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">Sin resultados</p>
            ) : resultadosCliente.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => { setCliente(c); setBuscando(false); setBusqueda(''); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center justify-between gap-2"
              >
                <span className="truncate text-foreground">{c.nombre}</span>
                <span className="text-xs text-muted-foreground shrink-0">{c.puntos} pts</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 bg-muted/50 border border-border rounded-xl p-3 max-w-md">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{cliente.nombre}</p>
          <p className="text-xs text-muted-foreground">{cliente.puntos} puntos disponibles</p>
        </div>
        <button
          type="button"
          onClick={() => setCliente(null)}
          className="p-1 rounded-lg text-muted-foreground hover:text-destructive transition-colors shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <GirarRuletaPanel cliente={cliente} layout="grid" />
    </div>
  );
}

/* ─── Tab Premios ───────────────────────────────────────────────────────── */

function TabPremios() {
  const { tienePermiso } = usePermisos();
  const qc = useQueryClient();
  const puedeCrear = tienePermiso('ruleta', 'crear');
  const puedeEditar = tienePermiso('ruleta', 'editar');
  const puedeEliminar = tienePermiso('ruleta', 'eliminar');

  const [modalForm, setModalForm] = useState(null); // null | 'nuevo' | premio
  const [confirmar, setConfirmar] = useState(null);

  const { data: premios = [], isLoading } = useQuery({
    queryKey: ['ruleta-premios-todos'],
    queryFn: getPremiosRuleta,
  });

  const eliminar = useMutation({
    mutationFn: (id) => eliminarPremioRuleta(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ruleta-premios-todos'] });
      setConfirmar(null);
    },
    onError: (err) => alert(err?.response?.data?.mensaje ?? 'Error al eliminar el premio'),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 gap-3 text-muted-foreground">
        <RefreshCw className="w-5 h-5 animate-spin" /><span>Cargando...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm text-muted-foreground">{premios.length} premio{premios.length !== 1 ? 's' : ''} configurado{premios.length !== 1 ? 's' : ''}</p>
        {puedeCrear && (
          <button
            onClick={() => setModalForm('nuevo')}
            className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-sm font-semibold transition-colors"
          >
            <Plus className="w-4 h-4" /> Nuevo Premio
          </button>
        )}
      </div>

      {premios.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
          <Disc3 className="w-10 h-10" />
          <p className="text-sm">No hay premios configurados</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted border-b border-border">
                  <th className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Premio</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Valor</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Peso</th>
                  <th className="px-5 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Estado</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {premios.map((p) => (
                  <tr key={p.id} className="hover:bg-muted/50 transition-colors">
                    <td className="px-5 py-3.5 font-semibold text-foreground flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full shrink-0" style={{ background: p.color || '#9ca3af' }} />
                      {p.nombre}
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground">{etiquetaValor(p)}</td>
                    <td className="px-5 py-3.5 text-muted-foreground">{p.peso}</td>
                    <td className="px-5 py-3.5 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${p.activo ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'}`}>
                        {p.activo ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-1">
                        {puedeEditar && (
                          <button onClick={() => setModalForm(p)} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors" title="Editar">
                            <Pencil className="w-4 h-4" />
                          </button>
                        )}
                        {puedeEliminar && (
                          <button onClick={() => setConfirmar(p)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors" title="Eliminar">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modalForm !== null && (
        <ModalPremio
          premio={modalForm === 'nuevo' ? null : modalForm}
          onClose={() => setModalForm(null)}
          onExito={() => { setModalForm(null); qc.invalidateQueries({ queryKey: ['ruleta-premios-todos'] }); }}
        />
      )}

      {confirmar && (
        <Modal titulo="Eliminar premio" onClose={() => setConfirmar(null)} ancho="max-w-sm">
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              ¿Eliminar el premio <span className="font-semibold text-foreground">"{confirmar.nombre}"</span>?
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmar(null)} className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors">
                Cancelar
              </button>
              <button
                onClick={() => eliminar.mutate(confirmar.id)}
                disabled={eliminar.isPending}
                className="px-5 py-2 rounded-xl text-sm bg-destructive hover:bg-destructive/90 text-destructive-foreground font-semibold transition-colors disabled:opacity-60"
              >
                {eliminar.isPending ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ModalPremio({ premio, onClose, onExito }) {
  const esNuevo = !premio;
  const [nombre, setNombre] = useState(premio?.nombre ?? '');
  const [tipo, setTipo] = useState(premio?.tipo ?? 'nada');
  const [valor, setValor] = useState(premio?.valor ?? '');
  const [productoId, setProductoId] = useState(premio?.producto_id ?? '');
  const [comboId, setComboId] = useState(premio?.combo_id ?? '');
  const [peso, setPeso] = useState(premio?.peso ?? 10);
  const [color, setColor] = useState(premio?.color ?? '#ef4444');
  const [activo, setActivo] = useState(premio?.activo ?? 1);
  const [orden, setOrden] = useState(premio?.orden ?? 0);
  const [error, setError] = useState(null);

  const { data: productos = [] } = useQuery({
    queryKey: ['productos-para-ruleta'],
    queryFn: () => getProductos(),
    enabled: tipo === 'producto_gratis',
  });
  const { data: combos = [] } = useQuery({
    queryKey: ['combos-para-ruleta'],
    queryFn: getCombosActivos,
    enabled: tipo === 'combo_gratis',
  });

  function cambiarTipo(nuevoTipo) {
    setTipo(nuevoTipo);
    if (nuevoTipo !== 'producto_gratis') setProductoId('');
    if (nuevoTipo !== 'combo_gratis') setComboId('');
    if (nuevoTipo !== 'porcentaje' && nuevoTipo !== 'fijo') setValor('');
  }

  const guardar = useMutation({
    mutationFn: () => {
      const datos = {
        nombre, tipo,
        valor: (tipo === 'porcentaje' || tipo === 'fijo') ? parseFloat(valor) : null,
        producto_id: tipo === 'producto_gratis' ? parseInt(productoId, 10) : null,
        combo_id: tipo === 'combo_gratis' ? parseInt(comboId, 10) : null,
        peso: parseInt(peso, 10), color, activo, orden: parseInt(orden, 10) || 0,
      };
      return esNuevo ? crearPremioRuleta(datos) : actualizarPremioRuleta(premio.id, datos);
    },
    onSuccess: onExito,
    onError: (err) => setError(err?.response?.data?.mensaje ?? 'Error al guardar el premio'),
  });

  const valido = nombre.trim().length >= 2 && parseInt(peso, 10) >= 1
    && (
      tipo === 'nada'
      || (tipo === 'producto_gratis' && !!productoId)
      || (tipo === 'combo_gratis' && !!comboId)
      || ((tipo === 'porcentaje' || tipo === 'fijo') && parseFloat(valor) > 0 && (tipo !== 'porcentaje' || parseFloat(valor) <= 100))
    );

  return (
    <Modal titulo={esNuevo ? 'Nuevo Premio' : 'Editar Premio'} onClose={onClose} ancho="max-w-md">
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
            Nombre (se ve en la ruleta) <span className="text-destructive">*</span>
          </label>
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="10% OFF"
            className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Tipo de premio</label>
          <div className="grid grid-cols-3 gap-1.5">
            {TIPOS_PREMIO.map((t) => (
              <button
                key={t.id} type="button" onClick={() => cambiarTipo(t.id)}
                className={`py-2 rounded-xl text-xs font-medium border transition-colors ${
                  tipo === t.id ? 'bg-primary border-primary text-primary-foreground' : 'border-input text-muted-foreground hover:border-primary/50'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {(tipo === 'porcentaje' || tipo === 'fijo') && (
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              Valor <span className="text-destructive">*</span>
            </label>
            <input
              type="number" step="0.01" min="0" max={tipo === 'porcentaje' ? 100 : undefined}
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              placeholder={tipo === 'porcentaje' ? '10' : '5.00'}
              className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
            />
          </div>
        )}

        {tipo === 'producto_gratis' && (
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              Producto <span className="text-destructive">*</span>
            </label>
            <select
              value={productoId}
              onChange={(e) => setProductoId(e.target.value)}
              className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
            >
              <option value="">Seleccionar producto...</option>
              {productos.map((p) => (
                <option key={p.id} value={p.id}>{p.nombre} — Bs {parseFloat(p.precio).toFixed(2)}</option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground mt-1">
              Se genera un cupón por el precio vigente del producto al momento de ganar (siempre actualizado, aunque cambie el precio después).
            </p>
          </div>
        )}

        {tipo === 'combo_gratis' && (
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              Combo <span className="text-destructive">*</span>
            </label>
            <select
              value={comboId}
              onChange={(e) => setComboId(e.target.value)}
              className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
            >
              <option value="">Seleccionar combo...</option>
              {combos.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre} — Bs {parseFloat(c.precio).toFixed(2)}</option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground mt-1">
              Se genera un cupón por el precio vigente del combo al momento de ganar.
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              Peso (probabilidad relativa) <span className="text-destructive">*</span>
            </label>
            <input
              type="number" min="1" step="1"
              value={peso}
              onChange={(e) => setPeso(e.target.value)}
              className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Color</label>
            <input
              type="color" value={color} onChange={(e) => setColor(e.target.value)}
              className="w-full h-[42px] bg-background border border-input rounded-xl px-1.5 py-1 cursor-pointer"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
            Orden en la ruleta <span className="font-normal normal-case">(menor va primero)</span>
          </label>
          <input
            type="number" step="1"
            value={orden}
            onChange={(e) => setOrden(e.target.value)}
            className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
          />
        </div>

        <p className="text-xs text-muted-foreground bg-muted rounded-xl p-3">
          A mayor peso, más chance tiene de salir en el giro — el tamaño del segmento en la ruleta refleja esta probabilidad.
        </p>

        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Estado</label>
          <button
            type="button"
            onClick={() => setActivo((a) => a ? 0 : 1)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${activo ? 'bg-emerald-500' : 'bg-muted'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${activo ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
          <span className="text-xs text-muted-foreground">{activo ? 'Activo' : 'Inactivo'}</span>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end gap-3 pt-1 border-t border-border">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors">
            Cancelar
          </button>
          <button
            onClick={() => guardar.mutate()}
            disabled={guardar.isPending || !valido}
            className="px-5 py-2 rounded-xl text-sm bg-primary hover:bg-primary/90 text-primary-foreground font-semibold transition-colors disabled:opacity-60"
          >
            {guardar.isPending ? 'Guardando...' : esNuevo ? 'Crear Premio' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ─── página principal ─────────────────────────────────────────────────── */

export default function RuletaPage() {
  const { tienePermiso } = usePermisos();
  const puedeVer = tienePermiso('ruleta', 'ver');
  const puedeGirar = tienePermiso('ruleta', 'girar');
  const [tab, setTab] = useState('girar');

  if (!puedeVer && !puedeGirar) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
        <AlertCircle className="w-10 h-10" />
        <p className="font-medium">No tienes permiso para ver la ruleta</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Disc3 className="w-5 h-5 text-primary" /> Ruleta de Premios
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">Los clientes canjean puntos de fidelidad por un giro</p>
      </div>

      <div className="flex gap-1 bg-muted p-1 rounded-xl w-fit">
        {puedeGirar && (
          <button
            onClick={() => setTab('girar')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'girar' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Girar
          </button>
        )}
        {puedeVer && (
          <button
            onClick={() => setTab('premios')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'premios' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Premios
          </button>
        )}
      </div>

      {tab === 'girar' && puedeGirar ? <TabGirar /> : <TabPremios />}
    </div>
  );
}
