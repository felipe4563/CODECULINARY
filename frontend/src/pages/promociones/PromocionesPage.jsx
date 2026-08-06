import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Tag, Plus, Pencil, Trash2, AlertCircle, RefreshCw } from 'lucide-react';
import { getPromociones, crearPromocion, actualizarPromocion, eliminarPromocion } from '../../api/promociones';
import { getProductos } from '../../api/productos';
import { usePermisos } from '../../hooks/usePermisos';
import { describirDisponibilidad } from '../../utils/disponibilidad';
import SelectorDiasSemana from '../../components/ui/SelectorDiasSemana';
import Modal from '../../components/ui/Modal';

function BadgeEstado({ activo }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${activo ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'}`}>
      {activo ? 'Activa' : 'Inactiva'}
    </span>
  );
}

function etiquetaValor(promo) {
  return promo.tipo === 'porcentaje' ? `-${parseFloat(promo.valor)}%` : `-Bs ${parseFloat(promo.valor).toFixed(2)}`;
}

function etiquetaProductos(promo) {
  if (!promo.productos || promo.productos.length === 0) return '—';
  return promo.productos.map((p) => p.nombre).join(', ');
}

export default function PromocionesPage() {
  const { tienePermiso } = usePermisos();
  const qc = useQueryClient();

  const puedeVer      = tienePermiso('promociones', 'ver');
  const puedeCrear    = tienePermiso('promociones', 'crear');
  const puedeEditar   = tienePermiso('promociones', 'editar');
  const puedeEliminar = tienePermiso('promociones', 'eliminar');

  const [modalForm, setModalForm] = useState(null); // null | 'nuevo' | promo-object
  const [confirmar, setConfirmar] = useState(null);

  const { data: promociones = [], isLoading } = useQuery({
    queryKey: ['promociones'],
    queryFn: getPromociones,
    enabled: puedeVer,
  });

  const eliminar = useMutation({
    mutationFn: (id) => eliminarPromocion(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['promociones'] });
      setConfirmar(null);
    },
    onError: (err) => alert(err?.response?.data?.mensaje ?? 'Error al eliminar la promoción'),
  });

  if (!puedeVer) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
        <AlertCircle className="w-10 h-10" />
        <p className="font-medium">No tienes permiso para ver las promociones</p>
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
          <h1 className="text-xl font-bold text-foreground">Promociones</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{promociones.length} promociones registradas</p>
        </div>
        {puedeCrear && (
          <button
            onClick={() => setModalForm('nuevo')}
            className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-sm font-semibold transition-colors"
          >
            <Plus className="w-4 h-4" /> Nueva Promoción
          </button>
        )}
      </div>

      {promociones.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
          <Tag className="w-10 h-10" />
          <p className="text-sm">No hay promociones registradas</p>
        </div>
      ) : (
        <>
          {/* mobile: tarjetas */}
          <div className="sm:hidden space-y-2">
            {promociones.map((p) => (
              <div key={p.id} className="bg-card border border-border rounded-xl p-3.5 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Tag className="w-4 h-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground truncate">{etiquetaProductos(p)}</p>
                      <p className="text-xs text-muted-foreground">{p.nombre || 'Sin nombre'}</p>
                    </div>
                  </div>
                  {(puedeEditar || puedeEliminar) && (
                    <div className="flex items-center gap-1 shrink-0">
                      {puedeEditar && (
                        <button onClick={() => setModalForm(p)} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {puedeEliminar && (
                        <button onClick={() => setConfirmar(p)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{etiquetaValor(p)}</span>
                  <BadgeEstado activo={p.activo} />
                </div>
                <p className="text-xs text-muted-foreground">{describirDisponibilidad(p)}</p>
              </div>
            ))}
          </div>

          {/* desktop: tabla */}
          <div className="hidden sm:block bg-card border border-border rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted border-b border-border">
                    <th className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Producto</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Descuento</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Vigencia</th>
                    <th className="px-5 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Estado</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {promociones.map((p) => (
                    <tr key={p.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-5 py-3.5 max-w-[240px]">
                        <div className="font-semibold text-foreground truncate" title={etiquetaProductos(p)}>{etiquetaProductos(p)}</div>
                        {p.nombre && <div className="text-xs text-muted-foreground">{p.nombre}</div>}
                      </td>
                      <td className="px-5 py-3.5 font-semibold text-emerald-600 dark:text-emerald-400">{etiquetaValor(p)}</td>
                      <td className="px-5 py-3.5 text-muted-foreground">{describirDisponibilidad(p)}</td>
                      <td className="px-5 py-3.5 text-center"><BadgeEstado activo={p.activo} /></td>
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
        </>
      )}

      {modalForm !== null && (
        <ModalPromocion
          promocion={modalForm === 'nuevo' ? null : modalForm}
          onClose={() => setModalForm(null)}
          onExito={() => { setModalForm(null); qc.invalidateQueries({ queryKey: ['promociones'] }); }}
        />
      )}

      {confirmar && (
        <Modal titulo="Eliminar promoción" onClose={() => setConfirmar(null)} ancho="max-w-sm">
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              ¿Eliminar la promoción <span className="font-semibold text-foreground">"{confirmar.nombre || etiquetaProductos(confirmar)}"</span>?
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

function ModalPromocion({ promocion, onClose, onExito }) {
  const esNuevo = !promocion;
  const [productosIds, setProductosIds] = useState(promocion?.productos?.map((p) => p.id) ?? []);
  const [nombre, setNombre]           = useState(promocion?.nombre ?? '');
  const [tipo, setTipo]               = useState(promocion?.tipo ?? 'porcentaje');
  const [valor, setValor]             = useState(promocion?.valor ?? '');
  const [activo, setActivo]           = useState(promocion?.activo ?? 1);
  const [fechaInicio, setFechaInicio] = useState(promocion?.fecha_inicio ?? '');
  const [fechaFin, setFechaFin]       = useState(promocion?.fecha_fin ?? '');
  const [diasSemana, setDiasSemana]   = useState(promocion?.dias_semana ?? null);
  const [error, setError] = useState(null);

  const { data: catalogo = [] } = useQuery({ queryKey: ['productos-catalogo'], queryFn: () => getProductos({ solo_vendibles: true }) });

  function alternarProducto(id) {
    setProductosIds((prev) => (prev.includes(id) ? prev.filter((pid) => pid !== id) : [...prev, id]));
  }

  const guardar = useMutation({
    mutationFn: () => {
      const datos = {
        producto_ids: productosIds, nombre: nombre.trim() || null, tipo, valor: parseFloat(valor), activo,
        fecha_inicio: fechaInicio || null, fecha_fin: fechaFin || null, dias_semana: diasSemana,
      };
      return esNuevo ? crearPromocion(datos) : actualizarPromocion(promocion.id, datos);
    },
    onSuccess: onExito,
    onError: (err) => setError(err?.response?.data?.mensaje ?? 'Error al guardar la promoción'),
  });

  const valido = productosIds.length > 0 && parseFloat(valor) > 0 && (tipo !== 'porcentaje' || parseFloat(valor) <= 100);

  return (
    <Modal titulo={esNuevo ? 'Nueva Promoción' : 'Editar Promoción'} onClose={onClose} ancho="max-w-md">
      <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Productos <span className="text-destructive">*</span> <span className="font-normal normal-case">(puede ser más de uno)</span>
          </label>
          <div className="border border-border rounded-xl max-h-40 overflow-y-auto divide-y divide-border">
            {catalogo.map((p) => (
              <label key={p.id} className="flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer hover:bg-muted/50 transition-colors">
                <input
                  type="checkbox"
                  checked={productosIds.includes(p.id)}
                  onChange={() => { alternarProducto(p.id); setError(null); }}
                  className="rounded border-input"
                />
                <span className="text-foreground truncate flex-1">{p.nombre}</span>
                <span className="text-xs text-muted-foreground shrink-0">Bs {parseFloat(p.precio).toFixed(2)}</span>
              </label>
            ))}
          </div>
          {productosIds.length > 0 && (
            <p className="text-xs text-muted-foreground">{productosIds.length} producto{productosIds.length !== 1 ? 's' : ''} seleccionado{productosIds.length !== 1 ? 's' : ''}.</p>
          )}
        </div>

        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Nombre de la promoción</label>
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Ej: Happy Hour"
            className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Tipo de descuento</label>
            <div className="grid grid-cols-2 gap-2">
              {[{ id: 'porcentaje', label: '%' }, { id: 'monto', label: 'Bs' }].map((t) => (
                <button
                  key={t.id} type="button" onClick={() => setTipo(t.id)}
                  className={`py-2.5 rounded-xl text-sm font-medium border transition-colors ${
                    tipo === t.id ? 'bg-primary border-primary text-primary-foreground' : 'border-input text-muted-foreground hover:border-primary/50'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
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
          <span className="text-xs text-muted-foreground">{activo ? 'Activa' : 'Inactiva'}</span>
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
            {guardar.isPending ? 'Guardando...' : esNuevo ? 'Crear Promoción' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
