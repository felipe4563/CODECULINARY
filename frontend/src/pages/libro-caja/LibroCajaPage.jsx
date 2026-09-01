import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../../store/authStore';
import { getLibroCaja, getResumenLibroCaja, crearMovimiento } from '../../api/libroCaja';
import { getEstadoCajas, getSesiones } from '../../api/caja';
import Paginacion from '../../components/ui/Paginacion';
import {
  Plus, TrendingUp, TrendingDown, DollarSign,
  Search, Filter, X, ChevronDown, ChevronUp,
  ArrowUpCircle, ArrowDownCircle, BookOpen, CalendarRange,
} from 'lucide-react';

/* ─── Helpers ─────────────────────────────────────────────────── */
const tiene = (u, mod, acc) => u?.permisos?.includes(`${mod}.${acc}`);

const fmt = v =>
  `Bs ${parseFloat(v ?? 0).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtFecha = s =>
  new Date(s).toLocaleString('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const fmtFechaCorta = s =>
  new Date(s).toLocaleString('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric' });

/* ─── Badge tipo ──────────────────────────────────────────────── */
function BadgeTipo({ tipo }) {
  return tipo === 'ingreso'
    ? <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
        <ArrowUpCircle className="w-3 h-3" /> Ingreso
      </span>
    : <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400">
        <ArrowDownCircle className="w-3 h-3" /> Egreso
      </span>;
}

/* ─── Badge método ────────────────────────────────────────────── */
function BadgeMetodo({ metodo }) {
  const cfg = {
    efectivo:      'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
    qr:            'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400',
    transferencia: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400',
  };
  return (
    <span className={`px-2 py-0.5 rounded-md text-xs font-medium capitalize ${cfg[metodo] ?? 'bg-muted text-muted-foreground'}`}>
      {metodo}
    </span>
  );
}

/* ─── Modal Nuevo Movimiento ──────────────────────────────────── */
function ModalMovimiento({ cajaActiva, sesiones, onClose, onGuardar }) {
  const [form, setForm] = useState({
    tipo: 'ingreso',
    concepto: '',
    monto: '',
    metodo_pago: 'efectivo',
    sesion_caja_id: cajaActiva?.id ?? '',
  });
  const [err, setErr] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.concepto.trim()) return setErr('El concepto es requerido.');
    const monto = parseFloat(form.monto);
    if (!monto || monto <= 0) return setErr('El monto debe ser mayor a 0.');
    setErr('');
    onGuardar({
      tipo: form.tipo,
      concepto: form.concepto.trim(),
      monto,
      metodo_pago: form.metodo_pago,
      sesion_caja_id: form.sesion_caja_id || undefined,
    });
  };

  const isIngreso = form.tipo === 'ingreso';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-md border border-border animate-[dashFadeUp_0.3s_ease_both]">

        {/* header */}
        <div className={`rounded-t-2xl p-5 flex items-center justify-between ${isIngreso ? 'bg-emerald-50 dark:bg-emerald-500/10' : 'bg-rose-50 dark:bg-rose-500/10'}`}>
          <div className="flex items-center gap-2">
            {isIngreso
              ? <ArrowUpCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              : <ArrowDownCircle className="w-5 h-5 text-rose-600 dark:text-rose-400" />
            }
            <h2 className="text-base font-semibold text-foreground">Nuevo movimiento</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">

          {/* tipo */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Tipo de movimiento</label>
            <div className="flex gap-2">
              {[['ingreso', 'Ingreso', 'emerald'], ['egreso', 'Egreso', 'rose']].map(([val, lbl, clr]) => (
                <button
                  type="button" key={val}
                  onClick={() => set('tipo', val)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5 border-2 transition-all ${
                    form.tipo === val
                      ? clr === 'emerald'
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400 dark:border-emerald-500'
                        : 'border-rose-500 bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400 dark:border-rose-500'
                      : 'border-border text-muted-foreground hover:border-muted-foreground'
                  }`}
                >
                  {val === 'ingreso' ? <ArrowUpCircle className="w-3.5 h-3.5" /> : <ArrowDownCircle className="w-3.5 h-3.5" />}
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          {/* concepto */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Concepto *</label>
            <input
              type="text"
              value={form.concepto}
              onChange={e => set('concepto', e.target.value)}
              placeholder="Ej: Pago de proveedor, venta extra..."
              className="w-full px-3.5 py-2.5 rounded-xl border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
            />
          </div>

          {/* monto + método */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Monto (Bs) *</label>
              <input
                type="number"
                min="0.01" step="0.01"
                value={form.monto}
                onChange={e => set('monto', e.target.value)}
                placeholder="0.00"
                className="w-full px-3.5 py-2.5 rounded-xl border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Método de pago</label>
              <select
                value={form.metodo_pago}
                onChange={e => set('metodo_pago', e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="efectivo">Efectivo</option>
                <option value="qr">QR</option>
              </select>
            </div>
          </div>

          {/* sesión */}
          {sesiones?.length > 0 && (
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Sesión de caja (opcional)</label>
              <select
                value={form.sesion_caja_id}
                onChange={e => set('sesion_caja_id', e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">— Sin sesión —</option>
                {sesiones.map(s => (
                  <option key={s.id} value={s.id}>
                    #{s.id} · {fmtFechaCorta(s.abierto_en)} · {s.estado === 'abierta' ? '🟢 Abierta' : '🔴 Cerrada'}
                  </option>
                ))}
              </select>
            </div>
          )}

          {err && (
            <p className="text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 px-3 py-2 rounded-lg">{err}</p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors ${
                isIngreso ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
              }`}
            >
              Registrar {isIngreso ? 'ingreso' : 'egreso'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── Tarjeta mobile ──────────────────────────────────────────── */
function MovCard({ mov }) {
  const [open, setOpen] = useState(false);
  const isIngreso = mov.tipo === 'ingreso';
  return (
    <div className={`bg-card rounded-xl border shadow-sm overflow-hidden ${isIngreso ? 'border-emerald-100 dark:border-emerald-900/40' : 'border-rose-100 dark:border-rose-900/40'}`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full p-3.5 flex items-center gap-3 text-left"
      >
        <div className={`p-2 rounded-xl flex-shrink-0 ${isIngreso ? 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-rose-100 dark:bg-rose-500/15 text-rose-600 dark:text-rose-400'}`}>
          {isIngreso ? <ArrowUpCircle className="w-4 h-4" /> : <ArrowDownCircle className="w-4 h-4" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{mov.concepto}</p>
          <p className="text-xs text-muted-foreground">{fmtFecha(mov.creado_en)}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <p className={`text-sm font-bold ${isIngreso ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
            {isIngreso ? '+' : '-'}{fmt(mov.monto)}
          </p>
          {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>
      {open && (
        <div className="px-3.5 pb-3.5 pt-0 border-t border-border space-y-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-4 pt-2.5">
            <span>Tipo: <BadgeTipo tipo={mov.tipo} /></span>
            <span>Método: <BadgeMetodo metodo={mov.metodo_pago} /></span>
          </div>
          {mov.usuario && <p>Registrado por: <span className="font-medium text-foreground">{mov.usuario.nombre}</span></p>}
          {mov.sesion_caja && <p>Sesión: <span className="font-medium text-foreground">#{mov.sesion_caja.id}</span></p>}
        </div>
      )}
    </div>
  );
}

/* ─── Stat card ───────────────────────────────────────────────── */
function SummaryCard({ icono: Icono, titulo, valor, color, delay }) {
  const cfg = {
    emerald: { bar: 'bg-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-500/10', icon: 'text-emerald-600 dark:text-emerald-400', val: 'text-emerald-700 dark:text-emerald-300' },
    rose:    { bar: 'bg-rose-500',    bg: 'bg-rose-50 dark:bg-rose-500/10',       icon: 'text-rose-600 dark:text-rose-400',       val: 'text-rose-700 dark:text-rose-300' },
    primary: { bar: 'bg-primary',     bg: 'bg-primary/10',                       icon: 'text-primary',                            val: 'text-primary' },
  }[color];
  return (
    <div className="bg-card rounded-2xl border border-border p-4 flex items-center gap-3 shadow-sm relative overflow-hidden"
      style={{ animation: 'dashFadeUp 0.5s ease both', animationDelay: `${delay}ms` }}
    >
      <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl ${cfg.bar}`} />
      <div className={`p-2.5 rounded-xl ${cfg.bg} flex-shrink-0`}>
        <Icono className={`w-5 h-5 ${cfg.icon}`} />
      </div>
      <div>
        <p className="text-xs font-medium text-muted-foreground">{titulo}</p>
        <p className={`text-xl font-bold ${cfg.val}`}>{valor}</p>
      </div>
    </div>
  );
}

/* ─── Página principal ────────────────────────────────────────── */
export default function LibroCajaPage() {
  const { usuario } = useAuthStore();
  const qc = useQueryClient();

  const puedoVer    = tiene(usuario, 'libro_caja', 'ver');
  const puedoCrear  = tiene(usuario, 'libro_caja', 'crear');

  const [buscar,    setBuscar]    = useState('');
  const [buscarDebounced, setBuscarDebounced] = useState('');
  const [filtroTipo, setFiltroTipo] = useState('todos');   // todos | ingreso | egreso
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [pagina, setPagina] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [toast,     setToast]     = useState(null);

  const showToast = (msg, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  // Debounce simple del buscador — evita un fetch por tecla.
  useEffect(() => {
    const t = setTimeout(() => setBuscarDebounced(buscar), 400);
    return () => clearTimeout(t);
  }, [buscar]);

  const filtrosApi = {
    desde: desde || undefined,
    hasta: hasta || undefined,
    tipo: filtroTipo === 'todos' ? undefined : filtroTipo,
    busqueda: buscarDebounced || undefined,
  };

  // Cambiar cualquier filtro vuelve a la página 1 — si no, se puede quedar
  // en "página 8 de 2" tras estrechar el filtro. Se ajusta durante el render
  // (patrón recomendado por React) en vez de en un efecto, para evitar el
  // render en cascada de un setState síncrono dentro de useEffect.
  const filtrosKey = `${filtroTipo}|${desde}|${hasta}|${buscarDebounced}`;
  const [prevFiltrosKey, setPrevFiltrosKey] = useState(filtrosKey);
  if (filtrosKey !== prevFiltrosKey) {
    setPrevFiltrosKey(filtrosKey);
    setPagina(1);
  }

  /* ─── queries ───────────────────────────────────────────────── */
  const { data: pagina_datos, isLoading } = useQuery({
    queryKey: ['libro-caja', filtrosApi, pagina],
    queryFn: () => getLibroCaja({ ...filtrosApi, pagina }),
    enabled: puedoVer,
    staleTime: 30_000,
  });
  const movimientos = pagina_datos?.filas ?? [];
  const totalPaginas = pagina_datos?.total_paginas ?? 1;

  const { data: resumen } = useQuery({
    queryKey: ['libro-caja-resumen', filtrosApi],
    queryFn: () => getResumenLibroCaja(filtrosApi),
    enabled: puedoVer,
    staleTime: 30_000,
  });

  const { data: cajas = [] } = useQuery({
    queryKey: ['caja-estado', usuario?.sucursal_activa?.id],
    queryFn: () => getEstadoCajas(usuario?.sucursal_activa?.id),
    enabled: puedoCrear && !!usuario?.sucursal_activa?.id,
    staleTime: 60_000,
  });

  // sesión abierta del usuario actual (no la primera que aparezca en la sucursal), default del modal de movimiento
  const cajaActiva = cajas.map(c => c.sesion_abierta).find(s => s?.usuario_id === usuario?.id) ?? null;

  const { data: sesiones = [] } = useQuery({
    queryKey: ['sesiones-caja'],
    queryFn: getSesiones,
    enabled: puedoCrear,
    staleTime: 60_000,
  });

  /* ─── mutation crear ────────────────────────────────────────── */
  const mutCrear = useMutation({
    mutationFn: crearMovimiento,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['libro-caja'] });
      qc.invalidateQueries({ queryKey: ['libro-caja-resumen'] });
      setModalOpen(false);
      showToast('Movimiento registrado correctamente');
    },
    onError: (e) => showToast(e?.response?.data?.mensaje ?? 'Error al registrar', false),
  });

  /* ─── métricas ──────────────────────────────────────────────── */
  const totalIngresos = resumen?.total_ingresos ?? 0;
  const totalEgresos  = resumen?.total_egresos  ?? 0;
  const balance       = totalIngresos - totalEgresos;

  if (!puedoVer) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground gap-3">
        <BookOpen className="w-10 h-10 opacity-30" />
        <p className="text-sm">Sin permiso para ver el libro de caja.</p>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @keyframes dashFadeUp {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes toastIn {
          from { opacity: 0; transform: translateY(20px) scale(0.95); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>

      <div className="space-y-4">

        {/* ── Header ──────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3"
          style={{ animation: 'dashFadeUp 0.4s ease both' }}
        >
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-primary/10 rounded-xl">
              <BookOpen className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-bold text-foreground">Libro de Caja</h1>
              <p className="text-xs text-muted-foreground">Historial de ingresos y egresos</p>
            </div>
          </div>
          {puedoCrear && (
            <button
              onClick={() => setModalOpen(true)}
              className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2.5 rounded-xl text-sm font-semibold shadow-sm shadow-primary/30 transition-all hover:shadow-md hover:-translate-y-0.5"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Nuevo registro</span>
            </button>
          )}
        </div>

        {/* ── Resumen ─────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <SummaryCard icono={TrendingUp}   titulo="Total ingresos"  valor={fmt(totalIngresos)} color="emerald" delay={80}  />
          <SummaryCard icono={TrendingDown} titulo="Total egresos"   valor={fmt(totalEgresos)}  color="rose"    delay={140} />
          <SummaryCard icono={DollarSign}   titulo="Balance neto"    valor={fmt(balance)}        color="primary" delay={200} />
        </div>

        {/* ── Filtros ─────────────────────────────────────────── */}
        <div className="bg-card rounded-2xl border border-border p-3 sm:p-4 shadow-sm"
          style={{ animation: 'dashFadeUp 0.5s ease both', animationDelay: '240ms' }}
        >
          <div className="flex flex-col sm:flex-row gap-3">
            {/* búsqueda */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Buscar por concepto, usuario..."
                value={buscar}
                onChange={e => setBuscar(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-xl border border-input bg-muted text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
              />
              {buscar && (
                <button onClick={() => setBuscar('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* filtro tipo */}
            <div className="flex items-center gap-1 bg-muted rounded-xl p-1">
              <Filter className="w-4 h-4 text-muted-foreground ml-1.5 flex-shrink-0" />
              {[['todos', 'Todos'], ['ingreso', 'Ingresos'], ['egreso', 'Egresos']].map(([val, lbl]) => (
                <button
                  key={val}
                  onClick={() => setFiltroTipo(val)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    filtroTipo === val
                      ? val === 'ingreso' ? 'bg-emerald-600 text-white shadow-sm'
                        : val === 'egreso' ? 'bg-rose-600 text-white shadow-sm'
                        : 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          {/* filtro de fechas */}
          <div className="flex flex-wrap items-end gap-3 mt-3">
            <div className="flex items-center gap-1.5 text-muted-foreground shrink-0">
              <CalendarRange className="w-4 h-4" />
              <span className="text-xs font-semibold uppercase tracking-wide">Rango de fechas</span>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Desde</label>
              <input
                type="date" value={desde} onChange={e => setDesde(e.target.value)}
                max={hasta || undefined}
                className="px-3 py-1.5 rounded-lg border border-input bg-background text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Hasta</label>
              <input
                type="date" value={hasta} onChange={e => setHasta(e.target.value)}
                min={desde || undefined}
                className="px-3 py-1.5 rounded-lg border border-input bg-background text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            {(desde || hasta) && (
              <button
                onClick={() => { setDesde(''); setHasta(''); }}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                <X className="w-3.5 h-3.5" /> Limpiar
              </button>
            )}
          </div>

          {/* contador */}
          <p className="text-xs text-muted-foreground mt-2.5">
            {pagina_datos?.total ?? 0} registro{(pagina_datos?.total ?? 0) !== 1 ? 's' : ''}
            {(buscar || filtroTipo !== 'todos' || desde || hasta) ? ' encontrados' : ' en total'}
          </p>
        </div>

        {/* ── Skeleton loading ────────────────────────────────── */}
        {isLoading && (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="bg-card rounded-xl border border-border p-4 animate-pulse h-16" />
            ))}
          </div>
        )}

        {/* ── Sin resultados ───────────────────────────────────── */}
        {!isLoading && movimientos.length === 0 && (
          <div className="bg-card rounded-2xl border border-border py-16 flex flex-col items-center gap-3 text-muted-foreground shadow-sm">
            <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center">
              <BookOpen className="w-7 h-7 opacity-40" />
            </div>
            <p className="text-sm font-medium">Sin movimientos registrados</p>
            {buscar && <p className="text-xs">Prueba con otro término de búsqueda</p>}
            {puedoCrear && !buscar && (
              <button onClick={() => setModalOpen(true)} className="mt-1 text-xs text-primary font-medium hover:underline">
                Registrar primer movimiento
              </button>
            )}
          </div>
        )}

        {/* ── Mobile: cards ───────────────────────────────────── */}
        {!isLoading && movimientos.length > 0 && (
          <div className="sm:hidden space-y-2">
            {movimientos.map((m, i) => (
              <div key={m.id} style={{ animation: 'dashFadeUp 0.4s ease both', animationDelay: `${i * 30}ms` }}>
                <MovCard mov={m} />
              </div>
            ))}
          </div>
        )}

        {/* ── Desktop: tabla ───────────────────────────────────── */}
        {!isLoading && movimientos.length > 0 && (
          <div className="hidden sm:block bg-card rounded-2xl border border-border shadow-sm overflow-hidden"
            style={{ animation: 'dashFadeUp 0.5s ease both', animationDelay: '280ms' }}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Fecha</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Concepto</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tipo</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Método</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Monto</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Usuario</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Sesión</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {movimientos.map((m, i) => (
                    <tr
                      key={m.id}
                      className="hover:bg-muted/50 transition-colors"
                      style={{ animation: 'dashFadeUp 0.35s ease both', animationDelay: `${i * 20}ms` }}
                    >
                      <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">
                        {fmtFecha(m.creado_en)}
                      </td>
                      <td className="px-4 py-3 text-foreground font-medium max-w-[220px]">
                        <span className="line-clamp-1">{m.concepto}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <BadgeTipo tipo={m.tipo} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <BadgeMetodo metodo={m.metodo_pago} />
                      </td>
                      <td className={`px-4 py-3 text-right font-bold tabular-nums ${m.tipo === 'ingreso' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                        {m.tipo === 'ingreso' ? '+' : '-'}{fmt(m.monto)}
                      </td>
                      <td className="px-4 py-3 text-foreground text-xs">
                        {m.usuario?.nombre ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-center text-xs text-muted-foreground">
                        {m.sesion_caja ? `#${m.sesion_caja.id}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>

                {/* footer con totales */}
                <tfoot>
                  <tr className="bg-muted border-t-2 border-border">
                    <td colSpan={4} className="px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">
                      Totales ({pagina_datos?.total ?? 0} registros)
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold">+{fmt(totalIngresos)}</span>
                        <span className="text-xs text-rose-600 dark:text-rose-400 font-semibold">-{fmt(totalEgresos)}</span>
                        <span className={`text-sm font-bold border-t border-border pt-0.5 ${balance >= 0 ? 'text-primary' : 'text-rose-600 dark:text-rose-400'}`}>
                          {fmt(balance)}
                        </span>
                      </div>
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* ── Paginación ────────────────────────────────────────── */}
        {!isLoading && movimientos.length > 0 && (
          <Paginacion pagina={pagina} totalPaginas={totalPaginas} onCambiar={setPagina} />
        )}
      </div>

      {/* ── Modal ───────────────────────────────────────────────── */}
      {modalOpen && (
        <ModalMovimiento
          cajaActiva={cajaActiva}
          sesiones={sesiones}
          onClose={() => setModalOpen(false)}
          onGuardar={datos => mutCrear.mutate(datos)}
        />
      )}

      {/* ── Toast ───────────────────────────────────────────────── */}
      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-3 rounded-2xl text-sm font-medium text-white shadow-xl flex items-center gap-2 ${toast.ok ? 'bg-emerald-600' : 'bg-rose-600'}`}
          style={{ animation: 'toastIn 0.3s ease both' }}
        >
          {toast.ok ? <ArrowUpCircle className="w-4 h-4" /> : <X className="w-4 h-4" />}
          {toast.msg}
        </div>
      )}
    </>
  );
}
