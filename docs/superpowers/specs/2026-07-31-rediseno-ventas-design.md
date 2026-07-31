# Rediseño Visual: VentasPage + Modales de Venta

**Fecha:** 2026-07-31
**Alcance:** `frontend/src/pages/ventas/VentasPage.jsx` y los 7 componentes en `frontend/src/pages/ventas/components/`: `ModalLlevar.jsx`, `ModalMesas.jsx`, `TarjetaMesa.jsx`, `CategoriasBar.jsx`, `ModalPeso.jsx`, `ModalPagoQr.jsx`, `SelectorOpcionModal.jsx`. Ningún otro archivo.

## Goal

Estas páginas todavía usan la paleta Tailwind fija de antes del rediseño (`bg-white dark:bg-gray-800`, `bg-blue-600`, etc.), por lo que el color de marca (`color_primario`/`color_secundario`, configurable por el negocio) no se refleja ahí — a diferencia del Dashboard y el chrome (Layout/Topbar/Sidebar), ya retoneados en fases anteriores. Este trabajo aplica el mismo sistema de tokens (`bg-card`, `text-foreground`, `bg-primary`, etc., definidos en `frontend/src/index.css`/`frontend/tailwind.config.js`) a la pantalla principal de venta y todos sus modales, sin cambiar layout, lógica, ni comportamiento — es un cambio puramente de clases de color.

## Mapeo de tokens (mismo criterio que el Dashboard)

| Elemento | Antes | Después |
|---|---|---|
| Fondos de card/modal/panel | `bg-white dark:bg-gray-800` | `bg-card` |
| Bordes | `border-gray-200 dark:border-gray-700` (y variantes 100/600) | `border-border` |
| Texto principal | `text-gray-800/900 dark:text-gray-100/white` | `text-foreground` |
| Texto secundario/labels | `text-gray-400/500 dark:text-gray-400/500` | `text-muted-foreground` |
| Fondos internos (inputs, chips inactivos, skeletons) | `bg-gray-50/100 dark:bg-gray-700` | `bg-muted` / `bg-background` según el caso (inputs → `bg-background`, chips/skeletons → `bg-muted`) |
| Acción principal / estado activo / seleccionado (botón Cobrar, categoría activa, chip de área activo, tab activo, foco de inputs) | `bg-blue-600`, `focus:ring-blue-500`, `ring-blue-500`, `hover:border-blue-400` | `bg-primary text-primary-foreground`, `focus:ring-ring`, `ring-ring`, `hover:border-primary` |
| Botón "eliminar de la orden" / cancelar | `text-red-500 hover:text-red-600` | `text-destructive` (token ya definido en `index.css`/`tailwind.config.js` desde la Fase 1) — es semántico (acción destructiva), no de marca, pero usa el token en vez de un hex fijo por consistencia con el resto de la app (ej. Topbar ya usa `hover:bg-destructive/10 hover:text-destructive`). |

**Se mantienen sin cambio** (colores semánticos/categóricos, no de marca — mismo criterio que `PALETA`/`COLORES_METODO` en el Dashboard):
- Estados de mesa en `TarjetaMesa.jsx` y la leyenda de `ModalMesas.jsx`: disponible=verde, ocupada=rojo, reservada=ámbar.
- Colores de estado del pago QR en `ModalPagoQr.jsx` (rojo para fallido/expirado) — son mensajes de estado, no acciones de marca.

**Caso especial — "Para llevar":**
- El botón "Crear pedido" en `ModalLlevar.jsx` pasa a `bg-primary` (es una acción real, no un indicador).
- El toggle "Para llevar" en `VentasPage.jsx` (que hoy es naranja tanto inactivo como activo) mantiene un tinte naranja suave como indicador visual de "modo distinto a mesa" — para no confundirse visualmente con "mesa seleccionada", que ahora será del color de marca (`bg-primary`). Es decir: dos estados visualmente distintos por diseño (mesa = marca, llevar = naranja fijo), no un error de tokenización.

## Testing

No hay test runner de frontend en este proyecto (restricción ya documentada). Verificación: `npm run lint` + `npm run build` + inspección manual en navegador (pendiente para el usuario, no disponible para subagentes).

## Fuera de alcance

- `ProductosPage.jsx`, `PedidoPage.jsx`, `CocinaPage.jsx`, `CajaPage.jsx`, `ReportesPage.jsx` y el resto de páginas administrativas — quedan para futuras iteraciones si se piden.
- Cualquier cambio de comportamiento, layout, o lógica — es estrictamente un cambio de clases de color.
