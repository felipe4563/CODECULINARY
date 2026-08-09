import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePermisos } from '../../hooks/usePermisos';
import {
  getProveedores, crearProveedor, actualizarProveedor, desactivarProveedor,
  getCompras, crearCompra, recibirCompra,
} from '../../api/compras';
import { getProductos } from '../../api/productos';
import { getInsumos } from '../../api/insumos';
import {
  Truck, Plus, Search, X, ChevronDown, ChevronUp, CheckCircle2,
  Clock, PackageCheck, Trash2, Edit2, Users, ShoppingCart, AlertTriangle,
} from 'lucide-react';

/* ─── helpers ─── */
const fmtBs = (n) => `Bs ${Number(n ?? 0).toLocaleString('es-BO', { minimumFractionDigits: 2 })}`;
const fmtFecha = (s) => s ? new Date(s).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' }) : '—';

function BadgeEstado({ estado }) {
  if (estado === 'recibido') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
      <CheckCircle2 className="w-3 h-3" />Recibido
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
      <Clock className="w-3 h-3" />Pendiente
    </span>
  );
}

/* ─── modal proveedor ─── */
function ModalProveedor({ proveedor, onClose, onGuardar }) {
  const [form, setForm] = useState({
    nombre:    proveedor?.nombre    ?? '',
    contacto:  proveedor?.contacto  ?? '',
    telefono:  proveedor?.telefono  ?? '',
    email:     proveedor?.email     ?? '',
    direccion: proveedor?.direccion ?? '',
  });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.nombre.trim()) { setError('El nombre es requerido'); return; }
    setError('');
    onGuardar(form);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-md border border-border">
        <div className="px-6 py-4 rounded-t-2xl bg-primary flex items-center justify-between">
          <h2 className="text-primary-foreground font-semibold">{proveedor ? 'Editar Proveedor' : 'Nuevo Proveedor'}</h2>
          <button onClick={onClose} className="text-primary-foreground/80 hover:text-primary-foreground"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-3">
          {[
            { k: 'nombre',    label: 'Nombre *',   placeholder: 'Nombre del proveedor' },
            { k: 'contacto',  label: 'Contacto',   placeholder: 'Persona de contacto' },
            { k: 'telefono',  label: 'Teléfono',   placeholder: '+591...' },
            { k: 'email',     label: 'Email',       placeholder: 'correo@ejemplo.com' },
            { k: 'direccion', label: 'Dirección',  placeholder: 'Dirección' },
          ].map(({ k, label, placeholder }) => (
            <div key={k}>
              <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wide">{label}</label>
              <input
                value={form[k]}
                onChange={set(k)}
                placeholder={placeholder}
                className="w-full rounded-xl border border-input bg-background text-foreground px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          ))}
          {error && <p className="text-rose-600 dark:text-rose-400 text-sm flex items-center gap-1"><AlertTriangle className="w-4 h-4" />{error}</p>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors">Cancelar</button>
            <button type="submit" className="flex-1 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold transition-colors">Guardar</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── modal nueva compra ─── */
const ITEM_VACIO = { tipo: 'producto', producto_id: '', insumo_id: '', cantidad: 1, costo_unitario: '' };

function ModalCompra({ proveedores, productos, insumos, onClose, onGuardar }) {
  const [proveedorId, setProveedorId] = useState('');
  const [notas, setNotas] = useState('');
  const [items, setItems] = useState([{ ...ITEM_VACIO }]);
  const [error, setError] = useState('');

  const setItem = (i, k, v) => setItems(prev => prev.map((it, idx) => idx === i ? { ...it, [k]: v } : it));
  const addItem = () => setItems(prev => [...prev, { ...ITEM_VACIO }]);
  const removeItem = (i) => setItems(prev => prev.filter((_, idx) => idx !== i));

  const total = useMemo(() =>
    items.reduce((s, it) => s + (parseFloat(it.costo_unitario || 0) * parseFloat(it.cantidad || 0)), 0),
    [items]
  );

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!proveedorId) { setError('Selecciona un proveedor'); return; }
    const validos = items.filter(it =>
      (it.tipo === 'producto' ? it.producto_id : it.insumo_id) && it.cantidad > 0 && parseFloat(it.costo_unitario) > 0
    );
    if (!validos.length) { setError('Agrega al menos un ítem válido'); return; }
    setError('');
    onGuardar({
      proveedor_id: Number(proveedorId),
      notas,
      items: validos.map(it => ({
        producto_id: it.tipo === 'producto' ? Number(it.producto_id) : undefined,
        insumo_id: it.tipo === 'insumo' ? Number(it.insumo_id) : undefined,
        cantidad: Number(it.cantidad),
        costo_unitario: parseFloat(it.costo_unitario),
      })),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto border border-border">
        <div className="px-6 py-4 rounded-t-2xl bg-primary flex items-center justify-between sticky top-0 z-10">
          <h2 className="text-primary-foreground font-semibold">Nueva Compra</h2>
          <button onClick={onClose} className="text-primary-foreground/80 hover:text-primary-foreground"><X className="w-5 h-5" /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* proveedor + notas */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">Proveedor *</label>
              <select
                value={proveedorId}
                onChange={e => setProveedorId(e.target.value)}
                className="w-full rounded-xl border border-input bg-background text-foreground px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Seleccionar proveedor...</option>
                {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">Notas</label>
              <input
                value={notas}
                onChange={e => setNotas(e.target.value)}
                placeholder="Observaciones..."
                className="w-full rounded-xl border border-input bg-background text-foreground px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          {/* items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Ítems</label>
              <button type="button" onClick={addItem} className="text-xs text-primary font-medium hover:underline flex items-center gap-1">
                <Plus className="w-3.5 h-3.5" /> Agregar ítem
              </button>
            </div>
            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={i} className="space-y-2 pb-2 border-b border-border last:border-0">
                  <div className="flex gap-1 bg-muted p-1 rounded-lg w-fit">
                    {[{ v: 'producto', label: 'Producto' }, { v: 'insumo', label: 'Insumo' }].map(({ v, label }) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setItem(i, 'tipo', v)}
                        className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                          it.tipo === v ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="sm:grid sm:grid-cols-12 sm:gap-2 sm:items-center space-y-2 sm:space-y-0">
                    <div className="sm:col-span-5">
                      {it.tipo === 'producto' ? (
                        <select
                          value={it.producto_id}
                          onChange={e => setItem(i, 'producto_id', e.target.value)}
                          className="w-full rounded-xl border border-input bg-background text-foreground px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                          <option value="">Producto...</option>
                          {productos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                        </select>
                      ) : (
                        <select
                          value={it.insumo_id}
                          onChange={e => setItem(i, 'insumo_id', e.target.value)}
                          className="w-full rounded-xl border border-input bg-background text-foreground px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                          <option value="">Insumo...</option>
                          {insumos.map(ins => <option key={ins.id} value={ins.id}>{ins.nombre} ({ins.unidad_medida})</option>)}
                        </select>
                      )}
                    </div>
                    <div className="flex gap-2 sm:contents">
                      <div className="flex-1 sm:col-span-3">
                        <input
                          type="number" min="0" step={it.tipo === 'insumo' ? '0.001' : '1'} placeholder="Ctd."
                          value={it.cantidad}
                          onChange={e => setItem(i, 'cantidad', e.target.value)}
                          className="w-full rounded-xl border border-input bg-background text-foreground px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      </div>
                      <div className="flex-1 sm:col-span-3">
                        <input
                          type="number" min="0" step="0.01" placeholder="Costo Bs"
                          value={it.costo_unitario}
                          onChange={e => setItem(i, 'costo_unitario', e.target.value)}
                          className="w-full rounded-xl border border-input bg-background text-foreground px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      </div>
                      <div className="flex items-center sm:col-span-1 sm:justify-center">
                        {items.length > 1 && (
                          <button type="button" onClick={() => removeItem(i)} className="text-muted-foreground hover:text-destructive transition-colors">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* total */}
          <div className="flex justify-end">
            <div className="bg-primary/10 rounded-xl px-5 py-3 text-right">
              <p className="text-xs text-muted-foreground">Total estimado</p>
              <p className="text-xl font-bold text-primary">{fmtBs(total)}</p>
            </div>
          </div>

          {error && <p className="text-rose-600 dark:text-rose-400 text-sm flex items-center gap-1"><AlertTriangle className="w-4 h-4" />{error}</p>}

          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors">Cancelar</button>
            <button type="submit" className="flex-1 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold transition-colors">Crear Compra</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── fila/detalle compra ─── */
function CompraRow({ compra, idx, puedoRecibir, onRecibir }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <tr
        className="hover:bg-muted/50 transition-colors cursor-pointer"
        style={{ animation: 'cmpFadeUp .3s ease both', animationDelay: `${idx * 20}ms` }}
        onClick={() => setAbierto(v => !v)}
      >
        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{fmtFecha(compra.creado_en)}</td>
        <td className="px-4 py-3 font-medium text-foreground">#{compra.id}</td>
        <td className="px-4 py-3 text-foreground">{compra.proveedor?.nombre ?? '—'}</td>
        <td className="px-4 py-3 text-center text-muted-foreground">{compra.detalles?.length ?? 0}</td>
        <td className="px-4 py-3 font-semibold text-foreground text-right">{fmtBs(compra.total)}</td>
        <td className="px-4 py-3"><BadgeEstado estado={compra.estado} /></td>
        <td className="px-4 py-3 text-right">
          <div className="flex items-center justify-end gap-2" onClick={e => e.stopPropagation()}>
            {puedoRecibir && compra.estado === 'pendiente' && (
              <button
                onClick={() => onRecibir(compra.id)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors"
              >
                <PackageCheck className="w-3.5 h-3.5" />Recibir
              </button>
            )}
            <button onClick={() => setAbierto(v => !v)} className="text-muted-foreground hover:text-foreground transition-colors">
              {abierto ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </td>
      </tr>
      {abierto && compra.detalles?.length > 0 && (
        <tr className="bg-muted/40">
          <td colSpan={7} className="px-6 py-3">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="text-left pb-1.5 font-medium">Producto</th>
                  <th className="text-right pb-1.5 font-medium">Cantidad</th>
                  <th className="text-right pb-1.5 font-medium">Costo Unit.</th>
                  <th className="text-right pb-1.5 font-medium">Subtotal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {compra.detalles.map(d => (
                  <tr key={d.id}>
                    <td className="py-1.5 text-foreground">
                      {d.producto?.nombre ?? d.insumo?.nombre ?? '—'}
                      {d.insumo && <span className="text-muted-foreground"> ({d.insumo.unidad_medida})</span>}
                    </td>
                    <td className="py-1.5 text-right text-muted-foreground">{d.cantidad}</td>
                    <td className="py-1.5 text-right text-muted-foreground">{fmtBs(d.costo_unitario)}</td>
                    <td className="py-1.5 text-right font-semibold text-foreground">{fmtBs(d.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {compra.notas && (
              <p className="mt-2 text-xs text-muted-foreground italic">Nota: {compra.notas}</p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

/* ─── tarjeta compra móvil ─── */
function CompraCard({ compra, idx, puedoRecibir, onRecibir }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <div
      className="bg-card rounded-xl border border-border shadow-sm overflow-hidden"
      style={{ animation: 'cmpFadeUp .35s ease both', animationDelay: `${idx * 30}ms` }}
    >
      <button className="w-full px-4 py-3 text-left" onClick={() => setAbierto(v => !v)}>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">#{compra.id} — {compra.proveedor?.nombre ?? '—'}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{fmtFecha(compra.creado_en)}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <BadgeEstado estado={compra.estado} />
            {abierto ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </div>
        </div>
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-muted-foreground">{compra.detalles?.length ?? 0} ítem{(compra.detalles?.length ?? 0) !== 1 ? 's' : ''}</span>
          <span className="text-sm font-bold text-primary">{fmtBs(compra.total)}</span>
        </div>
      </button>
      {abierto && (
        <div className="border-t border-border px-4 py-3 space-y-2">
          {compra.detalles?.map(d => (
            <div key={d.id} className="flex justify-between text-xs">
              <span className="text-foreground">{d.producto?.nombre ?? d.insumo?.nombre ?? '—'} × {d.cantidad}</span>
              <span className="font-semibold text-foreground">{fmtBs(d.subtotal)}</span>
            </div>
          ))}
          {compra.notas && <p className="text-xs text-muted-foreground italic">Nota: {compra.notas}</p>}
          {puedoRecibir && compra.estado === 'pendiente' && (
            <button
              onClick={() => onRecibir(compra.id)}
              className="w-full mt-1 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
            >
              <PackageCheck className="w-3.5 h-3.5" />Marcar como Recibido
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── tab proveedores ─── */
function TabProveedores({ proveedores, puedoCrear, puedoEditar, onCrear, onEditar, onEliminar }) {
  const [buscar, setBuscar] = useState('');
  const filtrados = useMemo(() =>
    proveedores.filter(p => p.nombre.toLowerCase().includes(buscar.toLowerCase())),
    [proveedores, buscar]
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={buscar}
            onChange={e => setBuscar(e.target.value)}
            placeholder="Buscar proveedor..."
            className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        {puedoCrear && (
          <button onClick={onCrear} className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors">
            <Plus className="w-4 h-4" /><span className="hidden sm:inline">Nuevo</span>
          </button>
        )}
      </div>

      {filtrados.length === 0 ? (
        <div className="bg-card rounded-2xl border border-border shadow-sm flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
          <Users className="w-10 h-10 opacity-40" />
          <p className="text-sm">Sin proveedores</p>
        </div>
      ) : (
        <>
          {/* mobile: tarjetas */}
          <div className="sm:hidden space-y-2">
            {filtrados.map((p, i) => (
              <div
                key={p.id}
                className="bg-card rounded-xl border border-border shadow-sm p-3.5"
                style={{ animation: 'cmpFadeUp .35s ease both', animationDelay: `${i * 30}ms` }}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold text-foreground min-w-0 truncate">{p.nombre}</p>
                  {puedoEditar && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => onEditar(p)} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => onEliminar(p.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
                <div className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                  {p.contacto && <p>{p.contacto}</p>}
                  {p.telefono && <p>{p.telefono}</p>}
                  {p.email && <p>{p.email}</p>}
                  {p.direccion && <p>{p.direccion}</p>}
                </div>
              </div>
            ))}
          </div>

          {/* desktop: tabla */}
          <div className="hidden sm:block bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted">
                    {['Nombre', 'Contacto', 'Teléfono', 'Email', 'Dirección', ''].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtrados.map((p, i) => (
                    <tr key={p.id} className="hover:bg-muted/50 transition-colors"
                      style={{ animation: 'cmpFadeUp .3s ease both', animationDelay: `${i * 20}ms` }}>
                      <td className="px-4 py-3 font-medium text-foreground">{p.nombre}</td>
                      <td className="px-4 py-3 text-foreground">{p.contacto ?? '—'}</td>
                      <td className="px-4 py-3 text-foreground">{p.telefono ?? '—'}</td>
                      <td className="px-4 py-3 text-foreground">{p.email ?? '—'}</td>
                      <td className="px-4 py-3 text-foreground">{p.direccion ?? '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 justify-end">
                          {puedoEditar && (
                            <>
                              <button onClick={() => onEditar(p)} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button onClick={() => onEliminar(p.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
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
    </div>
  );
}

/* ─── página principal ─── */
export default function ComprasPage() {
  const { tienePermiso } = usePermisos();
  const qc = useQueryClient();

  const puedoVer     = tienePermiso('compras', 'ver');
  const puedoCrear   = tienePermiso('compras', 'crear');
  const puedoRecibir = tienePermiso('compras', 'recibir');
  const puedoEditarProv = tienePermiso('proveedores', 'editar');
  const puedoCrearProv  = tienePermiso('proveedores', 'crear');

  const [tab, setTab] = useState('compras'); // 'compras' | 'proveedores'
  const [buscar, setBuscar] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('todos');
  const [modalCompra, setModalCompra] = useState(false);
  const [modalProv, setModalProv] = useState(null); // null | 'nuevo' | proveedor
  const [toast, setToast] = useState(null);

  const mostrarToast = (msg, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  const { data: compras = [], isLoading: loadingCompras } = useQuery({
    queryKey: ['compras'],
    queryFn: getCompras,
    enabled: puedoVer,
  });

  const { data: proveedores = [] } = useQuery({
    queryKey: ['proveedores'],
    queryFn: getProveedores,
    enabled: puedoVer,
  });

  const { data: productos = [] } = useQuery({
    queryKey: ['productos'],
    queryFn: getProductos,
    enabled: puedoCrear,
  });

  const { data: insumos = [] } = useQuery({
    queryKey: ['insumos'],
    queryFn: getInsumos,
    enabled: puedoCrear,
  });

  const productosActivos = useMemo(() => productos.filter(p => p.activo), [productos]);

  const mutCrearCompra = useMutation({
    mutationFn: crearCompra,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['compras'] }); setModalCompra(false); mostrarToast('Compra creada'); },
    onError: (e) => mostrarToast(e?.response?.data?.mensaje ?? 'Error al crear compra', false),
  });

  const mutRecibir = useMutation({
    mutationFn: recibirCompra,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['compras'] }); qc.invalidateQueries({ queryKey: ['inventario'] }); qc.invalidateQueries({ queryKey: ['productos'] }); qc.invalidateQueries({ queryKey: ['insumos'] }); qc.invalidateQueries({ queryKey: ['insumos-reporte-compras'] }); mostrarToast('Compra recibida — stock actualizado'); },
    onError: (e) => mostrarToast(e?.response?.data?.mensaje ?? 'Error al recibir compra', false),
  });

  const mutCrearProv = useMutation({
    mutationFn: crearProveedor,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['proveedores'] }); setModalProv(null); mostrarToast('Proveedor creado'); },
    onError: (e) => mostrarToast(e?.response?.data?.mensaje ?? 'Error', false),
  });

  const mutEditarProv = useMutation({
    mutationFn: ({ id, datos }) => actualizarProveedor(id, datos),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['proveedores'] }); setModalProv(null); mostrarToast('Proveedor actualizado'); },
    onError: (e) => mostrarToast(e?.response?.data?.mensaje ?? 'Error', false),
  });

  const mutEliminarProv = useMutation({
    mutationFn: desactivarProveedor,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['proveedores'] }); mostrarToast('Proveedor desactivado'); },
    onError: (e) => mostrarToast(e?.response?.data?.mensaje ?? 'Error', false),
  });

  const comprasFiltradas = useMemo(() => {
    let c = compras;
    if (filtroEstado !== 'todos') c = c.filter(x => x.estado === filtroEstado);
    if (buscar.trim()) {
      const q = buscar.toLowerCase();
      c = c.filter(x =>
        String(x.id).includes(q) ||
        x.proveedor?.nombre?.toLowerCase().includes(q) ||
        x.notas?.toLowerCase().includes(q)
      );
    }
    return c;
  }, [compras, filtroEstado, buscar]);

  // resumen
  const totalPendiente = useMemo(() => compras.filter(c => c.estado === 'pendiente').reduce((s, c) => s + parseFloat(c.total ?? 0), 0), [compras]);
  const totalRecibido  = useMemo(() => compras.filter(c => c.estado === 'recibido').reduce((s, c) => s + parseFloat(c.total ?? 0), 0), [compras]);

  const handleGuardarProv = useCallback((datos) => {
    if (modalProv === 'nuevo') mutCrearProv.mutate(datos);
    else mutEditarProv.mutate({ id: modalProv.id, datos });
  }, [modalProv, mutCrearProv, mutEditarProv]);

  if (!puedoVer) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
        <Truck className="w-12 h-12" />
        <p className="text-sm">Sin acceso al módulo de compras</p>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @keyframes cmpFadeUp { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:translateY(0); } }
        @keyframes toastIn   { from { opacity:0; transform:translateX(20px); } to { opacity:1; transform:translateX(0); } }
      `}</style>

      {/* toast */}
      {toast && (
        <div
          className={`fixed top-5 right-5 z-[100] px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white flex items-center gap-2 ${toast.ok ? 'bg-emerald-600' : 'bg-rose-600'}`}
          style={{ animation: 'toastIn .25s ease both' }}
        >
          {toast.ok ? '✓' : '✕'} {toast.msg}
        </div>
      )}

      {modalCompra && (
        <ModalCompra
          proveedores={proveedores}
          productos={productosActivos}
          insumos={insumos}
          onClose={() => setModalCompra(false)}
          onGuardar={(d) => mutCrearCompra.mutate(d)}
        />
      )}

      {modalProv && (
        <ModalProveedor
          proveedor={modalProv === 'nuevo' ? null : modalProv}
          onClose={() => setModalProv(null)}
          onGuardar={handleGuardarProv}
        />
      )}

      <div className="space-y-6">
        {/* header */}
        <div className="rounded-2xl p-5 sm:p-6 bg-primary text-primary-foreground relative overflow-hidden">
          <div className="absolute -top-6 -right-6 w-32 h-32 bg-primary-foreground/10 rounded-full" />
          <div className="absolute -bottom-4 -right-16 w-48 h-48 bg-primary-foreground/5 rounded-full" />
          <div className="relative flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold">Compras</h1>
              <p className="text-primary-foreground/70 text-sm mt-0.5">Órdenes de compra y proveedores</p>
            </div>
            {puedoCrear && (
              <button
                onClick={() => setModalCompra(true)}
                className="flex items-center gap-2 bg-primary-foreground text-primary px-4 py-2 rounded-xl text-sm font-semibold shadow hover:shadow-md transition-all hover:scale-[1.02]"
              >
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">Nueva Compra</span>
                <span className="sm:hidden">Nueva</span>
              </button>
            )}
          </div>
        </div>

        {/* summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: 'Total compras', value: compras.length, sub: 'registros', barClass: 'bg-primary', delay: 100 },
            { label: 'Pendiente', value: fmtBs(totalPendiente), sub: `${compras.filter(c=>c.estado==='pendiente').length} compras`, barClass: 'bg-amber-500', delay: 160 },
            { label: 'Recibido', value: fmtBs(totalRecibido), sub: `${compras.filter(c=>c.estado==='recibido').length} compras`, barClass: 'bg-emerald-500', delay: 220 },
          ].map(({ label, value, sub, barClass, delay }) => (
            <div
              key={label}
              className="bg-card rounded-2xl border border-border shadow-sm p-5 relative overflow-hidden"
              style={{ animation: 'cmpFadeUp .4s ease both', animationDelay: `${delay}ms` }}
            >
              <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl ${barClass}`} />
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
              <p className="text-xl font-bold text-foreground">{value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
            </div>
          ))}
        </div>

        {/* tabs */}
        <div className="flex gap-1 bg-muted p-1 rounded-xl w-full sm:w-fit overflow-x-auto">
          {[
            { v: 'compras',     label: 'Compras',    Icono: ShoppingCart },
            { v: 'proveedores', label: 'Proveedores', Icono: Users },
          ].map(({ v, label, Icono }) => (
            <button
              key={v}
              onClick={() => setTab(v)}
              className={`shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                tab === v
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icono className="w-4 h-4" />{label}
            </button>
          ))}
        </div>

        {/* tab compras */}
        {tab === 'compras' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  value={buscar}
                  onChange={e => setBuscar(e.target.value)}
                  placeholder="Buscar por # o proveedor..."
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div className="flex gap-1 bg-muted p-1 rounded-xl overflow-x-auto">
                {[
                  { v: 'todos',    label: 'Todas' },
                  { v: 'pendiente', label: 'Pendientes' },
                  { v: 'recibido', label: 'Recibidas' },
                ].map(({ v, label }) => (
                  <button
                    key={v}
                    onClick={() => setFiltroEstado(v)}
                    className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      filtroEstado === v
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {loadingCompras ? (
              <div className="space-y-2">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-14 bg-muted rounded-xl animate-pulse" />
                ))}
              </div>
            ) : comprasFiltradas.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
                <ShoppingCart className="w-12 h-12 opacity-40" />
                <p className="text-sm">Sin compras{filtroEstado !== 'todos' ? ' con ese filtro' : ''}</p>
                {puedoCrear && (
                  <button onClick={() => setModalCompra(true)} className="text-primary text-sm font-medium hover:underline">
                    Crear primera compra
                  </button>
                )}
              </div>
            ) : (
              <>
                {/* mobile */}
                <div className="sm:hidden space-y-2">
                  {comprasFiltradas.map((c, i) => (
                    <CompraCard key={c.id} compra={c} idx={i} puedoRecibir={puedoRecibir} onRecibir={(id) => mutRecibir.mutate(id)} />
                  ))}
                </div>
                {/* desktop */}
                <div className="hidden sm:block bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted">
                          {['Fecha', '#', 'Proveedor', 'Ítems', 'Total', 'Estado', ''].map(h => (
                            <th key={h} className={`px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide ${h === 'Total' ? 'text-right' : h === 'Ítems' ? 'text-center' : 'text-left'}`}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {comprasFiltradas.map((c, i) => (
                          <CompraRow key={c.id} compra={c} idx={i} puedoRecibir={puedoRecibir} onRecibir={(id) => mutRecibir.mutate(id)} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="px-4 py-2 border-t border-border text-xs text-muted-foreground">
                    {comprasFiltradas.length} compra{comprasFiltradas.length !== 1 ? 's' : ''}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* tab proveedores */}
        {tab === 'proveedores' && (
          <TabProveedores
            proveedores={proveedores}
            puedoCrear={puedoCrearProv}
            puedoEditar={puedoEditarProv}
            onCrear={() => setModalProv('nuevo')}
            onEditar={(p) => setModalProv(p)}
            onEliminar={(id) => mutEliminarProv.mutate(id)}
          />
        )}
      </div>
    </>
  );
}
