import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Layers, ShoppingCart, DollarSign, Trophy } from 'lucide-react';
import { getReporteVentasProductos, getReporteVentasResumen } from '../../../api/reportes';
import { useAuth } from '../../../hooks/useAuth';
import { useAuthStore } from '../../../store/authStore';
import { exportarPDF } from '../utils/exportarPDF';
import { FiltroFechas, StatCard, Skeleton, bs, fecha, hoy, inicioMes } from '../shared';

const puestoClase = (i) =>
  i === 0 ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400'
  : i === 1 ? 'bg-muted text-foreground'
  : i === 2 ? 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400'
  : 'bg-muted text-muted-foreground';

function ProductoCard({ producto, i, maxCantidad, pct }) {
  return (
    <div className="bg-card border border-border rounded-xl p-3.5 flex items-center gap-3">
      <span className={`shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${puestoClase(i)}`}>{i + 1}</span>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-foreground truncate">{producto.nombre}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {producto.cantidad.toLocaleString('es-BO', { maximumFractionDigits: 2 })} · {pct.toFixed(1)}%
          </span>
          <div className="flex-1 min-w-[2.5rem] h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary rounded-full" style={{ width: `${Math.max((producto.cantidad / maxCantidad) * 100, 4)}%` }} />
          </div>
        </div>
      </div>
      <p className="font-bold text-emerald-600 dark:text-emerald-400 shrink-0 whitespace-nowrap">{bs(producto.monto)}</p>
    </div>
  );
}

