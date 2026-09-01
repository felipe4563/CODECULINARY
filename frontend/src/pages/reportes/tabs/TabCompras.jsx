import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Truck, DollarSign } from 'lucide-react';
import { getReporteCompras, getReporteComprasResumen } from '../../../api/reportes';
import { useAuth } from '../../../hooks/useAuth';
import { useAuthStore } from '../../../store/authStore';
import { exportarPDF } from '../utils/exportarPDF';
import { FiltroFechas, StatCard, BadgeTipo, Skeleton, bs, fecha, fechaHora, hoy, inicioMes } from '../shared';
import Paginacion from '../../../components/ui/Paginacion';

function CompraCard({ compra, mostrarSucursal }) {
  return (
    <div className="bg-card border border-border rounded-xl p-3.5 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground whitespace-nowrap">{fechaHora(compra.creado_en)}</p>
          <p className="font-medium text-foreground truncate">{compra.proveedor?.nombre || '-'}</p>
        </div>
        <p className="font-bold text-blue-600 dark:text-blue-400 shrink-0 whitespace-nowrap">{bs(compra.total)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <BadgeTipo tipo={compra.estado} />
        {mostrarSucursal && compra.sucursal?.nombre && (
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
            {compra.sucursal.nombre}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border">
        <span className="truncate">{compra.notas || 'Sin notas'}</span>
        <span className="shrink-0 ml-2">{compra.usuario?.nombre || '-'}</span>
      </div>
    </div>
  );
}

export default function TabCompras({ empresa, logo, direccion, telefono }) {
  const { usuario } = useAuth();
  const accesoTodas = useAuthStore((s) => s.usuario?.sucursal_activa?.id == null);
  const [filtroSucursal, setFiltroSucursal] = useState('todas');
  const [desde, setDesde] = useState(inicioMes());
  const [hasta, setHasta] = useState(hoy());
  const [filtroEstado, setFiltroEstado] = useState('todos');
  const [params, setParams] = useState({ desde: inicioMes(), hasta: hoy() });
  const [pagina, setPagina] = useState(1);
  const [exportando, setExportando] = useState(false);

  const filtrosApi = {
    ...params,
    sucursal_id: accesoTodas && filtroSucursal !== 'todas' ? filtroSucursal : undefined,
    estado: filtroEstado !== 'todos' ? filtroEstado : undefined,
  };

  // Vuelve a página 1 cuando cambia cualquier filtro (evita quedar en una
  // página que ya no existe). Se ajusta el estado durante el render en vez
  // de un useEffect para no disparar el lint react-hooks/set-state-in-effect
  // (mismo patrón usado en LibroCajaPage.jsx / TabVentas.jsx, Tasks 3 y 8).
  const filtrosKey = `${params.desde}|${params.hasta}|${filtroSucursal}|${filtroEstado}`;
  const [prevFiltrosKey, setPrevFiltrosKey] = useState(filtrosKey);
  if (filtrosKey !== prevFiltrosKey) {
    setPrevFiltrosKey(filtrosKey);
    setPagina(1);
  }

  const { data: paginaDatos, isLoading } = useQuery({
    queryKey: ['reporte-compras', filtrosApi, pagina],
    queryFn: () => getReporteCompras({ ...filtrosApi, pagina }),
  });
  const data = useMemo(() => paginaDatos?.filas ?? [], [paginaDatos]);
  const totalPaginas = paginaDatos?.total_paginas ?? 1;

  const { data: resumen } = useQuery({
    queryKey: ['reporte-compras-resumen', filtrosApi],
    queryFn: () => getReporteComprasResumen(filtrosApi),
  });
  const sucursales = resumen?.filtros?.sucursales ?? [];

  // Totales del rango filtrado completo (no solo la página visible) —
  // vienen del endpoint de resumen, no se derivan de `data`.
  const stats = {
    count: resumen?.cantidad ?? 0,
    total: resumen?.total_comprado ?? 0,
  };

  const resumenSucursales = useMemo(() => {
    if (!accesoTodas) return [];
    const mapa = new Map();
    data.forEach(c => {
      const id = c.sucursal?.id;
      if (id == null) return;
      if (!mapa.has(id)) mapa.set(id, { id, nombre: c.sucursal.nombre, count: 0, total: 0 });
      const s = mapa.get(id);
      s.count += 1;
      s.total += parseFloat(c.total || 0);
    });
    return Array.from(mapa.values()).sort((a, b) => b.total - a.total);
  }, [data, accesoTodas]);

  const exportar = async () => {
    setExportando(true);
    try {
      const { filas: todas } = await getReporteCompras({ ...filtrosApi, limite: 0 });
      exportarPDF({
        titulo:        'Reporte de Compras',
        subtitulo:     `${fecha(params.desde)} — ${fecha(params.hasta)}`,
        empresa, logo, direccion, telefono,
        generadoPor:   usuario?.nombre,
        columnas:      ['Fecha', 'Proveedor', 'Estado', 'Registrado por', 'Total', 'Notas'],
        filas:         todas.map(c => [
          fechaHora(c.creado_en),
          c.proveedor?.nombre || '-',
          c.estado,
          c.usuario?.nombre || '-',
          bs(c.total),
          c.notas || '-',
        ]),
        totales: [
          { label: 'N° Compras',  valor: stats.count },
          { label: 'Total',       valor: bs(stats.total) },
        ],
        nombreArchivo: `reporte-compras-${params.desde}-${params.hasta}.pdf`,
      });
    } finally {
      setExportando(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end sm:justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <FiltroFechas desde={desde} hasta={hasta} setDesde={setDesde} setHasta={setHasta}
            onBuscar={() => setParams({ desde, hasta })} cargando={isLoading} />
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Estado</label>
            <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}
              className="px-3 py-2 text-sm rounded-xl border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
              <option value="todos">Todos</option>
              <option value="pendiente">Pendiente</option>
              <option value="recibido">Recibido</option>
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

      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <StatCard label="N° Compras"  valor={stats.count}            color="primary" Icono={Truck}       idx={0} />
        <StatCard label="Total"       valor={bs(stats.total)}        color="blue"    Icono={DollarSign}  idx={1} />
      </div>

      {accesoTodas && resumenSucursales.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-xs sm:text-sm">
            <thead>
              <tr className="bg-primary/10 border-b border-border">
                {['Sucursal', 'N° Compras', 'Total'].map(h => (
                  <th key={h} className="text-left px-3 py-2.5 sm:px-4 sm:py-3 text-xs font-semibold text-primary uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {resumenSucursales.map(s => (
                <tr key={s.id} className="bg-card">
                  <td className="px-3 py-2.5 sm:px-4 sm:py-3 font-medium text-foreground">{s.nombre}</td>
                  <td className="px-3 py-2.5 sm:px-4 sm:py-3 text-foreground">{s.count}</td>
                  <td className="px-3 py-2.5 sm:px-4 sm:py-3 font-semibold text-blue-600 dark:text-blue-400">{bs(s.total)}</td>
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
            {data.map((c) => (
              <CompraCard key={c.id} compra={c} mostrarSucursal={accesoTodas} />
            ))}
            <div className="flex items-center justify-between px-1 pt-1 text-xs font-semibold text-muted-foreground">
              <span>TOTAL ({stats.count})</span>
              <span className="text-blue-600 dark:text-blue-400">{bs(stats.total)}</span>
            </div>
          </div>

          {/* Escritorio: tabla */}
          <div className="hidden lg:block overflow-x-auto rounded-2xl border border-border">
            <table className="w-full text-xs sm:text-sm">
              <thead>
                <tr className="bg-muted border-b border-border">
                  {[...(accesoTodas ? ['Sucursal'] : []), 'Fecha', 'Proveedor', 'Estado', 'Registrado por', 'Total', 'Notas'].map(h => (
                    <th key={h} className="text-left px-3 py-2.5 sm:px-4 sm:py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.map((c, i) => (
                  <tr key={c.id}
                    className="bg-card hover:bg-primary/5 transition-colors animate-[rpFadeUp_0.3s_ease_forwards] opacity-0"
                    style={{ animationDelay: `${i * 20}ms` }}>
                    {accesoTodas && (
                      <td className="px-3 py-2.5 sm:px-4 sm:py-3 text-muted-foreground">{c.sucursal?.nombre || '-'}</td>
                    )}
                    <td className="px-3 py-2.5 sm:px-4 sm:py-3 text-muted-foreground whitespace-nowrap">{fechaHora(c.creado_en)}</td>
                    <td className="px-3 py-2.5 sm:px-4 sm:py-3 font-medium text-foreground">{c.proveedor?.nombre || '-'}</td>
                    <td className="px-3 py-2.5 sm:px-4 sm:py-3"><BadgeTipo tipo={c.estado} /></td>
                    <td className="px-3 py-2.5 sm:px-4 sm:py-3 text-muted-foreground">{c.usuario?.nombre || '-'}</td>
                    <td className="px-3 py-2.5 sm:px-4 sm:py-3 font-semibold text-blue-600 dark:text-blue-400">{bs(c.total)}</td>
                    <td className="px-3 py-2.5 sm:px-4 sm:py-3 text-muted-foreground text-xs">{c.notas || '-'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-muted border-t-2 border-primary/30">
                  <td colSpan={accesoTodas ? 5 : 4} className="px-3 py-2.5 sm:px-4 sm:py-3 text-right font-semibold text-muted-foreground text-sm">TOTAL</td>
                  <td className="px-3 py-2.5 sm:px-4 sm:py-3 font-bold text-blue-600 dark:text-blue-400">
                    {bs(stats.total)}
                  </td>
                  <td />
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
