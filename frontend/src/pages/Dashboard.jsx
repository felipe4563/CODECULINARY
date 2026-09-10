import { useMemo, useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { useAuthStore } from '../store/authStore';
import { useThemeStore } from '../store/themeStore';
import { getVentas } from '../api/ventas';
import { getEstadoCajas } from '../api/caja';
import { getLibroCaja } from '../api/libroCaja';
import { getUsuarios } from '../api/usuarios';
import { getInsumos } from '../api/insumos';
import { getSucursales } from '../api/sucursales';
import socket from '../socket';
import {
  TrendingUp, TrendingDown, PiggyBank, ShoppingBag, Wallet, XCircle, CalendarDays, Receipt, ArrowUpRight, ArrowDownRight,
  Trophy, Ticket, Gift, UserPlus, UserCheck, Wheat,
} from 'lucide-react';
import EstadoAgentesImpresion from '../components/dashboard/EstadoAgentesImpresion';

/* ─── Paleta de colores ───────────────────────────────────────── */
const PALETA = ['#6366f1','#10b981','#f59e0b','#ec4899','#3b82f6','#14b8a6','#f97316','#8b5cf6'];

const COLORES_METODO = {
  efectivo:      '#10b981',
  qr:            '#6366f1',
  transferencia: '#f59e0b',
  otro:          '#94a3b8',
};

const COLOR_GASTOS = '#f97316';
const DIAS_SEMANA = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

const MESES      = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const MESES_FULL = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const AÑOS       = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);

/* ─── Helpers ─────────────────────────────────────────────────── */
const tiene = (u, mod, acc) => u?.permisos?.includes(`${mod}.${acc}`);

