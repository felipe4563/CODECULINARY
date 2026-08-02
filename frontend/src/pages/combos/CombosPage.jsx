import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Gift, Plus, Pencil, Trash2, AlertCircle, RefreshCw, X } from 'lucide-react';
import { getCombos, crearCombo, actualizarCombo, eliminarCombo } from '../../api/combos';
import { getProductos } from '../../api/productos';
import { usePermisos } from '../../hooks/usePermisos';
import { describirDisponibilidad } from '../../utils/disponibilidad';
import SelectorDiasSemana from '../../components/ui/SelectorDiasSemana';
import Modal from '../../components/ui/Modal';

function BadgeEstado({ activo }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${activo ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'}`}>
      {activo ? 'Activo' : 'Inactivo'}
    </span>
  );
}

export default function CombosPage() {
  const { tienePermiso } = usePermisos();
  const qc = useQueryClient();

  const puedeVer      = tienePermiso('combos', 'ver');
  const puedeCrear    = tienePermiso('combos', 'crear');
  const puedeEditar   = tienePermiso('combos', 'editar');
  const puedeEliminar = tienePermiso('combos', 'eliminar');

  const [modalForm, setModalForm] = useState(null); // null | 'nuevo' | combo-object
  const [confirmar, setConfirmar] = useState(null);

  const { data: combos = [], isLoading } = useQuery({
    queryKey: ['combos'],
    queryFn: getCombos,
    enabled: puedeVer,
  });

  const eliminar = useMutation({
    mutationFn: (id) => eliminarCombo(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['combos'] });
      setConfirmar(null);
    },
    onError: (err) => alert(err?.response?.data?.mensaje ?? 'Error al eliminar el combo'),
  });

  if (!puedeVer) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
        <AlertCircle className="w-10 h-10" />
        <p className="font-medium">No tienes permiso para ver los combos</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 gap-3 text-muted-foreground">
        <RefreshCw className="w-5 h-5 animate-spin" /><span>Cargando...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Combos</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{combos.length} combos registrados</p>
        </div>
        {puedeCrear && (
          <button
            onClick={() => setModalForm('nuevo')}
            className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-sm font-semibold transition-colors"
          >
            <Plus className="w-4 h-4" /> Nuevo Combo
          </button>
        )}
      </div>

      {combos.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
          <Gift className="w-10 h-10" />
          <p className="text-sm">No hay combos registrados</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {combos.map((c) => (
            <div key={c.id} className="bg-card border border-border rounded-2xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <Gift className="w-4.5 h-4.5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground truncate">{c.nombre}</p>
                    <p className="text-sm font-bold text-primary">Bs {parseFloat(c.precio).toFixed(2)}</p>
                  </div>
                </div>
                {(puedeEditar || puedeEliminar) && (
                  <div className="flex items-center gap-1 shrink-0">
                    {puedeEditar && (
                      <button onClick={() => setModalForm(c)} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {puedeEliminar && (
                      <button onClick={() => setConfirmar(c)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {c.productos.map((p) => `${p.ComboProducto?.cantidad ?? 1}× ${p.nombre}`).join(' + ') || 'Sin productos'}
              </p>
              <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
                <span className="text-xs text-muted-foreground">{describirDisponibilidad(c)}</span>
                <BadgeEstado activo={c.activo} />
              </div>
            </div>
          ))}
        </div>
      )}

      {modalForm !== null && (
        <ModalCombo
          combo={modalForm === 'nuevo' ? null : modalForm}
          onClose={() => setModalForm(null)}
          onExito={() => { setModalForm(null); qc.invalidateQueries({ queryKey: ['combos'] }); }}
        />
      )}

      {confirmar && (
        <Modal titulo="Eliminar combo" onClose={() => setConfirmar(null)} ancho="max-w-sm">
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              ¿Eliminar el combo <span className="font-semibold text-foreground">"{confirmar.nombre}"</span>?
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

function ModalCombo({ combo, onClose, onExito }) {
  const esNuevo = !combo;
  const [nombre, setNombre]           = useState(combo?.nombre ?? '');
  const [descripcion, setDescripcion] = useState(combo?.descripcion ?? '');
  const [precio, setPrecio]           = useState(combo?.precio ?? '');
  const [activo, setActivo]           = useState(combo?.activo ?? 1);
  const [fechaInicio, setFechaInicio] = useState(combo?.fecha_inicio ?? '');
  const [fechaFin, setFechaFin]       = useState(combo?.fecha_fin ?? '');
  const [diasSemana, setDiasSemana]   = useState(combo?.dias_semana ?? null);
  const [productos, setProductos]     = useState(
    combo?.productos?.map((p) => ({ producto_id: p.id, nombre: p.nombre, cantidad: p.ComboProducto?.cantidad ?? 1 })) ?? []
  );
  const [productoAAgregar, setProductoAAgregar] = useState('');
  const [error, setError] = useState(null);

  const { data: catalogo = [] } = useQuery({ queryKey: ['productos-catalogo'], queryFn: () => getProductos({ solo_vendibles: true }) });
  const disponibles = catalogo.filter((p) => !productos.some((sel) => sel.producto_id === p.id));

  function agregarProducto() {
    const p = catalogo.find((x) => String(x.id) === productoAAgregar);
    if (!p) return;
    setProductos((prev) => [...prev, { producto_id: p.id, nombre: p.nombre, cantidad: 1 }]);
    setProductoAAgregar('');
  }

  function setCantidad(producto_id, cantidad) {
    setProductos((prev) => prev.map((p) => p.producto_id === producto_id ? { ...p, cantidad: Math.max(1, cantidad) } : p));
  }

  function quitarProducto(producto_id) {
    setProductos((prev) => prev.filter((p) => p.producto_id !== producto_id));
  }

  const guardar = useMutation({
    mutationFn: () => {
      const datos = {
        nombre: nombre.trim(), descripcion: descripcion.trim() || null, precio: parseFloat(precio), activo,
        fecha_inicio: fechaInicio || null, fecha_fin: fechaFin || null, dias_semana: diasSemana,
        productos: productos.map((p) => ({ producto_id: p.producto_id, cantidad: p.cantidad })),
      };
      return esNuevo ? crearCombo(datos) : actualizarCombo(combo.id, datos);
    },
    onSuccess: onExito,
    onError: (err) => setError(err?.response?.data?.mensaje ?? 'Error al guardar el combo'),
  });

  const valido = nombre.trim().length > 0 && parseFloat(precio) > 0 && productos.length > 0;

  return (
    <Modal titulo={esNuevo ? 'Nuevo Combo' : `Editar: ${combo.nombre}`} onClose={onClose} ancho="max-w-lg">
      <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
            Nombre <span className="text-destructive">*</span>
          </label>
          <input
            autoFocus
            value={nombre}
            onChange={(e) => { setNombre(e.target.value); setError(null); }}
            placeholder="Ej: Combo Familiar"
            className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Descripción</label>
          <input
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Opcional"
            className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
            Precio del combo (Bs) <span className="text-destructive">*</span>
          </label>
          <input
            type="number" step="0.01" min="0"
            value={precio}
            onChange={(e) => setPrecio(e.target.value)}
            placeholder="0.00"
            className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
            Productos incluidos <span className="text-destructive">*</span>
          </label>
          <div className="space-y-1.5">
            {productos.map((p) => (
              <div key={p.producto_id} className="flex items-center gap-2 bg-muted rounded-xl px-3 py-1.5">
                <span className="flex-1 text-sm text-foreground truncate">{p.nombre}</span>
                <input
                  type="number" min="1"
                  value={p.cantidad}
                  onChange={(e) => setCantidad(p.producto_id, parseInt(e.target.value, 10) || 1)}
                  className="w-14 bg-background border border-input rounded-lg px-2 py-1 text-sm text-foreground text-center focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button type="button" onClick={() => quitarProducto(p.producto_id)} className="p-1 rounded-lg text-muted-foreground hover:text-destructive transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-2">
            <select
              value={productoAAgregar}
              onChange={(e) => setProductoAAgregar(e.target.value)}
              className="flex-1 bg-background border border-input rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
            >
              <option value="">Elegir producto...</option>
              {disponibles.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
            <button type="button" onClick={agregarProducto} disabled={!productoAAgregar} className="px-3 py-2 rounded-xl text-sm bg-muted hover:bg-accent text-foreground transition-colors disabled:opacity-50">
              Agregar
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Desde</label>
            <input
              type="date" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)}
              className="w-full bg-background border border-input rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Hasta</label>
            <input
              type="date" value={fechaFin} onChange={(e) => setFechaFin(e.target.value)}
              className="w-full bg-background border border-input rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
            Días de la semana <span className="font-normal normal-case">(vacío = todos los días)</span>
          </label>
          <SelectorDiasSemana value={diasSemana} onChange={setDiasSemana} />
        </div>

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
            {guardar.isPending ? 'Guardando...' : esNuevo ? 'Crear Combo' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
