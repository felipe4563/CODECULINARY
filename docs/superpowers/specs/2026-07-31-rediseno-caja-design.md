# Rediseño Visual: CajaPage

**Fecha:** 2026-07-31
**Alcance:** `frontend/src/pages/caja/CajaPage.jsx` únicamente — la página principal y los componentes que contiene en el mismo archivo (`TarjetaCaja`, `MetricCard`, `ModalAbrirCaja`, `ModalCerrarCaja`, `ModalGasto`, `ModalReporte`). Ningún otro archivo.

## Goal

`CajaPage.jsx` (apertura/cierre de caja, arqueo, historial de sesiones) todavía usa la paleta Tailwind fija de antes del rediseño (`bg-white dark:bg-gray-800`, `bg-blue-600`, `focus:ring-blue-500`, etc.), por lo que el color de marca (`color_primario`/`color_secundario`) no se refleja ahí — a diferencia del Dashboard y VentasPage, ya retoneados. Este trabajo aplica el mismo sistema de tokens shadcn a CajaPage, sin cambiar layout, lógica, ni comportamiento — es un cambio puramente de clases de color. Esto incluye la funcionalidad de reimpresión de tickets (`reimprimirVenta`/`reimprimirConFallback`) ya presente en el archivo — sus clases de color se retonan igual que el resto, pero su lógica no se toca.

## Mapeo de tokens (mismo criterio que Dashboard/VentasPage)

| Elemento | Antes | Después |
|---|---|---|
| Fondos de card/modal | `bg-white dark:bg-gray-800` | `bg-card` |
| Bordes | `border-gray-200 dark:border-gray-700` (y variantes 100/600) | `border-border` |
| Texto principal | `text-gray-800/900 dark:text-gray-100` | `text-foreground` |
| Texto secundario/labels | `text-gray-400/500 dark:text-gray-400` | `text-muted-foreground` |
| Fondos internos (inputs, filas de tabla/hover, chips neutros, toggle inactivo) | `bg-gray-50/100 dark:bg-gray-700` | `bg-muted` (chips/filas/toggle) o `bg-background` (inputs) según el caso |
| Botón de acción principal (Abrir Caja, Registrar gasto/Registrar, Cerrar reporte) + focus rings + pestaña activa del toggle "Conteo detallado"/"Monto total" | `bg-blue-600 hover:bg-blue-700`, `focus:ring-blue-500` | `bg-primary hover:bg-primary/90 text-primary-foreground`, `focus:ring-ring`/`ring-ring` |
| "Confirmar cierre" (botón sólido — acción final que cierra la sesión de caja) | `bg-red-600 hover:bg-red-700` | `bg-destructive hover:bg-destructive/90 text-destructive-foreground` |
| "Cerrar Caja" (botón outline) y mensajes de error de formulario | `text-red-500/600 dark:text-red-400`, `border-red-200 dark:border-red-900` | `text-destructive`, `border-destructive/30` |

**Se mantiene sin cambio** (paleta categórica fija, mismo criterio que las StatCards del Dashboard — no son acciones ni marca, son categorías visuales de datos):
- Las 3 `MetricCard` en la vista de detalle de sesión: Apertura (azul), Ventas (verde), Gastos (rojo) — objeto `colores` interno de `MetricCard`.
- El indicador de "Diferencia" (`diferenciaColor()`): verde si es exacto (`< 0.01` de diferencia absoluta), azul si sobra, rojo si falta — en el resumen de sesión, en `ModalCerrarCaja`, y en `ModalReporte`.
- Chips de método de pago en `ModalReporte`: efectivo (verde), QR/transferencia (azul).
- Badge de estado "Caja Abierta"/"Abierta" (verde con punto pulsante) y "Disponible" (gris neutro) en `TarjetaCaja` y en la vista de detalle.
- Avisos ámbar existentes ("solo X puede cerrar/registrar gastos aquí", "ingresa el conteo antes de cerrar") — ya usan el patrón ámbar de advertencia establecido en el resto de la app, sin cambios.
- El ícono de éxito verde (`CheckCircle2`) en `ModalReporte` al confirmar el cierre.

## Testing

No hay test runner de frontend en este proyecto (restricción ya documentada). Verificación: `npm run lint` + `npm run build` + inspección manual en navegador (pendiente para el usuario, no disponible para subagentes) — cubrir: apertura de caja, cierre con conteo detallado y con monto total, registro de gasto, ver detalle de sesión abierta, historial de cierres (vista mobile en tabla apilada y vista desktop en tabla), reporte final con reimpresión de ticket, todo en modo claro y oscuro, con el color de marca configurado.

## Fuera de alcance

- Cualquier otro archivo (`ProductosPage.jsx`, `PedidoPage.jsx`, `CocinaPage.jsx`, `ReportesPage.jsx`, etc.) — quedan para futuras iteraciones si se piden.
- La lógica de reimpresión de tickets (`reimprimirVenta`, `reimprimirConFallback`) — se retonan sus clases de color en el botón/mensajes de error, pero la lógica funcional no se toca.
- Cualquier cambio de comportamiento, layout, o estructura de datos — es estrictamente un cambio de clases de color.
