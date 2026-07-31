# Mejoras de diseño: Sidebar

**Fecha:** 2026-07-31
**Alcance:** `frontend/src/components/layout/Sidebar.jsx`, nuevo `frontend/src/components/ui/tooltip.jsx`, `frontend/package.json` (nueva dependencia `@radix-ui/react-tooltip`). Ningún otro archivo.

**Nota:** desde que se escribió este spec, `main` migró los primitivos shadcn a nombres de archivo en minúsculas (`ui/dialog.jsx`, `ui/button.jsx`) — el plan de implementación usa `ui/tooltip.jsx` para seguir esa convención.

## Goal

El sidebar (`Sidebar.jsx`) ya está retoneado a los tokens shadcn, pero tiene cuatro puntos de fricción visual/UX identificados en revisión:

1. En modo colapsado (icon-only), el ítem activo solo se distingue por el color de fondo — poco visible con poca superficie.
2. Los 14 ítems de navegación son una lista plana sin jerarquía, difícil de escanear para roles con muchos permisos.
3. El tooltip de los ítems en modo colapsado usa el `title` nativo del navegador — lento y visualmente inconsistente con el resto de la app.
4. Mientras carga la configuración del negocio (`getConfiguracion`), el header muestra el ícono genérico un instante antes del logo/nombre real, sin indicar que está cargando.

Este trabajo resuelve los cuatro puntos, sin cambiar rutas, permisos, ni comportamiento de navegación — es una mejora de diseño e interacción sobre el componente existente.

## 1. Indicador de ítem activo

El `NavLink` activo gana un borde izquierdo de 3px, superpuesto al `bg-primary` de fondo que ya tiene. Implementación: el `NavLink` recibe `relative` en su className, y cuando `isActive` se agrega un `<span aria-hidden className="absolute left-0 top-0 bottom-0 w-[3px] bg-primary-foreground rounded-r" />` como primer hijo, antes del ícono. Este approach (span absoluto en vez de `border-l`) evita que el borde desplace el contenido o interactúe con el padding condicional de `itemAlign` — el `NavLink` ya tiene (o gana) `relative`, y el span se posiciona independientemente del `justify-center`/`justify-start` que varía por breakpoint. Visible en los 3 breakpoints (móvil, tablet icon-only, desktop expandido/colapsado), tanto centrado como alineado a la izquierda.

## 2. Agrupación en 3 secciones plegables

`NAV_ITEMS` se reestructura en 3 grupos con clave, label y lista de ítems:

```js
const NAV_GROUPS = [
  {
    key: 'operacion',
    label: 'Operación',
    items: [
      { to: '/',           label: 'Dashboard',    Icono: LayoutDashboard, siempre: true },
      { to: '/ventas',     label: 'Ventas / POS',  Icono: UtensilsCrossed, modulo: 'ventas',     accion: 'ver' },
      { to: '/cocina',     label: 'Cocina',        Icono: ChefHat,         modulo: 'cocina',     accion: 'ver' },
      { to: '/caja',       label: 'Caja',          Icono: Wallet,          modulo: 'caja',       accion: 'ver' },
      { to: '/libro-caja', label: 'Libro Caja',    Icono: BookOpen,        modulo: 'libro_caja', accion: 'ver' },
    ],
  },
  {
    key: 'catalogo',
    label: 'Catálogo',
    items: [
      { to: '/productos',  label: 'Productos',   Icono: Package, modulo: 'inventario', accion: 'ver' },
      { to: '/inventario', label: 'Inventario',  Icono: Boxes,   modulo: 'inventario', accion: 'ajustar' },
      { to: '/compras',    label: 'Compras',     Icono: Truck,   modulo: 'compras',    accion: 'ver' },
      { to: '/clientes',   label: 'Clientes',    Icono: Users,   modulo: 'ventas',     accion: 'ver' },
    ],
  },
  {
    key: 'administracion',
    label: 'Administración',
    items: [
      { to: '/reportes',      label: 'Reportes',      Icono: BarChart2, modulo: 'reportes',      accion: 'ver' },
      { to: '/usuarios',      label: 'Usuarios',      Icono: UserCog,   modulo: 'usuarios',      accion: 'ver' },
      { to: '/roles',         label: 'Roles',         Icono: Shield,    modulo: 'roles',         accion: 'ver' },
      { to: '/sucursales',    label: 'Sucursales',    Icono: Building2, modulo: 'sucursales',    accion: 'ver' },
      { to: '/cajas',         label: 'Cajas',         Icono: Landmark,  modulo: 'cajas',         accion: 'ver' },
      { to: '/configuracion', label: 'Configuración', Icono: Settings,  modulo: 'configuracion', accion: 'ver' },
    ],
  },
];
```