const fmt = v =>
  `Bs ${parseFloat(v ?? 0).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Fecha en formato YYYY-MM-DD / YYYY-MM usando la hora LOCAL del navegador,
// no UTC. `.toISOString()` siempre da la fecha en UTC — en Bolivia (UTC-4)
// eso hace que una venta hecha entre las 20:00 y medianoche caiga en el día
// siguiente al comparar, mostrando ventas de "anoche" como si fueran de "hoy".
const fechaLocalYMD = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fechaLocalYM = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

const saludo = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Buenos días';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
};

/* ─── Tooltips ────────────────────────────────────────────────── */
const CLAVES_MONEDA = ['total', 'ingresos', 'gastos'];

function TooltipVentas({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-2xl shadow-xl px-3.5 py-2.5 text-xs min-w-[110px]">
      <p className="font-semibold text-foreground mb-1.5 border-b border-border pb-1">{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} className="flex items-center gap-1.5 mt-0.5" style={{ color: p.color }}>
          <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: p.color }} />
          {p.name}: <span className="font-medium">{CLAVES_MONEDA.includes(p.dataKey) ? fmt(p.value) : p.value}</span>
        </p>
      ))}
    </div>
  );
}

function TooltipPie({ active, payload }) {
  if (!active || !payload?.length) return null;
  const { name, value, percent } = payload[0];
  return (
    <div className="bg-card border border-border rounded-2xl shadow-xl px-3.5 py-2.5 text-xs">
      <p className="font-semibold text-foreground capitalize mb-0.5">{name}</p>
      <p className="text-muted-foreground">{fmt(value)}</p>
      <p className="font-bold" style={{ color: payload[0].payload.fill }}>{(percent * 100).toFixed(1)}%</p>
    </div>
  );
}

function TooltipBar({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-2xl shadow-xl px-3.5 py-2.5 text-xs">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      <p className="font-medium" style={{ color: payload[0].fill ?? payload[0].color }}>
        {payload[0].value} unidades
      </p>
    </div>
  );
}

/* ─── Stat Card ───────────────────────────────────────────────── */
const CARD_PALETTE = {
  blue:    { bg: 'bg-blue-50 dark:bg-blue-500/10',    icon: 'text-blue-600 dark:text-blue-400',    bar: 'bg-blue-500',    val: 'text-blue-700 dark:text-blue-300' },
  emerald: { bg: 'bg-emerald-50 dark:bg-emerald-500/10', icon: 'text-emerald-600 dark:text-emerald-400', bar: 'bg-emerald-500', val: 'text-emerald-700 dark:text-emerald-300' },
  amber:   { bg: 'bg-amber-50 dark:bg-amber-500/10',  icon: 'text-amber-600 dark:text-amber-400',  bar: 'bg-amber-500',   val: 'text-amber-700 dark:text-amber-300' },
  red:     { bg: 'bg-red-50 dark:bg-red-500/10',      icon: 'text-red-500 dark:text-red-400',      bar: 'bg-red-500',     val: 'text-red-700 dark:text-red-300' },
  orange:  { bg: 'bg-orange-50 dark:bg-orange-500/10', icon: 'text-orange-600 dark:text-orange-400', bar: 'bg-orange-500', val: 'text-orange-700 dark:text-orange-300' },
  violet:  { bg: 'bg-violet-50 dark:bg-violet-500/10', icon: 'text-violet-600 dark:text-violet-400', bar: 'bg-violet-500', val: 'text-violet-700 dark:text-violet-300' },
};

// Compara el valor actual contra el del período anterior. `anterior === 0`
// no tiene base para calcular un % (división por cero), así que se muestra
// "Nuevo" en vez de un porcentaje engañoso. `positivoEsBueno = false` invierte
// los colores para métricas donde subir es malo (gastos, cancelaciones).
function DeltaBadge({ actual, anterior, positivoEsBueno = true }) {
  if (!anterior && !actual) return null;
  if (!anterior) {
    return <span className="text-[11px] font-semibold text-muted-foreground">Nuevo</span>;
  }
  const pct = ((actual - anterior) / anterior) * 100;
  const subio = pct >= 0;
  const esBueno = positivoEsBueno ? subio : !subio;
  const Icono = subio ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      title="vs. período anterior"
      className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${esBueno ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}
    >
      <Icono className="w-3 h-3" />{Math.abs(pct).toFixed(1)}%
    </span>
  );
}

function StatCard({ icono: Icono, titulo, valor, sub, color, cargando, delay = 0, delta }) {
  const c = CARD_PALETTE[color];
  return (
    <div
      className="bg-card rounded-2xl border border-border p-4 flex items-start gap-3 shadow-sm hover:shadow-md transition-shadow overflow-hidden relative"
      style={{ animation: `dashFadeUp 0.5s ease both`, animationDelay: `${delay}ms` }}
    >
      <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl ${c.bar}`} />
      <div className={`p-2.5 rounded-xl flex-shrink-0 ${c.bg}`}>
        <Icono className={`w-4 h-4 sm:w-5 sm:h-5 ${c.icon}`} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-muted-foreground">{titulo}</p>
        {cargando
          ? <div className="h-7 w-24 mt-1 rounded-lg bg-muted animate-pulse" />
          : (
            <div className="flex items-center gap-2 flex-wrap">
              <p className={`text-xl sm:text-2xl font-bold leading-tight mt-0.5 ${c.val}`}>{valor}</p>
              {delta}
            </div>
          )
        }
        {sub && !cargando && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

/* ─── Chart Card ──────────────────────────────────────────────── */
function ChartCard({ titulo, accent = 'hsl(var(--primary))', children, delay = 0 }) {
  return (
    <div
      className="bg-card rounded-2xl border border-border p-4 sm:p-5 shadow-sm"
      style={{ animation: `dashFadeUp 0.5s ease both`, animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center gap-2 mb-4">
        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: accent }} />
        <h3 className="text-sm font-semibold text-foreground">{titulo}</h3>
      </div>
      {children}
    </div>
  );
}

/* ─── Leaderboard (top cajeros / top sucursales) ─────────────────── */
const MEDALLAS = ['🥇', '🥈', '🥉'];

function Leaderboard({ items, colorBarra = 'bg-primary' }) {
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground text-center py-10">Sin datos en el período</p>;
  }
  const max = Math.max(...items.map(i => i.valor));
  return (
    <div className="space-y-2.5">
      {items.map((it, i) => (
        <div key={it.nombre + i} className="flex items-center gap-2.5">
          <span className="w-5 text-center text-xs shrink-0">{MEDALLAS[i] ?? `${i + 1}º`}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-xs font-medium text-foreground truncate">{it.nombre}</span>
              <span className="text-xs font-semibold text-foreground shrink-0">{fmt(it.valor)}</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full ${colorBarra} transition-all duration-700`}
                style={{ width: `${max > 0 ? (it.valor / max) * 100 : 0}%` }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── Legend personalizada para pie ──────────────────────────– */
function LeyendaPie({ payload }) {
  if (!payload?.length) return null;
  return (
    <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-2">
      {payload.map(e => (
        <li key={e.value} className="flex items-center gap-1.5 text-xs text-muted-foreground capitalize">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: e.color }} />
          {e.value}
        </li>
      ))}
    </ul>
  );
}

/* ─── Hook tamaño pantalla ────────────────────────────────────── */
function useScreenSize() {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const fn = () => setWidth(window.innerWidth);
    window.addEventListener('resize', fn);
    return () => window.removeEventListener('resize', fn);
  }, []);
  return { isXs: width < 480, isSm: width < 640, isMd: width < 768 };
}

/* ─── Dashboard ───────────────────────────────────────────────── */
export default function Dashboard() {
  const { usuario } = useAuthStore();
  const { modo }    = useThemeStore();
  const isDark      = modo === 'dark';
  const { isXs, isSm } = useScreenSize();
  const qc = useQueryClient();

  const gridColor  = isDark ? '#1f2937' : '#f9fafb';
  const tickColor  = isDark ? '#9ca3af' : '#6b7280';
  const tickSize   = isSm ? 9 : 11;
  const yAxisW     = isSm ? 38 : 50;
  const yAxisWProd = isXs ? 70 : isSm ? 80 : 95;
  const yAxisWNum  = isSm ? 22 : 28;

  const puedeVerVentas   = tiene(usuario, 'ventas', 'ver');
  const puedeVerCaja     = tiene(usuario, 'caja', 'ver');
  const puedeVerGastos   = tiene(usuario, 'libro_caja', 'ver');
  const puedeVerUsuarios = tiene(usuario, 'usuarios', 'ver');
  const puedeVerInsumos  = tiene(usuario, 'insumos', 'ver');
  const accesoTodas      = usuario?.sucursal_activa?.id == null;

  const hoy = new Date();
  const [tipo,   setTipo]   = useState('mes');
  const [diaVal, setDiaVal] = useState(fechaLocalYMD(hoy));
  const [mesVal, setMesVal] = useState(fechaLocalYM(hoy));
  const [añoVal, setAñoVal] = useState(String(hoy.getFullYear()));

  /* ─── queries ───────────────────────────────────────────────── */
  // El socket (ver más abajo) empuja la actualización al instante ante
  // cualquier venta/gasto nuevo; este polling queda solo como respaldo por
  // si el socket se desconecta.
  const { data: ventas = [], isLoading: cvVentas } = useQuery({
    queryKey: ['ventas-dashboard'],
    queryFn: getVentas,
    enabled: puedeVerVentas,
    refetchInterval: 5 * 60_000,
    staleTime: 30_000,
  });

  const { data: cajas = [] } = useQuery({
    queryKey: ['caja-estado', usuario?.sucursal_activa?.id],
    queryFn: () => getEstadoCajas(usuario?.sucursal_activa?.id),
    enabled: puedeVerCaja && !!usuario?.sucursal_activa?.id,
    refetchInterval: 5 * 60_000,
    staleTime: 30_000,
  });

  const { data: usuarios = [] } = useQuery({
    queryKey: ['usuarios-dashboard'],
    queryFn: getUsuarios,
    enabled: puedeVerVentas && puedeVerUsuarios,
    staleTime: 5 * 60_000,
  });

  const { data: insumos = [] } = useQuery({
    queryKey: ['insumos-dashboard'],
    queryFn: getInsumos,
    enabled: puedeVerInsumos,
    staleTime: 60_000,
  });

  const { data: sucursales = [] } = useQuery({
    queryKey: ['sucursales-dashboard'],
    queryFn: getSucursales,
    enabled: puedeVerVentas && accesoTodas,
    staleTime: 5 * 60_000,
  });

  // Rango de fechas ISO que cubre el período elegido en el selector
  // día/mes/año — mismo criterio que ya usan los reportes.
  const rangoLibroCaja = useMemo(() => {
    if (tipo === 'dia') return { desde: diaVal, hasta: diaVal };
    if (tipo === 'mes') {
      const [y, m] = mesVal.split('-').map(Number);
      const ultimoDia = new Date(y, m, 0).getDate();
      return { desde: `${mesVal}-01`, hasta: `${mesVal}-${String(ultimoDia).padStart(2, '0')}` };
    }
    return { desde: `${añoVal}-01-01`, hasta: `${añoVal}-12-31` };
  }, [tipo, diaVal, mesVal, añoVal]);

  // Mismo período pero desplazado hacia atrás (día/mes/año anterior) — es la
  // base de las comparativas "+12% vs período anterior" de las stat cards.
  const rangoAnterior = useMemo(() => {
    if (tipo === 'dia') {
      const d = new Date(diaVal + 'T12:00:00');
      d.setDate(d.getDate() - 1);
      const s = fechaLocalYMD(d);
      return { desde: s, hasta: s };
    }
    if (tipo === 'mes') {
      const [y, m] = mesVal.split('-').map(Number);
      const prevM = m === 1 ? 12 : m - 1;
      const prevY = m === 1 ? y - 1 : y;
      const prevMesVal = `${prevY}-${String(prevM).padStart(2, '0')}`;
      const ultimoDia = new Date(prevY, prevM, 0).getDate();
      return { desde: `${prevMesVal}-01`, hasta: `${prevMesVal}-${String(ultimoDia).padStart(2, '0')}` };
    }
    const y = Number(añoVal) - 1;
    return { desde: `${y}-01-01`, hasta: `${y}-12-31` };
  }, [tipo, diaVal, mesVal, añoVal]);

  const { data: movimientosCajaResp, isLoading: cvGastos } = useQuery({
    queryKey: ['libro-caja-dashboard', rangoLibroCaja],
    queryFn: () => getLibroCaja({ ...rangoLibroCaja, tipo: 'egreso', limite: 0 }),
    enabled: puedeVerGastos,
    refetchInterval: 5 * 60_000,
    staleTime: 30_000,
  });
  const movimientosCaja = useMemo(() => movimientosCajaResp?.filas ?? [], [movimientosCajaResp]);

  const { data: movimientosCajaAnteriorResp } = useQuery({
    queryKey: ['libro-caja-dashboard-anterior', rangoAnterior],
    queryFn: () => getLibroCaja({ ...rangoAnterior, tipo: 'egreso', limite: 0 }),
    enabled: puedeVerGastos,
    staleTime: 30_000,
  });
  const totalGastosPeriodoAnterior = useMemo(
    () => (movimientosCajaAnteriorResp?.filas ?? []).reduce((s, m) => s + parseFloat(m.monto ?? 0), 0),
    [movimientosCajaAnteriorResp]
  );

  const invalidarDashboard = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['ventas-dashboard'] });
    qc.invalidateQueries({ queryKey: ['caja-estado'] });
    qc.invalidateQueries({ queryKey: ['libro-caja-dashboard'] });
    qc.invalidateQueries({ queryKey: ['libro-caja-dashboard-anterior'] });
  }, [qc]);

  useEffect(() => {
    socket.on('restaurante:actualizar', invalidarDashboard);
    return () => socket.off('restaurante:actualizar', invalidarDashboard);
  }, [invalidarDashboard]);

  // agrega las sesiones abiertas de todas las cajas de la sucursal para el widget del dashboard
  const cajaActiva = useMemo(() => {
    const abiertas = cajas.map(c => c.sesion_abierta).filter(Boolean);
    if (abiertas.length === 0) return null;
    return {
      total_ventas: abiertas.reduce((sum, s) => sum + parseFloat(s.total_ventas ?? 0), 0),
      total_gastos: abiertas.reduce((sum, s) => sum + parseFloat(s.total_gastos ?? 0), 0),
    };
  }, [cajas]);

  /* ─── filtrado ──────────────────────────────────────────────── */
  // Compara por fecha local YYYY-MM-DD contra un rango {desde, hasta}: al ser
  // strings con ese formato, la comparación lexicográfica coincide con la
  // cronológica. Se usa tanto para el período elegido como para el anterior.
  const enRangoFecha = useCallback((fechaISO, desde, hasta) => {
    const ymd = fechaLocalYMD(new Date(fechaISO));
    return ymd >= desde && ymd <= hasta;
  }, []);

  const ventasFiltradas = useMemo(() =>
    ventas.filter(v => v.estado === 'completado' && enRangoFecha(v.creado_en, rangoLibroCaja.desde, rangoLibroCaja.hasta)),
  [ventas, rangoLibroCaja, enRangoFecha]);

  const canceladasFiltradas = useMemo(() =>
    ventas.filter(v => v.estado === 'cancelado' && enRangoFecha(v.creado_en, rangoLibroCaja.desde, rangoLibroCaja.hasta)),
  [ventas, rangoLibroCaja, enRangoFecha]);

  const egresosFiltrados = useMemo(() =>
    movimientosCaja.filter(m => m.tipo === 'egreso' && enRangoFecha(m.creado_en, rangoLibroCaja.desde, rangoLibroCaja.hasta)),
  [movimientosCaja, rangoLibroCaja, enRangoFecha]);

  // Mismas ventas, pero recortadas al período anterior — solo para las
  // comparativas de las stat cards (no alimentan ningún gráfico).
  const ventasAnteriores = useMemo(() =>
    ventas.filter(v => v.estado === 'completado' && enRangoFecha(v.creado_en, rangoAnterior.desde, rangoAnterior.hasta)),
  [ventas, rangoAnterior, enRangoFecha]);

  const canceladasAnteriores = useMemo(() =>
    ventas.filter(v => v.estado === 'cancelado' && enRangoFecha(v.creado_en, rangoAnterior.desde, rangoAnterior.hasta)),
  [ventas, rangoAnterior, enRangoFecha]);

  /* ─── métricas ──────────────────────────────────────────────── */
  const totalPeriodo = ventasFiltradas.reduce((s, v) => s + parseFloat(v.total ?? 0), 0);
  const totalGastosPeriodo = egresosFiltrados.reduce((s, m) => s + parseFloat(m.monto ?? 0), 0);
  const margenNeto = totalPeriodo - totalGastosPeriodo;

  const totalPeriodoAnterior = ventasAnteriores.reduce((s, v) => s + parseFloat(v.total ?? 0), 0);
  const margenNetoAnterior = totalPeriodoAnterior - totalGastosPeriodoAnterior;

  const ticketPromedio = ventasFiltradas.length ? totalPeriodo / ventasFiltradas.length : 0;
  const ticketPromedioAnterior = ventasAnteriores.length ? totalPeriodoAnterior / ventasAnteriores.length : 0;

  /* ─── datosArea ─────────────────────────────────────────────── */
  const datosArea = useMemo(() => {
    if (tipo === 'dia') {
      return Array.from({ length: 18 }, (_, i) => {
        const hora = i + 6;
        const vH = ventasFiltradas.filter(v => new Date(v.creado_en).getHours() === hora);
        return { label: `${String(hora).padStart(2, '0')}:00`, total: vH.reduce((s, v) => s + parseFloat(v.total ?? 0), 0), pedidos: vH.length };
      });
    }
    if (tipo === 'mes') {
      const [y, m] = mesVal.split('-').map(Number);
      const dias = new Date(y, m, 0).getDate();
      return Array.from({ length: dias }, (_, i) => {
        const dia = i + 1;
        const vD = ventasFiltradas.filter(v => new Date(v.creado_en).getDate() === dia);
        return { label: String(dia), total: vD.reduce((s, v) => s + parseFloat(v.total ?? 0), 0), pedidos: vD.length };
      });
    }
    return MESES.map((mes, i) => {
      const vM = ventasFiltradas.filter(v => new Date(v.creado_en).getMonth() === i);
      return { label: mes, total: vM.reduce((s, v) => s + parseFloat(v.total ?? 0), 0), pedidos: vM.length };
    });
  }, [ventasFiltradas, tipo, mesVal]);

  /* ─── datosIngresosGastos ───────────────────────────────────── */
  const datosIngresosGastos = useMemo(() => {
    if (tipo === 'dia') {
      return Array.from({ length: 18 }, (_, i) => {
        const hora = i + 6;
        const vH = ventasFiltradas.filter(v => new Date(v.creado_en).getHours() === hora);
        const gH = egresosFiltrados.filter(m => new Date(m.creado_en).getHours() === hora);
        return {
          label: `${String(hora).padStart(2, '0')}:00`,
          ingresos: vH.reduce((s, v) => s + parseFloat(v.total ?? 0), 0),
          gastos: gH.reduce((s, m) => s + parseFloat(m.monto ?? 0), 0),
        };
      });
    }
    if (tipo === 'mes') {
      const [y, m] = mesVal.split('-').map(Number);
      const dias = new Date(y, m, 0).getDate();
      return Array.from({ length: dias }, (_, i) => {
        const dia = i + 1;
        const vD = ventasFiltradas.filter(v => new Date(v.creado_en).getDate() === dia);
        const gD = egresosFiltrados.filter(m => new Date(m.creado_en).getDate() === dia);
        return {
          label: String(dia),
          ingresos: vD.reduce((s, v) => s + parseFloat(v.total ?? 0), 0),
          gastos: gD.reduce((s, m) => s + parseFloat(m.monto ?? 0), 0),
        };
      });
    }
    return MESES.map((mes, i) => {
      const vM = ventasFiltradas.filter(v => new Date(v.creado_en).getMonth() === i);
      const gM = egresosFiltrados.filter(m => new Date(m.creado_en).getMonth() === i);
      return {
        label: mes,
        ingresos: vM.reduce((s, v) => s + parseFloat(v.total ?? 0), 0),
        gastos: gM.reduce((s, m) => s + parseFloat(m.monto ?? 0), 0),
      };
    });
  }, [ventasFiltradas, egresosFiltrados, tipo, mesVal]);

  /* ─── datosMetodo ───────────────────────────────────────────── */
  const datosMetodo = useMemo(() => {
    const map = {};
    ventasFiltradas.forEach(v => {
      const m = v.metodo_pago ?? 'otro';
      map[m] = (map[m] ?? 0) + parseFloat(v.total ?? 0);
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [ventasFiltradas]);

  /* ─── topProductos ──────────────────────────────────────────── */
  const topProductos = useMemo(() => {
    const map = {};
    ventasFiltradas.forEach(v => {
      (v.detalles ?? []).forEach(d => {
        const nombre = d.producto?.nombre ?? 'Otro';
        map[nombre] = (map[nombre] ?? 0) + (d.cantidad ?? 1);
      });
    });
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([nombre, cantidad], i) => ({ nombre, cantidad, fill: PALETA[i % PALETA.length] }));
  }, [ventasFiltradas]);

  /* ─── rankingCajeros ──────────────────────────────────────────── */
  const rankingCajeros = useMemo(() => {
    const map = {};
    ventasFiltradas.forEach(v => {
      if (!v.usuario_id) return;
      map[v.usuario_id] = (map[v.usuario_id] ?? 0) + parseFloat(v.total ?? 0);
    });
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([usuario_id, valor]) => ({
        nombre: usuarios.find(u => u.id === Number(usuario_id))?.nombre ?? `Usuario #${usuario_id}`,
        valor,
      }));
  }, [ventasFiltradas, usuarios]);

  /* ─── rankingSucursales (solo con acceso a todas) ────────────── */
  const rankingSucursales = useMemo(() => {
    const map = {};
    ventasFiltradas.forEach(v => {
      map[v.sucursal_id] = (map[v.sucursal_id] ?? 0) + parseFloat(v.total ?? 0);
    });
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .map(([sucursal_id, valor]) => ({
        nombre: sucursales.find(s => s.id === Number(sucursal_id))?.nombre ?? `Sucursal #${sucursal_id}`,
        valor,
      }));
  }, [ventasFiltradas, sucursales]);

  /* ─── cupones y fidelidad ─────────────────────────────────────── */
  const datosFidelidad = useMemo(() => {
    const conCupon = ventasFiltradas.filter(v => v.cupon_id);
    const conPuntos = ventasFiltradas.filter(v => (v.puntos_canjeados ?? 0) > 0);
    return {
      cantidadCupones: conCupon.length,
      totalDescontadoCupon: conCupon.reduce((s, v) => s + parseFloat(v.descuento_cupon ?? 0), 0),
      cantidadPuntos: conPuntos.length,
      totalPuntosCanjeados: conPuntos.reduce((s, v) => s + (v.puntos_canjeados ?? 0), 0),
    };
  }, [ventasFiltradas]);

  /* ─── clientes nuevos vs recurrentes ──────────────────────────── */
  // "Recurrente" = ya tenía una venta completada ANTES de que empezara el
  // período elegido. No hace falta pedir nada nuevo: se resuelve con el
  // mismo historial completo de `ventas` que ya se carga para todo lo demás.
  const clientesPeriodo = useMemo(() => {
    const idsUnicos = [...new Set(ventasFiltradas.filter(v => v.cliente_id).map(v => v.cliente_id))];
    let nuevos = 0, recurrentes = 0;
    idsUnicos.forEach(id => {
      const yaCompróAntes = ventas.some(v =>
        v.cliente_id === id && v.estado === 'completado' && fechaLocalYMD(new Date(v.creado_en)) < rangoLibroCaja.desde
      );
      if (yaCompróAntes) recurrentes++; else nuevos++;
    });
    return { nuevos, recurrentes, total: idsUnicos.length };
  }, [ventasFiltradas, ventas, rangoLibroCaja]);

  /* ─── insumos con stock bajo (umbral fijo, igual que Inventario) ─ */
  const UNIDAD_ABREV = { kilogramo: 'kg', gramo: 'g', litro: 'L', mililitro: 'mL', arroba: '@', libra: 'lb', unidad: 'u' };
  const insumosBajoStock = useMemo(() =>
    insumos.filter(i => i.activo !== false && Number(i.stock ?? 0) <= 5),
  [insumos]);

  /* ─── datosPedidos (cobrados vs cancelados) ─────────────────── */
  const datosPedidos = useMemo(() => {
    if (tipo === 'dia') {
      return Array.from({ length: 18 }, (_, i) => {
        const hora = i + 6;
        const match = v => new Date(v.creado_en).getHours() === hora && fechaLocalYMD(new Date(v.creado_en)) === diaVal;
        return {
          label: `${String(hora).padStart(2, '0')}h`,
          cobrados:   ventas.filter(v => v.estado === 'completado' && match(v)).length,
          cancelados: ventas.filter(v => v.estado === 'cancelado'  && match(v)).length,
        };
      });
    }
    if (tipo === 'mes') {
      const [y, m] = mesVal.split('-').map(Number);
      const dias = new Date(y, m, 0).getDate();
      return Array.from({ length: dias }, (_, i) => {
        const dia = i + 1;
        const match = v => new Date(v.creado_en).getDate() === dia && new Date(v.creado_en).getFullYear() === y && new Date(v.creado_en).getMonth() === m - 1;
        return {
          label: String(dia),
          cobrados:   ventas.filter(v => v.estado === 'completado' && match(v)).length,
          cancelados: ventas.filter(v => v.estado === 'cancelado'  && match(v)).length,
        };
      });
    }
    return MESES.map((mes, i) => ({
      label: mes,
      cobrados:   ventas.filter(v => v.estado === 'completado' && new Date(v.creado_en).getMonth() === i && new Date(v.creado_en).getFullYear() === Number(añoVal)).length,
      cancelados: ventas.filter(v => v.estado === 'cancelado'  && new Date(v.creado_en).getMonth() === i && new Date(v.creado_en).getFullYear() === Number(añoVal)).length,
    }));
  }, [ventas, tipo, diaVal, mesVal, añoVal]);

  /* ─── etiqueta período ──────────────────────────────────────── */
  const labelPeriodo = useMemo(() => {
    if (tipo === 'dia') return new Date(diaVal + 'T12:00:00').toLocaleDateString('es-BO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    if (tipo === 'mes') { const [y, m] = mesVal.split('-').map(Number); return `${MESES_FULL[m - 1]} ${y}`; }
    return `Año ${añoVal}`;
  }, [tipo, diaVal, mesVal, añoVal]);

  const haySuficientesDatos = ventasFiltradas.length > 0 || canceladasFiltradas.length > 0;

  /* ─── datosHeatmap: patrón día de semana × hora, todo el historial ───
     A diferencia del resto del dashboard, no se recorta al período elegido
     — es un widget de "mejores horarios" de siempre, no del filtro actual. */
  const HEATMAP_HORAS = useMemo(() => Array.from({ length: 18 }, (_, i) => i + 6), []);

  const datosHeatmap = useMemo(() => {
    const grid = DIAS_SEMANA.map(() => HEATMAP_HORAS.map(() => 0));
    ventas.forEach(v => {
      if (v.estado !== 'completado') return;
      const d = new Date(v.creado_en);
      const idxHora = d.getHours() - 6;
      if (idxHora < 0 || idxHora > 17) return;
      grid[d.getDay()][idxHora] += parseFloat(v.total ?? 0);
    });
    return grid;
  }, [ventas, HEATMAP_HORAS]);

  const maxHeatmap = Math.max(1, ...datosHeatmap.flat());
  const hayVentasHistoricas = ventas.some(v => v.estado === 'completado');

  /* ─── render ────────────────────────────────────────────────── */
  return (
    <>
      {/* Keyframes de animación */}
      <style>{`
        @keyframes dashFadeUp {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes dashFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>

      <div className="space-y-4">

        {/* ── Header ──────────────────────────────────────────── */}
        <div
          className="rounded-2xl p-5 sm:p-6 bg-primary text-primary-foreground relative overflow-hidden"
          style={{ animation: 'dashFadeIn 0.4s ease both' }}
        >
          {/* decoración fondo */}
          <div className="absolute -right-8 -top-8 w-40 h-40 rounded-full opacity-10 bg-primary-foreground" />
          <div className="absolute -right-2 bottom-0 w-24 h-24 rounded-full opacity-10 bg-primary-foreground" />

          <p className="text-primary-foreground/70 text-xs sm:text-sm relative capitalize">
            {new Date().toLocaleDateString('es-BO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
          <h1 className="text-xl sm:text-2xl font-bold mt-1 relative">
            {saludo()}, {usuario?.nombre?.split(' ')[0]} 👋
          </h1>
          <p className="text-primary-foreground/60 text-xs sm:text-sm mt-0.5 relative">{usuario?.rol?.nombre ?? 'Panel principal'}</p>
        </div>

        {/* ── Filtros ─────────────────────────────────────────── */}
        <div
          className="bg-card rounded-2xl border border-border p-3 sm:p-4 shadow-sm"
          style={{ animation: 'dashFadeUp 0.4s ease both', animationDelay: '80ms' }}
        >
          <div className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-center gap-2">
              {/* tabs */}
              <div className="flex gap-1 bg-muted rounded-xl p-1">
                {[['dia', 'Día'], ['mes', 'Mes'], ['año', 'Año']].map(([val, lbl]) => (
                  <button
                    key={val}
                    onClick={() => setTipo(val)}
                    className={`px-3 sm:px-4 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-all duration-200 ${
                      tipo === val
                        ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/30'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>

              {/* selector fecha */}
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <CalendarDays className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                {tipo === 'dia' && (
                  <input type="date" value={diaVal} max={fechaLocalYMD(hoy)}
                    onChange={e => setDiaVal(e.target.value)}
                    className="flex-1 min-w-0 text-xs sm:text-sm px-2 sm:px-3 py-1.5 rounded-xl border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                )}
                {tipo === 'mes' && (
                  <input type="month" value={mesVal} max={fechaLocalYM(hoy)}
                    onChange={e => setMesVal(e.target.value)}
                    className="flex-1 min-w-0 text-xs sm:text-sm px-2 sm:px-3 py-1.5 rounded-xl border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                )}
                {tipo === 'año' && (
                  <select value={añoVal} onChange={e => setAñoVal(e.target.value)}
                    className="text-xs sm:text-sm px-2 sm:px-3 py-1.5 rounded-xl border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {AÑOS.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                )}
              </div>
            </div>

            <span className="text-xs text-muted-foreground capitalize font-medium">{labelPeriodo}</span>
          </div>
        </div>

        {/* ── Alerta insumos con stock bajo ─────────────────────── */}
        {puedeVerInsumos && insumosBajoStock.length > 0 && (
          <div
            className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-4 flex items-start gap-3"
            style={{ animation: 'dashFadeUp 0.4s ease both', animationDelay: '90ms' }}
          >
            <Wheat className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                {insumosBajoStock.length} insumo{insumosBajoStock.length > 1 ? 's' : ''} con stock bajo (≤ 5)
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-500 mt-0.5">
                {insumosBajoStock.map(i => `${i.nombre} (${Number(i.stock ?? 0).toLocaleString('es-BO', { maximumFractionDigits: 2 })}${UNIDAD_ABREV[i.unidad_medida] ?? ''})`).join(', ')}
              </p>
            </div>
          </div>
        )}

        {/* ── Stat cards ──────────────────────────────────────── */}
        {puedeVerVentas && (
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            <StatCard icono={TrendingUp} titulo="Ingresos del período" valor={fmt(totalPeriodo)}
              sub={`${ventasFiltradas.length} venta${ventasFiltradas.length !== 1 ? 's' : ''}`}
              delta={<DeltaBadge actual={totalPeriodo} anterior={totalPeriodoAnterior} />}
              color="blue" cargando={cvVentas} delay={100}
            />
            <StatCard icono={Receipt} titulo="Ticket promedio" valor={fmt(ticketPromedio)}
              sub="Ingreso por venta"
              delta={<DeltaBadge actual={ticketPromedio} anterior={ticketPromedioAnterior} />}
              color="violet" cargando={cvVentas} delay={160}
            />
            <StatCard
              icono={Wallet}
              titulo={puedeVerCaja ? 'Caja activa' : 'Período'}
              valor={puedeVerCaja ? (cajaActiva ? fmt(cajaActiva.total_ventas) : '—') : `${ventasFiltradas.length}`}
              sub={puedeVerCaja ? (cajaActiva ? `Gastos: ${fmt(cajaActiva.total_gastos)}` : 'Sin sesión') : 'Ventas completadas'}
              color="amber" cargando={cvVentas} delay={220}
            />
            <StatCard icono={XCircle} titulo="Canceladas" valor={canceladasFiltradas.length}
              sub={canceladasFiltradas.length > 0 ? 'En el período' : 'Sin cancelaciones'}
              delta={<DeltaBadge actual={canceladasFiltradas.length} anterior={canceladasAnteriores.length} positivoEsBueno={false} />}
              color="red" cargando={cvVentas} delay={280}
            />
            {puedeVerGastos && (
              <>
                <StatCard icono={TrendingDown} titulo="Gastos del período" valor={fmt(totalGastosPeriodo)}
                  sub={`${egresosFiltrados.length} egreso${egresosFiltrados.length !== 1 ? 's' : ''}`}
                  delta={<DeltaBadge actual={totalGastosPeriodo} anterior={totalGastosPeriodoAnterior} positivoEsBueno={false} />}
                  color="orange" cargando={cvGastos} delay={320}
                />
                <StatCard icono={PiggyBank} titulo="Margen neto" valor={fmt(margenNeto)}
                  sub="Ingresos - gastos"
                  delta={<DeltaBadge actual={margenNeto} anterior={margenNetoAnterior} />}
                  color={margenNeto >= 0 ? 'emerald' : 'red'} cargando={cvVentas || cvGastos} delay={360}
                />
              </>
            )}
          </div>
        )}

        {puedeVerCaja && <EstadoAgentesImpresion />}

        {/* ── Sin datos ────────────────────────────────────────── */}
        {!cvVentas && puedeVerVentas && !haySuficientesDatos && (
          <div className="bg-card rounded-2xl border border-border py-16 flex flex-col items-center gap-2 text-muted-foreground shadow-sm"
            style={{ animation: 'dashFadeUp 0.4s ease both', animationDelay: '200ms' }}
          >
            <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center">
              <ShoppingBag className="w-7 h-7 opacity-40" />
            </div>
            <p className="text-sm font-medium">Sin ventas en el período seleccionado</p>
            <p className="text-xs capitalize">{labelPeriodo}</p>
          </div>
        )}

        {/* ── Gráfico Ingresos (AreaChart) ─────────────────────── */}
        {puedeVerVentas && haySuficientesDatos && (
          <ChartCard titulo={`Ingresos — ${labelPeriodo}`} accent="hsl(var(--primary))" delay={340}>
            {cvVentas ? (
              <div className="h-56 rounded-xl bg-muted animate-pulse" />
            ) : (
              <div className="h-44 sm:h-56 md:h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={datosArea} margin={{ top: 10, right: isSm ? 4 : 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gradIngresos" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%"   stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="gradPedidos" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%"   stopColor="#10b981" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke={gridColor} strokeDasharray="4 4" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: tickSize, fill: tickColor }}
                      tickLine={false} axisLine={false}
                      interval={tipo === 'dia' ? (isSm ? 3 : 1) : tipo === 'mes' ? (isSm ? 6 : 3) : 0}
                    />
                    <YAxis
                      yAxisId="left"
                      tick={{ fontSize: tickSize, fill: tickColor }}
                      tickLine={false} axisLine={false}
                      tickFormatter={v => v === 0 ? '' : `${v}`}
                      width={yAxisW}
                    />
                    {!isSm && (
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        tick={{ fontSize: tickSize, fill: tickColor }}
                        tickLine={false} axisLine={false}
                        allowDecimals={false}
                        width={yAxisWNum}
                      />
                    )}
                    <Tooltip content={<TooltipVentas />} />
                    <Legend
                      iconType="circle" iconSize={8}
                      formatter={v => <span style={{ fontSize: isSm ? 10 : 12, color: tickColor }}>{v === 'total' ? 'Ingresos (Bs)' : 'Pedidos'}</span>}
                    />
                    <Area yAxisId="left"  type="monotone" dataKey="total"   name="total"
                      stroke="hsl(var(--primary))" strokeWidth={2.5} fill="url(#gradIngresos)"
                      dot={false} activeDot={{ r: 5, fill: 'hsl(var(--primary))', strokeWidth: 2, stroke: '#fff' }}
                      isAnimationActive animationDuration={900} animationEasing="ease-out"
                    />
                    <Area yAxisId={isSm ? 'left' : 'right'} type="monotone" dataKey="pedidos" name="pedidos"
                      stroke="#10b981" strokeWidth={2} fill="url(#gradPedidos)"
                      dot={false} activeDot={{ r: 4, fill: '#10b981', strokeWidth: 2, stroke: '#fff' }}
                      isAnimationActive animationDuration={900} animationEasing="ease-out" animationBegin={200}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </ChartCard>
        )}

        {/* ── Gráfico Ingresos vs Gastos ────────────────────────── */}
        {puedeVerVentas && puedeVerGastos && haySuficientesDatos && (
          <ChartCard titulo={`Ingresos vs Gastos — ${labelPeriodo}`} accent={COLOR_GASTOS} delay={380}>
            {(cvVentas || cvGastos) ? (
              <div className="h-56 rounded-xl bg-muted animate-pulse" />
            ) : (
              <div className="h-44 sm:h-56 md:h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={datosIngresosGastos} margin={{ top: 10, right: isSm ? 4 : 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gradIngresosVsGastos" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%"   stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="gradGastos" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%"   stopColor={COLOR_GASTOS} stopOpacity={0.3} />
                        <stop offset="100%" stopColor={COLOR_GASTOS} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke={gridColor} strokeDasharray="4 4" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: tickSize, fill: tickColor }}
                      tickLine={false} axisLine={false}
                      interval={tipo === 'dia' ? (isSm ? 3 : 1) : tipo === 'mes' ? (isSm ? 6 : 3) : 0}
                    />
                    <YAxis
                      tick={{ fontSize: tickSize, fill: tickColor }}
                      tickLine={false} axisLine={false}
                      tickFormatter={v => v === 0 ? '' : `${v}`}
                      width={yAxisW}
                    />
                    <Tooltip content={<TooltipVentas />} />
                    <Legend
                      iconType="circle" iconSize={8}
                      formatter={v => <span style={{ fontSize: isSm ? 10 : 12, color: tickColor }}>{v === 'ingresos' ? 'Ingresos (Bs)' : 'Gastos (Bs)'}</span>}
                    />
                    <Area type="monotone" dataKey="ingresos" name="ingresos"
                      stroke="hsl(var(--primary))" strokeWidth={2.5} fill="url(#gradIngresosVsGastos)"
                      dot={false} activeDot={{ r: 5, fill: 'hsl(var(--primary))', strokeWidth: 2, stroke: '#fff' }}
                      isAnimationActive animationDuration={900} animationEasing="ease-out"
                    />
                    <Area type="monotone" dataKey="gastos" name="gastos"
                      stroke={COLOR_GASTOS} strokeWidth={2} fill="url(#gradGastos)"
                      dot={false} activeDot={{ r: 4, fill: COLOR_GASTOS, strokeWidth: 2, stroke: '#fff' }}
                      isAnimationActive animationDuration={900} animationEasing="ease-out" animationBegin={200}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </ChartCard>
        )}

        {/* ── Fila: Métodos de pago + Top productos ────────────── */}
        {puedeVerVentas && ventasFiltradas.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* Métodos de pago */}
            <ChartCard titulo="Métodos de pago" accent="#f59e0b" delay={440}>
              {datosMetodo.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-10">Sin datos de pagos</p>
              ) : (
                <div className="h-44 sm:h-56 md:h-60">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={datosMetodo}
                        cx="50%" cy="45%"
                        innerRadius={isXs ? 40 : isSm ? 50 : 60}
                        outerRadius={isXs ? 65 : isSm ? 75 : 90}
                        paddingAngle={4}
                        dataKey="value"
                        isAnimationActive animationDuration={800} animationEasing="ease-out"
                        strokeWidth={0}
                      >
                        {datosMetodo.map((entry, i) => (
                          <Cell
                            key={entry.name}
                            fill={COLORES_METODO[entry.name] ?? PALETA[i % PALETA.length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip content={<TooltipPie />} />
                      <Legend content={<LeyendaPie />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </ChartCard>

            {/* Top productos */}
            <ChartCard titulo="Productos más vendidos" accent="#ec4899" delay={500}>
              {topProductos.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-10">Sin datos de productos</p>
              ) : (
                <div className="h-44 sm:h-56 md:h-60">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={topProductos}
                      layout="vertical"
                      margin={{ top: 0, right: isSm ? 8 : 20, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid stroke={gridColor} strokeDasharray="4 4" horizontal={false} />
                      <XAxis
                        type="number"
                        tick={{ fontSize: tickSize, fill: tickColor }}
                        tickLine={false} axisLine={false}
                        allowDecimals={false}
                      />
                      <YAxis
                        type="category" dataKey="nombre"
                        tick={{ fontSize: tickSize, fill: tickColor }}
                        tickLine={false} axisLine={false}
                        width={yAxisWProd}
                        tickFormatter={v => {
                          const max = isXs ? 9 : isSm ? 11 : 13;
                          return v.length > max ? v.slice(0, max - 1) + '…' : v;
                        }}
                      />
                      <Tooltip content={<TooltipBar />} />
                      <Bar
                        dataKey="cantidad" name="Unidades"
                        radius={[0, 5, 5, 0]} maxBarSize={22}
                        isAnimationActive animationDuration={800} animationEasing="ease-out"
                      >
                        {topProductos.map((entry, i) => (
                          <Cell key={entry.nombre} fill={PALETA[i % PALETA.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </ChartCard>
          </div>
        )}

        {/* ── Fila: Ranking de cajeros + Clientes del período ──── */}
        {puedeVerVentas && ventasFiltradas.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {puedeVerUsuarios && (
              <ChartCard titulo="Ranking de cajeros" accent="#f59e0b" delay={620}>
                <Leaderboard items={rankingCajeros} colorBarra="bg-amber-500" />
              </ChartCard>
            )}

            <ChartCard titulo="Clientes del período" accent="#3b82f6" delay={660}>
              {clientesPeriodo.total === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-10">Sin clientes identificados en el período</p>
              ) : (
                <div className="space-y-4 py-2">
                  <div className="flex items-center justify-around text-center">
                    <div className="flex flex-col items-center gap-1">
                      <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-500/10">
                        <UserPlus className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                      </div>
                      <p className="text-xl font-bold text-foreground">{clientesPeriodo.nuevos}</p>
                      <p className="text-xs text-muted-foreground">Nuevos</p>
                    </div>
                    <div className="flex flex-col items-center gap-1">
                      <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-500/10">
                        <UserCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <p className="text-xl font-bold text-foreground">{clientesPeriodo.recurrentes}</p>
                      <p className="text-xs text-muted-foreground">Recurrentes</p>
                    </div>
                  </div>
                  <div className="h-2 rounded-full bg-blue-100 dark:bg-blue-500/15 overflow-hidden flex">
                    <div className="h-full bg-blue-500" style={{ width: `${(clientesPeriodo.nuevos / clientesPeriodo.total) * 100}%` }} />
                    <div className="h-full bg-emerald-500" style={{ width: `${(clientesPeriodo.recurrentes / clientesPeriodo.total) * 100}%` }} />
                  </div>
                </div>
              )}
            </ChartCard>
          </div>
        )}

        {/* ── Fila: Cupones y fidelidad + Ranking de sucursales ─── */}
        {puedeVerVentas && ventasFiltradas.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ChartCard titulo="Cupones y fidelidad" accent="#ec4899" delay={700}>
              <div className="grid grid-cols-2 gap-3 py-2">
                <div className="bg-muted rounded-xl p-3 flex items-center gap-2.5">
                  <Ticket className="w-4 h-4 text-pink-600 dark:text-pink-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-base font-bold text-foreground leading-tight">{datosFidelidad.cantidadCupones}</p>
                    <p className="text-[11px] text-muted-foreground">Ventas con cupón</p>
                  </div>
                </div>
                <div className="bg-muted rounded-xl p-3 flex items-center gap-2.5">
                  <Gift className="w-4 h-4 text-pink-600 dark:text-pink-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-base font-bold text-foreground leading-tight">{fmt(datosFidelidad.totalDescontadoCupon)}</p>
                    <p className="text-[11px] text-muted-foreground">Descontado por cupón</p>
                  </div>
                </div>
                <div className="bg-muted rounded-xl p-3 flex items-center gap-2.5">
                  <Trophy className="w-4 h-4 text-pink-600 dark:text-pink-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-base font-bold text-foreground leading-tight">{datosFidelidad.cantidadPuntos}</p>
                    <p className="text-[11px] text-muted-foreground">Ventas con puntos</p>
                  </div>
                </div>
                <div className="bg-muted rounded-xl p-3 flex items-center gap-2.5">
                  <Trophy className="w-4 h-4 text-pink-600 dark:text-pink-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-base font-bold text-foreground leading-tight">{datosFidelidad.totalPuntosCanjeados}</p>
                    <p className="text-[11px] text-muted-foreground">Puntos canjeados</p>
                  </div>
                </div>
              </div>
            </ChartCard>

            {accesoTodas && (
              <ChartCard titulo="Ranking de sucursales" accent="#6366f1" delay={740}>
                <Leaderboard items={rankingSucursales} colorBarra="bg-indigo-500" />
              </ChartCard>
            )}
          </div>
        )}

        {/* ── Cobrados vs Cancelados ───────────────────────────── */}
        {puedeVerVentas && haySuficientesDatos && (
          <ChartCard titulo="Pedidos cobrados vs cancelados" accent="#10b981" delay={560}>
            <div className="h-40 sm:h-52 md:h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={datosPedidos} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barGap={3} barCategoryGap="30%">
                  <CartesianGrid stroke={gridColor} strokeDasharray="4 4" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: tickSize, fill: tickColor }}
                    tickLine={false} axisLine={false}
                    interval={tipo === 'dia' ? (isSm ? 3 : 1) : tipo === 'mes' ? (isSm ? 6 : 3) : 0}
                  />
                  <YAxis
                    tick={{ fontSize: tickSize, fill: tickColor }}
                    tickLine={false} axisLine={false}
                    allowDecimals={false} width={yAxisWNum}
                  />
                  <Tooltip content={<TooltipVentas />} />
                  <Legend
                    iconType="circle" iconSize={8}
                    formatter={v => (
                      <span style={{ fontSize: isSm ? 10 : 12, color: tickColor }}>
                        {v === 'cobrados' ? 'Cobrados' : 'Cancelados'}
                      </span>
                    )}
                  />
                  <Bar dataKey="cobrados"   name="cobrados"   fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={20}
                    isAnimationActive animationDuration={800} animationEasing="ease-out"
                  />
                  <Bar dataKey="cancelados" name="cancelados" fill="#f43f5e" radius={[4, 4, 0, 0]} maxBarSize={20}
                    isAnimationActive animationDuration={800} animationEasing="ease-out" animationBegin={150}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        )}

        {/* ── Mapa de calor: mejores horarios (histórico) ──────── */}
        {puedeVerVentas && hayVentasHistoricas && (
          <ChartCard titulo="Mejores horarios (histórico)" accent="#8b5cf6" delay={620}>
            <div className="overflow-x-auto">
              <table className="mx-auto" style={{ borderSpacing: 3, borderCollapse: 'separate' }}>
                <thead>
                  <tr>
                    <th className="w-8" />
                    {HEATMAP_HORAS.map(h => (
                      <th key={h} className="text-[9px] font-normal text-muted-foreground px-0.5 pb-1">
                        {isSm ? (h % 2 === 0 ? h : '') : h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {DIAS_SEMANA.map((dia, i) => (
                    <tr key={dia}>
                      <td className="text-[10px] text-muted-foreground pr-1.5 text-right whitespace-nowrap">{dia}</td>
                      {datosHeatmap[i].map((valor, j) => (
                        <td
                          key={j}
                          title={`${dia} ${HEATMAP_HORAS[j]}:00 — ${fmt(valor)}`}
                          className={`${isSm ? 'w-4 h-4' : 'w-5 h-5 sm:w-6 sm:h-6'} rounded`}
                          style={{ backgroundColor: `rgba(139, 92, 246, ${valor === 0 ? 0.06 : 0.15 + (valor / maxHeatmap) * 0.75})` }}
                        />
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-muted-foreground mt-3 text-center">
              Suma de ventas completadas por día de la semana y hora — todo el historial, no solo {labelPeriodo.toLowerCase()}
            </p>
          </ChartCard>
        )}

        {/* sin permiso */}
        {!puedeVerVentas && (
          <div className="text-center py-16 text-muted-foreground">
            <p className="text-sm">Sin permiso para ver estadísticas de ventas.</p>
          </div>
        )}
      </div>
    </>
  );
}
