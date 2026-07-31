# Dashboard: Métricas de Gastos/Margen + Rediseño Visual

**Fecha:** 2026-07-31
**Alcance:** `frontend/src/pages/Dashboard.jsx` únicamente. Sin cambios de backend (los endpoints necesarios ya existen).

## Goal

El Dashboard actual (`frontend/src/pages/Dashboard.jsx`) solo cubre ventas y estado de caja, y usa colores Tailwind fijos (`indigo-600`, `gray-800`, ...) que ya no combinan con el resto de la app tras el rediseño de Sidebar/Topbar/Layout a shadcn/ui (tokens `bg-card`, `text-foreground`, `bg-primary`, etc.). Este trabajo agrega métricas de gastos/margen neto usando datos que ya existen en la BD, y retonea el componente a los tokens del sistema de diseño vigente, incluyendo que el color de marca configurado por el negocio (`color_primario`/`color_secundario`, vía `BrandTheme`) se refleje en los gráficos principales.

## Arquitectura

Todo el trabajo vive en un único componente de página (`Dashboard.jsx`), sin nuevos archivos. Se reutiliza el patrón ya existente de `useQuery` + filtrado client-side por rango de fecha (día/mes/año) que ya usan `ventasFiltradas`/`datosArea`. Se agrega una query hermana para `libro_caja` y un `useMemo` de agregación análogo a los que ya existen, gateado por el mismo patrón de permisos (`tiene(usuario, modulo, accion)`) que ya gatea `puedeVerVentas`/`puedeVerCaja`.

## Datos y permisos

- **Endpoint:** `getLibroCaja()` (`frontend/src/api/libroCaja.js`, ya existe) → `GET /libro-caja`, gateado en backend por permiso `libro_caja.ver` (`backend/src/modules/libro_caja/libro_caja.routes.js:9`). Sin `sesion_caja_id`, devuelve todos los movimientos de la sucursal (o todas, si `acceso_todas_sucursales`), con `tipo: 'ingreso'|'egreso'`, `monto`, `creado_en`.
- **Nuevo permiso gate en frontend:** `puedeVerGastos = tiene(usuario, 'libro_caja', 'ver')`. Todo lo nuevo (cards + gráfico) se renderiza solo si `puedeVerGastos` es `true`; si no, el Dashboard se comporta exactamente igual que hoy.
- **Query:**
  ```js
  const { data: movimientosCaja = [], isLoading: cvGastos } = useQuery({
    queryKey: ['libro-caja-dashboard'],
    queryFn: getLibroCaja,
    enabled: puedeVerGastos,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  ```
- **Filtrado:** mismo criterio de rango que `ventasFiltradas` (por `tipo`/`diaVal`/`mesVal`/`añoVal`), pero sobre `movimientosCaja.filter(m => m.tipo === 'egreso')`.

## Métricas nuevas

1. **StatCard "Gastos del período"** — suma de `monto` de los egresos filtrados. Color semántico: usa la paleta existente de `StatCard` (nueva entrada o reuso de `amber`/`red` — a decidir en implementación, con criterio de "no duplicar visualmente con Canceladas").
2. **StatCard "Margen neto"** — `totalPeriodo - totalGastosPeriodo`. Si el valor es negativo, se muestra en rojo (usar la variante `red` de `CARD_PALETTE`); si es positivo, variante `emerald` (ya definida en `CARD_PALETTE` pero actualmente sin uso en el JSX).
3. **Gráfico "Ingresos vs Gastos"** — mismo patrón de buckets que `datosArea` (por hora si `tipo==='dia'`, por día si `tipo==='mes'`, por mes si `tipo==='año'`), agregando `gastos: <suma egresos del bucket>` junto al `total` (ingresos) ya calculado. Se implementa como un `AreaChart` o `BarChart` nuevo (a decidir en el plan, siguiendo el patrón visual de los gráficos existentes), gateado por `puedeVerVentas && puedeVerGastos` (necesita ambos datasets).

Todas las métricas nuevas respetan el estado de carga (`cvGastos`) con el mismo patrón `animate-pulse` que ya usan las StatCard existentes.

## Rediseño visual

Reemplazo de clases Tailwind fijas por tokens del sistema de diseño (`frontend/src/index.css`, `tailwind.config.js`) ya usados en `Layout.jsx`/`Topbar.jsx`/`Sidebar.jsx`:

| Elemento | Antes | Después |
|---|---|---|
| Fondos de card (StatCard, ChartCard, filtros, "sin datos") | `bg-white dark:bg-gray-800` | `bg-card` |
| Bordes de card | `border-gray-100 dark:border-gray-700` | `border-border` |
| Texto principal | `text-gray-700 dark:text-gray-200`, `text-gray-900 dark:text-white` | `text-foreground` |
| Texto secundario/labels | `text-gray-500 dark:text-gray-400`, `text-gray-400 dark:text-gray-500` | `text-muted-foreground` |
| Fondos internos (skeleton, tabs container) | `bg-gray-100 dark:bg-gray-700` | `bg-muted` |
| Tab activo (Día/Mes/Año) | `bg-indigo-600 text-white` | `bg-primary text-primary-foreground` |
| Tab inactivo hover | `text-gray-500 hover:text-gray-800` | `text-muted-foreground hover:text-foreground` |
| Inputs de fecha | `border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700` | `border-input bg-background` (o el patrón que ya use `Modal.jsx`/formularios shadcn) |
| Header gradiente de saludo | `linear-gradient(135deg, #4f46e5, #7c3aed, #2563eb)` fijo | `linear-gradient` usando `hsl(var(--primary))` → `hsl(var(--accent))`, para que responda al color de marca configurado |
| Stroke/fill del gráfico principal de Ingresos | `#6366f1` fijo | `hsl(var(--primary))` |
| Stroke/fill del nuevo gráfico Ingresos vs Gastos | — | Ingresos: `hsl(var(--primary))`; Gastos: color semántico de gasto (p.ej. `hsl(var(--destructive))` o un naranja/ámbar fijo — a decidir en plan) |

**Se mantienen sin cambio** (colores categóricos, no de marca):
- `PALETA` (array de 8 colores para Top productos).
- `COLORES_METODO` (colores fijos por método de pago: efectivo/qr/transferencia/otro) — son códigos de color con significado semántico propio (verde=efectivo, etc.), no deben derivar de la marca.
- El color de la serie secundaria "pedidos" (`#10b981`) en el AreaChart de Ingresos — es una serie categórica distinta del "ingreso" de marca.

**Nota técnica:** los componentes de Recharts (`stroke`, `fill`) no aceptan clases Tailwind, necesitan un valor de color usable en SVG. Usar el literal CSS `hsl(var(--primary))` funciona directamente como valor de color en navegadores modernos y ya es el mecanismo que usa `BrandTheme.jsx` para inyectar las variables — no requiere JS adicional para leer el valor computado.

## Testing

No existe test runner de frontend en este proyecto (restricción ya documentada). La verificación de este trabajo es manual: cargar el Dashboard con datos de ventas y movimientos de caja de prueba, confirmar que las nuevas cards/gráfico aparecen solo con el permiso `libro_caja.ver`, y verificar visualmente que los tokens de color responden a cambios de `color_primario`/`color_secundario` en Configuración (modo claro y oscuro).

## Fuera de alcance

- Compras/proveedores, stock bajo, ticket promedio y clientes nuevos (mencionados como opciones pero no seleccionados) — quedan para una futura iteración si se piden.
- Cambios de backend: no se necesitan, los endpoints existentes ya devuelven los datos requeridos.
- Cambios a otras páginas: este spec cubre únicamente `Dashboard.jsx`.
