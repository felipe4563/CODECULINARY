import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Package } from 'lucide-react';
import { getReporteInventario, getReporteInventarioResumen } from '../../../api/reportes';
import { useAuth } from '../../../hooks/useAuth';
import { useAuthStore } from '../../../store/authStore';
import { exportarPDF } from '../utils/exportarPDF';
import { FiltroFechas, StatCard, BadgeTipo, Skeleton, fecha, fechaHora, hoy, inicioMes } from '../shared';
import Paginacion from '../../../components/ui/Paginacion';

const TIPOS = ['todos', 'entrada', 'salida', 'venta', 'compra', 'ajuste'];

function MovimientoCard({ mov, mostrarSucursal }) {
  return (
    <div className="bg-card border border-border rounded-xl p-3.5 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground whitespace-nowrap">{fechaHora(mov.creado_en)}</p>
          <p className="font-medium text-foreground truncate">{mov.producto?.nombre || '-'}</p>
        </div>
        <p className="font-bold text-foreground shrink-0 whitespace-nowrap">{mov.cantidad}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <BadgeTipo tipo={mov.tipo} />
        {mostrarSucursal && mov.sucursal?.nombre && (
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
            {mov.sucursal.nombre}
          </span>
        )}
        <span className="text-[11px] text-muted-foreground">
          {mov.stock_anterior ?? '-'} → <span className="font-medium text-primary">{mov.stock_nuevo ?? '-'}</span>
        </span>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border">
        <span className="truncate">{mov.nota || 'Sin nota'}</span>
        <span className="shrink-0 ml-2">{mov.usuario?.nombre || '-'}</span>
      </div>
    </div>
  );
}

export default function TabInventario({ empresa, logo, direccion, telefono }) {
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
  // (mismo patrón usado en LibroCajaPage.jsx / TabVentas.jsx / TabCompras.jsx,
  // Tasks 3, 8 y 9 de este plan).
  const filtrosKey = `${desde}|${hasta}|${filtroSucursal}|${filtroTipo}`;
  const [prevFiltrosKey, setPrevFiltrosKey] = useState(filtrosKey);
  if (filtrosKey !== prevFiltrosKey) {
    setPrevFiltrosKey(filtrosKey);
    setPagina(1);
  }

  const { data: paginaDatos, isLoading } = useQuery({
    queryKey: ['reporte-inventario', filtrosApi, pagina],
    queryFn: () => getReporteInventario({ ...filtrosApi, pagina }),
  });
  const data = useMemo(() => paginaDatos?.filas ?? [], [paginaDatos]);
  const totalPaginas = paginaDatos?.total_paginas ?? 1;

  const { data: resumen } = useQuery({
    queryKey: ['reporte-inventario-resumen', filtrosApi],
    queryFn: () => getReporteInventarioResumen(filtrosApi),
  });
  const sucursales = resumen?.filtros?.sucursales ?? [];

  // Total del rango filtrado completo (no solo la página visible) — viene
  // del endpoint de resumen. El backend (`inventarioResumen`) sólo expone
  // `{ cantidad, filtros: { sucursales } }`, sin desglose por tipo de
  // movimiento ni por sucursal, así que las tarjetas de "Unidades
  // ingresadas/egresadas" y "Ajustes", además de la tabla de resumen por
  // sucursal que existían antes de esta tarea, se eliminaron: calcularlas
  // a partir de `data` (que sólo trae la página visible) mostraría números
  // incorrectos en cuanto la paginación esté activa. Ver nota en el reporte
  // de esta tarea — es una brecha de producto, no algo para inventar aquí.
  const stats = { total: resumen?.cantidad ?? 0 };

  const exportar = async () => {
    setExportando(true);
    try {
      const { filas: todas } = await getReporteInventario({ ...filtrosApi, limite: 0 });
      exportarPDF({
        titulo:        'Reporte de Inventario',
        subtitulo:     `${fecha(desde)} — ${fecha(hasta)}${filtroTipo !== 'todos' ? ` · ${filtroTipo}` : ''}`,
        empresa, logo, direccion, telefono,
        generadoPor:   usuario?.nombre,
        columnas:      ['Fecha', 'Producto', 'Tipo', 'Cantidad', 'Stock Ant.', 'Stock Nuevo', 'Usuario', 'Nota'],
        filas:         todas.map(r => [
          fechaHora(r.creado_en),
          r.producto?.nombre || '-',
          r.tipo,
          r.cantidad,
          r.stock_anterior ?? '-',
          r.stock_nuevo ?? '-',
          r.usuario?.nombre || '-',
          r.nota || '-',
        ]),
        totales: [
          { label: 'Total movimientos', valor: stats.total },
        ],
        nombreArchivo: `reporte-inventario-${desde}-${hasta}.pdf`,
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
              {TIPOS.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
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

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard label="Total movimientos" valor={stats.total} color="primary" Icono={Package} idx={0} />
      </div>

      {isLoading ? <Skeleton /> : data.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground text-sm rounded-2xl border border-border">Sin resultados</div>
      ) : (
        <>
          {/* Móvil y tablet: tarjetas */}
          <div className="lg:hidden space-y-2">
            {data.map((r) => (
              <MovimientoCard key={r.id} mov={r} mostrarSucursal={accesoTodas} />
            ))}
          </div>

          {/* Escritorio: tabla */}
          <div className="hidden lg:block overflow-x-auto rounded-2xl border border-border">
            <table className="w-full text-xs sm:text-sm">
              <thead>
                <tr className="bg-muted border-b border-border">
                  {[...(accesoTodas ? ['Sucursal'] : []), 'Fecha', 'Producto', 'Tipo', 'Cantidad', 'Stock Ant.', 'Stock Nuevo', 'Usuario', 'Nota'].map(h => (
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
                    <td className="px-3 py-2.5 sm:px-4 sm:py-3 font-medium text-foreground">{r.producto?.nombre || '-'}</td>
                    <td className="px-3 py-2.5 sm:px-4 sm:py-3"><BadgeTipo tipo={r.tipo} /></td>
                    <td className="px-3 py-2.5 sm:px-4 sm:py-3 font-semibold text-foreground">{r.cantidad}</td>
                    <td className="px-3 py-2.5 sm:px-4 sm:py-3 text-muted-foreground">{r.stock_anterior ?? '-'}</td>
                    <td className="px-3 py-2.5 sm:px-4 sm:py-3 font-medium text-primary">{r.stock_nuevo ?? '-'}</td>
                    <td className="px-3 py-2.5 sm:px-4 sm:py-3 text-muted-foreground">{r.usuario?.nombre || '-'}</td>
                    <td className="px-3 py-2.5 sm:px-4 sm:py-3 text-muted-foreground text-xs">{r.nota || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Paginacion pagina={pagina} totalPaginas={totalPaginas} onCambiar={setPagina} />
    </div>
  );
}