export default function TabProductos({ empresa, logo, direccion, telefono }) {
  const { usuario } = useAuth();
  const accesoTodas = useAuthStore((s) => s.usuario?.sucursal_activa?.id == null);
  const [filtroSucursal, setFiltroSucursal] = useState('todas');
  const [desde, setDesde] = useState(inicioMes());
  const [hasta, setHasta] = useState(hoy());
  const [params, setParams] = useState({ desde: inicioMes(), hasta: hoy() });

  const filtrosApi = {
    ...params,
    sucursal_id: accesoTodas && filtroSucursal !== 'todas' ? filtroSucursal : undefined,
  };

  const { data = [], isLoading } = useQuery({
    queryKey: ['reporte-ventas-productos', filtrosApi],
    queryFn: () => getReporteVentasProductos(filtrosApi),
  });

  const { data: resumen } = useQuery({
    queryKey: ['reporte-ventas-resumen', filtrosApi],
    queryFn: () => getReporteVentasResumen(filtrosApi),
  });
  const sucursales = resumen?.filtros?.sucursales ?? [];

  const productos = data;

  const stats = useMemo(() => {
    const ingresoTotal = productos.reduce((s, p) => s + p.monto, 0);
    return {
      distintos: productos.length,
      ventas: resumen?.cantidad ?? 0,
      ingresoTotal,
      top: productos[0] || null,
    };
  }, [productos, resumen]);

  const maxCantidad = productos[0]?.cantidad || 1;

  const exportar = () => exportarPDF({
    titulo:        'Productos Más Vendidos',
    subtitulo:     `${fecha(params.desde)} — ${fecha(params.hasta)}`,
    empresa, logo, direccion, telefono,
    generadoPor:   usuario?.nombre,
    columnas:      ['#', 'Producto', 'Cantidad', 'Monto generado', '% del ingreso'],
    filas:         productos.map((p, i) => [
      i + 1,
      p.nombre,
      p.cantidad.toLocaleString('es-BO', { maximumFractionDigits: 2 }),
      bs(p.monto),
      stats.ingresoTotal > 0 ? `${((p.monto / stats.ingresoTotal) * 100).toFixed(1)}%` : '0%',
    ]),
    totales: [
      { label: 'Productos distintos', valor: stats.distintos },
      { label: 'N° Ventas',           valor: stats.ventas },
      { label: 'Ingreso generado',    valor: bs(stats.ingresoTotal) },
      { label: 'Más vendido',         valor: stats.top?.nombre || '-' },
    ],
    nombreArchivo: `productos-mas-vendidos-${params.desde}-${params.hasta}.pdf`,
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end sm:justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <FiltroFechas desde={desde} hasta={hasta} setDesde={setDesde} setHasta={setHasta}
            onBuscar={() => setParams({ desde, hasta })} cargando={isLoading} />
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
        <button onClick={exportar} disabled={!productos.length}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-40 w-full sm:w-auto">
          <Download className="w-4 h-4" /> Exportar PDF
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard label="Productos distintos" valor={stats.distintos}             color="primary" Icono={Layers}       idx={0} />
        <StatCard label="N° Ventas"           valor={stats.ventas}                color="blue"    Icono={ShoppingCart} idx={1} />
        <StatCard label="Ingreso generado"    valor={bs(stats.ingresoTotal)}      color="emerald" Icono={DollarSign}   idx={2} />
        <StatCard label="Más vendido"         valor={stats.top?.nombre || '-'}    color="amber"   Icono={Trophy}       idx={3} />
      </div>

      {isLoading ? <Skeleton /> : productos.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground text-sm rounded-2xl border border-border">Sin ventas para el período</div>
      ) : (
        <>
          {/* Móvil y tablet: tarjetas */}
          <div className="lg:hidden space-y-2">
            {productos.map((p, i) => (
              <ProductoCard key={p.id} producto={p} i={i} maxCantidad={maxCantidad}
                pct={stats.ingresoTotal > 0 ? (p.monto / stats.ingresoTotal) * 100 : 0} />
            ))}
            <div className="flex items-center justify-between px-1 pt-1 text-xs font-semibold text-muted-foreground">
              <span>TOTAL</span>
              <span className="text-emerald-600 dark:text-emerald-400">{bs(stats.ingresoTotal)}</span>
            </div>
          </div>

          {/* Escritorio: tabla */}
          <div className="hidden lg:block overflow-x-auto rounded-2xl border border-border">
            <table className="w-full text-xs sm:text-sm">
              <thead>
                <tr className="bg-muted border-b border-border">
                  {['#', 'Producto', 'Cantidad vendida', 'Monto generado', '% del ingreso'].map(h => (
                    <th key={h} className="text-left px-3 py-2.5 sm:px-4 sm:py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {productos.map((p, i) => {
                  const pct = stats.ingresoTotal > 0 ? (p.monto / stats.ingresoTotal) * 100 : 0;
                  return (
                    <tr key={p.id}
                      className="bg-card hover:bg-primary/5 transition-colors animate-[rpFadeUp_0.3s_ease_forwards] opacity-0"
                      style={{ animationDelay: `${i * 20}ms` }}>
                      <td className="px-3 py-2.5 sm:px-4 sm:py-3">
                        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${puestoClase(i)}`}>{i + 1}</span>
                      </td>
                      <td className="px-3 py-2.5 sm:px-4 sm:py-3 font-medium text-foreground">{p.nombre}</td>
                      <td className="px-3 py-2.5 sm:px-4 sm:py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-foreground whitespace-nowrap">
                            {p.cantidad.toLocaleString('es-BO', { maximumFractionDigits: 2 })}
                          </span>
                          <div className="hidden sm:block flex-1 min-w-[3rem] max-w-[6rem] h-1.5 rounded-full bg-muted overflow-hidden">
                            <div className="h-full bg-primary rounded-full" style={{ width: `${Math.max((p.cantidad / maxCantidad) * 100, 4)}%` }} />
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 sm:px-4 sm:py-3 font-semibold text-emerald-600 dark:text-emerald-400">{bs(p.monto)}</td>
                      <td className="px-3 py-2.5 sm:px-4 sm:py-3 text-muted-foreground">{pct.toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-muted border-t-2 border-primary/30">
                  <td colSpan={3} className="px-3 py-2.5 sm:px-4 sm:py-3 text-right font-semibold text-muted-foreground text-sm">TOTAL</td>
                  <td className="px-3 py-2.5 sm:px-4 sm:py-3 font-bold text-emerald-600 dark:text-emerald-400">{bs(stats.ingresoTotal)}</td>
                  <td className="px-3 py-2.5 sm:px-4 sm:py-3 font-semibold text-muted-foreground">100%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
