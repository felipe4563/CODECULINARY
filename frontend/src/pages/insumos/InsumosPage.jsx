import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePermisos } from '../../hooks/usePermisos';
import { useAuth } from '../../hooks/useAuth';
import {
  getInsumos, crearInsumo, actualizarInsumo, desactivarInsumo,
  ajustarStockInsumo, getReporteComprasInsumos,
} from '../../api/insumos';
import { getConfiguracion, logoSrc } from '../../api/configuracion';
import { exportarPDF } from '../reportes/utils/exportarPDF';
import { fecha as fmtFechaCorta } from '../reportes/shared';
import { Wheat, Plus, Pencil, Trash2, SlidersHorizontal, Search, X, AlertTriangle, Wallet, Calendar, Download } from 'lucide-react';

const UNIDADES = [
  { v: 'kilogramo', label: 'Kilogramo (kg)' },
  { v: 'gramo', label: 'Gramo (g)' },
  { v: 'litro', label: 'Litro (L)' },
  { v: 'mililitro', label: 'Mililitro (ml)' },
  { v: 'arroba', label: 'Arroba' },
  { v: 'libra', label: 'Libra' },
  { v: 'unidad', label: 'Unidad' },
];

const unidadLabel = (v) => UNIDADES.find(u => u.v === v)?.label ?? v;
const fmt = (n) => Number(n ?? 0).toLocaleString('es-BO', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
const fmtBs = (n) => `Bs ${Number(n ?? 0).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const aISO = (d) => d.toISOString().slice(0, 10);
function rangoEsteMes() {
  const hoy = new Date();
  return { desde: aISO(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), hasta: aISO(hoy) };
}
function rangoMesPasado() {
  const hoy = new Date();
  const inicio = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  const fin = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
  return { desde: aISO(inicio), hasta: aISO(fin) };
}

/* ─── modal crear/editar insumo ─── */
function ModalInsumo({ insumo, onClose, onGuardar }) {
  const [nombre, setNombre] = useState(insumo?.nombre ?? '');
  const [unidad_medida, setUnidad] = useState(insumo?.unidad_medida ?? 'kilogramo');
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!nombre.trim()) { setError('El nombre es requerido'); return; }
    setError('');
    onGuardar({ nombre: nombre.trim(), unidad_medida });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-md border border-border">
        <div className="px-6 py-4 rounded-t-2xl bg-primary flex items-center justify-between">
          <h2 className="text-primary-foreground font-semibold text-base">{insumo ? 'Editar insumo' : 'Nuevo insumo'}</h2>
          <button onClick={onClose} className="text-primary-foreground/80 hover:text-primary-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">Nombre</label>
            <input
              value={nombre}
              onChange={e => setNombre(e.target.value)}
              placeholder="Ej. Pulpa de fresa"
              className="w-full rounded-xl border border-input bg-background text-foreground px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">Unidad de medida</label>
            <select
              value={unidad_medida}
              onChange={e => setUnidad(e.target.value)}
              className="w-full rounded-xl border border-input bg-background text-foreground px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {UNIDADES.map(u => <option key={u.v} value={u.v}>{u.label}</option>)}
            </select>
          </div>

          {error && (
            <p className="text-rose-600 dark:text-rose-400 text-sm flex items-center gap-1">
              <AlertTriangle className="w-4 h-4" />{error}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors">
              Cancelar
            </button>
            <button type="submit" className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-primary hover:bg-primary/90 transition-colors">
              Guardar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── modal ajuste de stock ─── */
function ModalAjusteStock({ insumo, onClose, onGuardar }) {
  const [cantidad, setCantidad] = useState(insumo.stock ?? 0);
  const [nota, setNota] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (cantidad === '' || Number(cantidad) < 0) { setError('Ingresá el nuevo stock (0 o más)'); return; }
    setError('');
    onGuardar({ cantidad: Number(cantidad), nota });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-sm border border-border">
        <div className="px-6 py-4 rounded-t-2xl bg-amber-600 flex items-center justify-between">
          <h2 className="text-white font-semibold text-base">Ajustar stock — {insumo.nombre}</h2>
          <button onClick={onClose} className="text-white/80 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <p className="text-xs text-muted-foreground">
            Stock actual: <span className="font-semibold text-foreground">{fmt(insumo.stock)} {unidadLabel(insumo.unidad_medida)}</span> en tu sucursal.
          </p>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">Nuevo stock</label>
            <input
              type="number" step="0.001" min="0"
              value={cantidad}
              onChange={e => setCantidad(e.target.value)}
              className="w-full rounded-xl border border-input bg-background text-foreground px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">Nota (opcional)</label>
            <input
              value={nota}
              onChange={e => setNota(e.target.value)}
              placeholder="Motivo del ajuste..."
              className="w-full rounded-xl border border-input bg-background text-foreground px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {error && (
            <p className="text-rose-600 dark:text-rose-400 text-sm flex items-center gap-1">
              <AlertTriangle className="w-4 h-4" />{error}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors">
              Cancelar
            </button>
            <button type="submit" className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 transition-colors">
              Ajustar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── página principal ─── */
export default function InsumosPage() {
  const { tienePermiso } = usePermisos();
  const qc = useQueryClient();

  const puedoVer = tienePermiso('insumos', 'ver');
  const puedoCrear = tienePermiso('insumos', 'crear');
  const puedoEditar = tienePermiso('insumos', 'editar');
  const puedoEliminar = tienePermiso('insumos', 'eliminar');

  const [buscar, setBuscar] = useState('');
  const [modalInsumo, setModalInsumo] = useState(null); // null | 'nuevo' | insumo
  const [modalAjuste, setModalAjuste] = useState(null); // null | insumo
  const [toast, setToast] = useState(null);
  const [rango, setRango] = useState(rangoEsteMes);

  const mostrarToast = (msg, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  const { data: insumos = [], isLoading } = useQuery({
    queryKey: ['insumos'],
    queryFn: getInsumos,
    enabled: puedoVer,
  });

  const { data: reporteCompras = [], isLoading: cargandoReporte } = useQuery({
    queryKey: ['insumos-reporte-compras', rango.desde, rango.hasta],
    queryFn: () => getReporteComprasInsumos(rango),
    enabled: puedoVer,
  });

  const totalGastadoRango = useMemo(
    () => reporteCompras.reduce((s, r) => s + Number(r.monto_total ?? 0), 0),
    [reporteCompras]
  );

  const { usuario } = useAuth();
  const { data: config = {} } = useQuery({ queryKey: ['configuracion'], queryFn: getConfiguracion });

  const exportarReportePDF = () => exportarPDF({
    titulo:        'Compras de Insumos',
    subtitulo:     `${fmtFechaCorta(rango.desde)} — ${fmtFechaCorta(rango.hasta)}`,
    empresa:       config.nombre_negocio || 'RESTAURANTE',
    logo:          logoSrc(config.logo),
    direccion:     config.direccion,
    telefono:      config.telefono,
    generadoPor:   usuario?.nombre,
    columnas:      ['Insumo', 'Unidad', 'Cantidad comprada', 'Gastado'],
    filas:         reporteCompras.map(r => [
      r.nombre ?? `#${r.insumo_id}`,
      unidadLabel(r.unidad_medida),
      fmt(r.cantidad_total),
      fmtBs(r.monto_total),
    ]),
    totales: [
      { label: 'Insumos comprados', valor: reporteCompras.length },
      { label: 'Total gastado',     valor: fmtBs(totalGastadoRango) },
    ],
    nombreArchivo: `compras-insumos-${rango.desde}-${rango.hasta}.pdf`,
  });

  const mutCrear = useMutation({
    mutationFn: crearInsumo,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['insumos'] }); setModalInsumo(null); mostrarToast('Insumo creado'); },
    onError: (err) => mostrarToast(err?.response?.data?.mensaje ?? 'Error al crear', false),
  });

  const mutActualizar = useMutation({
    mutationFn: ({ id, datos }) => actualizarInsumo(id, datos),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['insumos'] }); setModalInsumo(null); mostrarToast('Insumo actualizado'); },
    onError: (err) => mostrarToast(err?.response?.data?.mensaje ?? 'Error al actualizar', false),
  });

  const mutDesactivar = useMutation({
    mutationFn: desactivarInsumo,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['insumos'] }); mostrarToast('Insumo desactivado'); },
    onError: (err) => mostrarToast(err?.response?.data?.mensaje ?? 'Error al desactivar', false),
  });

  const mutAjustar = useMutation({
    mutationFn: ({ id, datos }) => ajustarStockInsumo(id, datos),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['insumos'] }); setModalAjuste(null); mostrarToast('Stock ajustado'); },
    onError: (err) => mostrarToast(err?.response?.data?.mensaje ?? 'Error al ajustar stock', false),
  });

  const insumosFiltrados = useMemo(() => {
    if (!buscar.trim()) return insumos;
    const q = buscar.toLowerCase();
    return insumos.filter(i => i.nombre.toLowerCase().includes(q));
  }, [insumos, buscar]);

  if (!puedoVer) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
        <Wheat className="w-12 h-12" />
        <p className="text-sm">Sin acceso a insumos</p>
      </div>
    );
  }

  return (
    <>
      <style>{`@keyframes toastIn { from { opacity:0; transform:translateX(20px); } to { opacity:1; transform:translateX(0); } }`}</style>

      {toast && (
        <div
          className={`fixed top-5 right-5 z-[100] px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white flex items-center gap-2 ${toast.ok ? 'bg-emerald-600' : 'bg-rose-600'}`}
          style={{ animation: 'toastIn .25s ease both' }}
        >
          {toast.ok ? '✓' : '✕'} {toast.msg}
        </div>
      )}

      {modalInsumo && (
        <ModalInsumo
          insumo={modalInsumo === 'nuevo' ? null : modalInsumo}
          onClose={() => setModalInsumo(null)}
          onGuardar={(datos) => modalInsumo === 'nuevo' ? mutCrear.mutate(datos) : mutActualizar.mutate({ id: modalInsumo.id, datos })}
        />
      )}

      {modalAjuste && (
        <ModalAjusteStock
          insumo={modalAjuste}
          onClose={() => setModalAjuste(null)}
          onGuardar={(datos) => mutAjustar.mutate({ id: modalAjuste.id, datos })}
        />
      )}

      <div className="space-y-6">
        <div className="rounded-2xl p-5 sm:p-6 bg-primary text-primary-foreground relative overflow-hidden">
          <div className="absolute -top-6 -right-6 w-32 h-32 bg-primary-foreground/10 rounded-full" />
          <div className="absolute -bottom-4 -right-16 w-48 h-48 bg-primary-foreground/5 rounded-full" />
          <div className="relative flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold">Insumos</h1>
              <p className="text-primary-foreground/70 text-sm mt-0.5">Ingredientes de cocina, su stock y consumo por receta</p>
            </div>
            {puedoCrear && (
              <button
                onClick={() => setModalInsumo('nuevo')}
                className="flex items-center gap-2 bg-primary-foreground text-primary px-4 py-2 rounded-xl text-sm font-semibold shadow hover:shadow-md transition-all hover:scale-[1.02]"
              >
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">Nuevo insumo</span>
                <span className="sm:hidden">Nuevo</span>
              </button>
            )}
          </div>
        </div>

        <div className="bg-card rounded-2xl border border-border shadow-sm p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-violet-100 dark:bg-violet-500/15 flex items-center justify-center shrink-0">
                <Wallet className="w-5 h-5 text-violet-600 dark:text-violet-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Gastado en insumos (compras) en el rango elegido</p>
                <p className="text-lg font-bold text-foreground">{fmtBs(totalGastadoRango)}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex gap-1 bg-muted p-1 rounded-lg">
                <button
                  onClick={() => setRango(rangoEsteMes())}
                  className="px-2.5 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  Este mes
                </button>
                <button
                  onClick={() => setRango(rangoMesPasado())}
                  className="px-2.5 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  Mes pasado
                </button>
              </div>
              <div className="flex items-center gap-1.5 text-xs">
                <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                <input
                  type="date"
                  value={rango.desde}
                  onChange={e => setRango(r => ({ ...r, desde: e.target.value }))}
                  className="rounded-lg border border-input bg-background text-foreground px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <span className="text-muted-foreground">a</span>
                <input
                  type="date"
                  value={rango.hasta}
                  onChange={e => setRango(r => ({ ...r, hasta: e.target.value }))}
                  className="rounded-lg border border-input bg-background text-foreground px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <button
                onClick={exportarReportePDF}
                disabled={!reporteCompras.length}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors disabled:opacity-40"
              >
                <Download className="w-3.5 h-3.5" /> Exportar PDF
              </button>
            </div>
          </div>

          {cargandoReporte ? (
            <div className="h-10 bg-muted rounded-xl animate-pulse" />
          ) : reporteCompras.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">Sin compras de insumos en este rango.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="py-1.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Insumo</th>
                    <th className="py-1.5 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Cantidad comprada</th>
                    <th className="py-1.5 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Gastado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {reporteCompras.map(r => (
                    <tr key={r.insumo_id}>
                      <td className="py-1.5 text-foreground font-medium">{r.nombre ?? `#${r.insumo_id}`}</td>
                      <td className="py-1.5 text-right text-muted-foreground">{fmt(r.cantidad_total)} {unidadLabel(r.unidad_medida)}</td>
                      <td className="py-1.5 text-right font-semibold text-foreground">{fmtBs(r.monto_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={buscar}
            onChange={e => setBuscar(e.target.value)}
            placeholder="Buscar insumo..."
            className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => <div key={i} className="h-14 bg-muted rounded-xl animate-pulse" />)}
          </div>
        ) : insumosFiltrados.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
            <Wheat className="w-12 h-12 opacity-40" />
            <p className="text-sm">Sin insumos{buscar ? ' con ese filtro' : ''}</p>
            {puedoCrear && !buscar && (
              <button onClick={() => setModalInsumo('nuevo')} className="text-primary text-sm font-medium hover:underline">
                Crear el primer insumo
              </button>
            )}
          </div>
        ) : (
          <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Nombre</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Unidad</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Stock</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {insumosFiltrados.map((i) => (
                    <tr key={i.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-3 font-medium text-foreground">{i.nombre}</td>
                      <td className="px-4 py-3 text-muted-foreground">{unidadLabel(i.unidad_medida)}</td>
                      <td className={`px-4 py-3 text-right font-semibold ${Number(i.stock) < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-foreground'}`}>
                        {fmt(i.stock)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 justify-end">
                          {puedoEditar && (
                            <button onClick={() => setModalAjuste(i)} title="Ajustar stock" className="p-1.5 rounded-lg text-amber-600 hover:bg-amber-100 dark:hover:bg-amber-500/15 transition-colors">
                              <SlidersHorizontal className="w-4 h-4" />
                            </button>
                          )}
                          {puedoEditar && (
                            <button onClick={() => setModalInsumo(i)} title="Editar" className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-100 dark:hover:bg-blue-500/15 transition-colors">
                              <Pencil className="w-4 h-4" />
                            </button>
                          )}
                          {puedoEliminar && (
                            <button onClick={() => mutDesactivar.mutate(i.id)} title="Desactivar" className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-100 dark:hover:bg-rose-500/15 transition-colors">
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
            <div className="px-4 py-2 border-t border-border text-xs text-muted-foreground">
              {insumosFiltrados.length} insumo{insumosFiltrados.length !== 1 ? 's' : ''}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
