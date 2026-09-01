import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, BookOpen, TrendingUp, TrendingDown, DollarSign } from 'lucide-react';
import { getReporteCaja, getReporteCajaResumen } from '../../../api/reportes';
import { useAuth } from '../../../hooks/useAuth';
import { useAuthStore } from '../../../store/authStore';
import { exportarPDF } from '../utils/exportarPDF';
import { FiltroFechas, StatCard, BadgeTipo, Skeleton, bs, fecha, fechaHora, hoy, inicioMes } from '../shared';
import Paginacion from '../../../components/ui/Paginacion';

function MovimientoCajaCard({ mov, mostrarSucursal }) {
  return (
    <div className="bg-card border border-border rounded-xl p-3.5 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground whitespace-nowrap">{fechaHora(mov.creado_en)}</p>
          <p className="font-medium text-foreground truncate">{mov.concepto || '-'}</p>
        </div>
        <p className={`font-bold shrink-0 whitespace-nowrap ${mov.tipo === 'ingreso' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
          {mov.tipo === 'egreso' ? '-' : ''}{bs(mov.monto)}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <BadgeTipo tipo={mov.tipo} />
        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">
          {mov.metodo_pago || '-'}
        </span>
        {mostrarSucursal && mov.sucursal?.nombre && (
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
            {mov.sucursal.nombre}
          </span>
        )}
      </div>
      <div className="flex items-center justify-end text-xs text-muted-foreground pt-1 border-t border-border">
        <span>{mov.usuario?.nombre || '-'}</span>
      </div>
    </div>
  );
}

export default function TabCaja({ empresa, logo, direccion, telefono }) {
  const { usuario } = useAuth();
  const accesoTodas = useAuthStore((s) => s.usuario?.sucursal_activa?.id == null);
  const [filtroSucursal, setFiltroSucursal] = useState('todas');
  const [desde, setDesde] = useState(inicioMes());
  const [hasta, setHasta] = useState(hoy());
  const [filtroTipo, setFiltroTipo] = useState('todos');
  const [pagina, setPagina] = useState(1);
  const [exportando, setExportando] = useState(false);

  const filtrosApi = {
    desde, hasta,
    sucursal_id: accesoTodas && filtroSucursal !== 'todas' ? filtroSucursal : undefined,
    tipo: filtroTipo !== 'todos' ? filtroTipo : undefined,
  };

  // Vuelve a página 1 cuando cambia cualquier filtro (evita quedar en una
  // página que ya no existe). Se ajusta el estado durante el render en vez
  // de un useEffect para no disparar el lint react-hooks/set-state-in-effect
  // (mismo patrón usado en LibroCajaPage.jsx / TabVentas.jsx / TabCompras.jsx).
  const filtrosKey = `${desde}|${hasta}|${filtroSucursal}|${filtroTipo}`;
  const [prevFiltrosKey, setPrevFiltrosKey] = useState(filtrosKey);
  if (filtrosKey !== prevFiltrosKey) {
    setPrevFiltrosKey(filtrosKey);
    setPagina(1);
  }

  const { data: paginaDatos, isLoading } = useQuery({
    queryKey: ['reporte-caja', filtrosApi, pagina],
    queryFn: () => getReporteCaja({ ...filtrosApi, pagina }),
  });
  const data = useMemo(() => paginaDatos?.filas ?? [], [paginaDatos]);
  const totalPaginas = paginaDatos?.total_paginas ?? 1;

  const { data: resumen } = useQuery({
    queryKey: ['reporte-caja-resumen', filtrosApi],
    queryFn: () => getReporteCajaResumen(filtrosApi),
  });
  const sucursales = resumen?.filtros?.sucursales ?? [];

  // Totales del rango filtrado completo (no solo la página visible) —
  // vienen del endpoint de resumen, no se derivan de `data`.
  const stats = {
    total: paginaDatos?.total ?? 0,
    ingresos: resumen?.total_ingresos ?? 0,
    egresos: resumen?.total_egresos ?? 0,
    balance: (resumen?.total_ingresos ?? 0) - (resumen?.total_egresos ?? 0),
  };

  // Desglose de ingresos/egresos por sucursal: fuera de alcance de este plan
  // (el endpoint de resumen da un solo total, no un total-por-sucursal).
  // Se mantiene calculado sobre `data` (la página visible) — degradación
  // aceptada y documentada: deja de ser 100% preciso cuando hay más de una
  // página de movimientos mixtos entre sucursales.
  const resumenSucursales = useMemo(() => {
    if (!accesoTodas) return [];
    const mapa = new Map();
    data.forEach(r => {
      const id = r.sucursal?.id;
      if (id == null) return;
      if (!mapa.has(id)) mapa.set(id, { id, nombre: r.sucursal.nombre, ingresos: 0, egresos: 0 });
      const s = mapa.get(id);
      if (r.tipo === 'ingreso') s.ingresos += parseFloat(r.monto || 0);
      else s.egresos += parseFloat(r.monto || 0);
    });
    return Array.from(mapa.values())
      .map(s => ({ ...s, neto: s.ingresos - s.egresos }))
      .sort((a, b) => b.neto - a.neto);
  }, [data, accesoTodas]);

  const exportar = async () => {
    setExportando(true);
    try {
      const { filas: todas } = await getReporteCaja({ ...filtrosApi, limite: 0 });
      exportarPDF({
        titulo:        'Reporte de Caja / Libro Caja',
        subtitulo:     `${fecha(desde)} — ${fecha(hasta)}`,
        empresa, logo, direccion, telefono,
        generadoPor:   usuario?.nombre,
        columnas:      ['Fecha', 'Tipo', 'Concepto', 'Método de pago', 'Usuario', 'Monto'],
        filas:         todas.map(r => [
          fechaHora(r.creado_en),
          r.tipo,
          r.concepto || '-',
          r.metodo_pago || '-',
          r.usuario?.nombre || '-',
          bs(r.monto),
        ]),
        totales: [
          { label: 'Total registros', valor: stats.total },
          { label: 'Total ingresos',  valor: bs(stats.ingresos) },
          { label: 'Total egresos',   valor: bs(stats.egresos) },
          { label: 'Balance',         valor: bs(stats.balance) },
        ],
        nombreArchivo: `reporte-caja-${desde}-${hasta}.pdf`,
      });
    } finally {
      setExportando(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end sm:justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <FiltroFechas desde={desde} hasta={hasta} setDesde={setDesde} setHasta={setHasta} />
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Tipo</label>
            <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}
              className="px-3 py-2 text-sm rounded-xl border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
              <option value="todos">Todos</option>
              <option value="ingreso">Ingresos</option>
              <option value="egreso">Egresos</option>
            </select>
          </div>
          {accesoTodas && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Sucursal</label>
              <select value={filtroSucursal} onChange={e => setFiltroSucursal(e.target.value)}
                className="px-3 py-2 text-sm rounded-xl border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
                <option value="todas">Todas</option>
                {sucursales.map(s => (
                  <option key={s.id} value={String(s.id)}>{s.nombre}</option>
                ))}
              </select>
            </div>
          )}
        </div>
        <button onClick={exportar} disabled={!data.length || exportando}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-40 w-full sm:w-auto">
          <Download className="w-4 h-4" /> {exportando ? 'Exportando…' : 'Exportar PDF'}
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard label="Registros"      valor={stats.total}           color="primary"                            Icono={BookOpen}    idx={0} />
        <StatCard label="Total Ingresos" valor={bs(stats.ingresos)}    color="emerald"                            Icono={TrendingUp}  idx={1} />
        <StatCard label="Total Egresos"  valor={bs(stats.egresos)}     color="rose"                               Icono={TrendingDown} idx={2} />
        <StatCard label="Balance"        valor={bs(stats.balance)}     color={stats.balance >= 0 ? 'blue' : 'rose'} Icono={DollarSign} idx={3} />
      </div>

      {accesoTodas && resumenSucursales.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-xs sm:text-sm">
            <thead>
              <tr className="bg-primary/10 border-b border-border">
                {['Sucursal', 'Ingresos', 'Egresos', 'Neto'].map(h => (
                  <th key={h} className="text-left px-3 py-2.5 sm:px-4 sm:py-3 text-xs font-semibold text-primary uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {resumenSucursales.map(s => (
                <tr key={s.id} className="bg-card">
                  <td className="px-3 py-2.5 sm:px-4 sm:py-3 font-medium text-foreground">{s.nombre}</td>
                  <td className="px-3 py-2.5 sm:px-4 sm:py-3 font-semibold text-emerald-600 dark:text-emerald-400">{bs(s.ingresos)}</td>
                  <td className="px-3 py-2.5 sm:px-4 sm:py-3 font-semibold text-rose-600 dark:text-rose-400">{bs(s.egresos)}</td>
                  <td className={`px-3 py-2.5 sm:px-4 sm:py-3 font-bold ${s.neto >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{bs(s.neto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isLoading ? <Skeleton /> : data.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground text-sm rounded-2xl border border-border">Sin resultados</div>
      ) : (
        <>
          {/* Móvil y tablet: tarjetas */}
          <div className="lg:hidden space-y-2">
            {data.map((r) => (
              <MovimientoCajaCard key={r.id} mov={r} mostrarSucursal={accesoTodas} />
            ))}
            <div className="flex items-center justify-between px-1 pt-1 text-xs font-semibold text-muted-foreground">
              <span>BALANCE</span>
              <span className={stats.balance >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>{bs(stats.balance)}</span>
            </div>
          </div>

          {/* Escritorio: tabla */}
          <div className="hidden lg:block overflow-x-auto rounded-2xl border border-border">
            <table className="w-full text-xs sm:text-sm">
              <thead>
                <tr className="bg-muted border-b border-border">
                  {[...(accesoTodas ? ['Sucursal'] : []), 'Fecha', 'Tipo', 'Concepto', 'Método', 'Usuario', 'Monto'].map(h => (
                    <th key={h} className="text-left px-3 py-2.5 sm:px-4 sm:py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.map((r, i) => (
                  <tr key={r.id}
                    className="bg-card hover:bg-primary/5 transition-colors animate-[rpFadeUp_0.3s_ease_forwards] opacity-0"
                    style={{ animationDelay: `${i * 20}ms` }}>
                    {accesoTodas && (
                      <td className="px-3 py-2.5 sm:px-4 sm:py-3 text-muted-foreground">{r.sucursal?.nombre || '-'}</td>
                    )}
                    <td className="px-3 py-2.5 sm:px-4 sm:py-3 text-muted-foreground whitespace-nowrap">{fechaHora(r.creado_en)}</td>
                    <td className="px-3 py-2.5 sm:px-4 sm:py-3"><BadgeTipo tipo={r.tipo} /></td>
                    <td className="px-3 py-2.5 sm:px-4 sm:py-3 text-foreground">{r.concepto || '-'}</td>
                    <td className="px-3 py-2.5 sm:px-4 sm:py-3 text-muted-foreground capitalize">{r.metodo_pago || '-'}</td>
                    <td className="px-3 py-2.5 sm:px-4 sm:py-3 text-muted-foreground">{r.usuario?.nombre || '-'}</td>
                    <td className={`px-3 py-2.5 sm:px-4 sm:py-3 font-semibold ${r.tipo === 'ingreso' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {r.tipo === 'egreso' ? '-' : ''}{bs(r.monto)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-muted border-t-2 border-primary/30">
                  <td colSpan={accesoTodas ? 6 : 5} className="px-3 py-2.5 sm:px-4 sm:py-3 text-right font-semibold text-muted-foreground text-sm">BALANCE</td>
                  <td className={`px-3 py-2.5 sm:px-4 sm:py-3 font-bold ${stats.balance >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                    {bs(stats.balance)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      <Paginacion pagina={pagina} totalPaginas={totalPaginas} onCambiar={setPagina} />
    </div>
  );
}