Para cada grupo se filtran los ítems visibles por permiso (misma lógica que hoy: `item.siempre || tienePermiso(item.modulo, item.accion)`). Un grupo sin ítems visibles no renderiza nada (ni header ni contenedor).

**Modo expandido (label visible):** cada grupo con ítems muestra un header clickeable:
- Texto: `text-[10px] uppercase tracking-wide font-semibold text-muted-foreground`, el label del grupo.
- `ChevronDown` (16px, `text-muted-foreground`) a la derecha, con `transition-transform` y `-rotate-90` cuando el grupo está plegado.
- Al hacer click, alterna el estado plegado/expandido de ese grupo.
- Debajo, los ítems del grupo (mismo `NavLink` que hoy) — ocultos (`display: none`, vía condicional de render, no `hidden` de Tailwind, para no montar/desmontar y perder el foco del `NavLink` activo al navegar) cuando el grupo está plegado.

**Estado y persistencia:** `useState` inicializado desde `localStorage.getItem('sidebar-secciones-colapsadas')` (JSON, ej. `{"catalogo":true}` — solo se guardan las claves plegadas; ausente = expandido). Se persiste con un `useEffect` que escribe a `localStorage` en cada cambio. Si el JSON guardado es inválido o no existe, se parte de `{}` (todo expandido).

**Modo icon-only (`colapsado === true` en desktop, o sidebar abierto en tablet sin `colapsado`):** el acordeón se ignora completamente — no se renderizan headers de grupo ni chevrons, y todos los ítems de todos los grupos se muestran siempre, independientemente del estado guardado. Un separador `border-t border-border` sutil (sin texto) entre grupos ayuda a mantener algo de estructura visual. Esto aplica en los mismos breakpoints donde hoy `labelClass` oculta los labels de ítems individuales (`md:hidden` cuando colapsado, o `md:hidden lg:inline` cuando expandido — el criterio para "hay espacio para texto" es el mismo que ya usa el componente).

## 3. Tooltip en modo colapsado

Se agrega la dependencia `@radix-ui/react-tooltip` (`npm install @radix-ui/react-tooltip` en `frontend/`) y se crea `frontend/src/components/ui/tooltip.jsx`:

```jsx
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({ className = '', sideOffset = 6, ...props }) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={`z-50 overflow-hidden rounded-md bg-popover px-3 py-1.5 text-xs text-popover-foreground border border-border shadow-md animate-in fade-in-0 zoom-in-95 ${className}`}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}
```

(Sigue el mismo patrón delgado que `dialog.jsx` ya usa sobre `@radix-ui/react-dialog` — wrapper mínimo, tokens shadcn, sin lógica propia.)

En `Sidebar.jsx`, todo el `<aside>` se envuelve en `<TooltipProvider delayDuration={200}>`. Cada `NavLink` se envuelve en `Tooltip` + `TooltipTrigger asChild` cuando el sidebar está en modo icon-only (mismo criterio de breakpoint que el punto 2); en modo expandido, el `NavLink` se renderiza sin el wrapper de tooltip (el label ya es visible, sería redundante). El atributo `title={label}` se elimina del `NavLink` en todos los casos — reemplazado por el `TooltipContent` con el mismo texto.

## 4. Skeleton de carga en el header

`useQuery` ya devuelve `isLoading`. Mientras `isLoading` es `true`, el bloque de nombre/subtítulo (líneas 101-104 actuales) se reemplaza por dos barras placeholder:

```jsx
<div className="min-w-0 space-y-1.5">
  <div className="h-3.5 w-24 bg-muted rounded animate-pulse" />
  <div className="h-2.5 w-16 bg-muted rounded animate-pulse" />
</div>
```

Mismas clases responsive que el bloque real (`md:hidden`, `lg:hidden`/`lg:block` según `colapsado`) para que aparezca/desaparezca en los mismos breakpoints. El logo/ícono del negocio (bloque de la izquierda) no cambia — ya maneja bien la ausencia de datos mostrando el ícono genérico.

## Testing

No hay test runner de frontend en este proyecto (restricción ya documentada). Verificación: `npm run lint` + `npm run build` + inspección manual en navegador (pendiente para el usuario, no disponible para subagentes) — probar: toggle de cada sección, persistencia tras recargar, comportamiento en los 3 breakpoints (móvil, tablet, desktop expandido/colapsado), tooltip apareciendo solo en icon-only, skeleton visible brevemente al cargar.

## Fuera de alcance

- Cualquier otro componente de layout (`Topbar.jsx`, `Layout.jsx`).
- Cambios de rutas, permisos, o lógica de navegación.
- Un componente `Tooltip` más completo (posiciones múltiples, delays configurables por instancia, etc.) — se implementa solo lo necesario para este caso de uso.
