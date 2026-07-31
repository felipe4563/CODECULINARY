# Mejoras de diseño del Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mejorar `frontend/src/components/layout/Sidebar.jsx` con indicador de ítem activo, secciones plegables con persistencia, tooltips en modo icon-only, y skeleton de carga en el header — sin cambiar rutas, permisos, ni comportamiento de navegación.

**Architecture:** Un nuevo componente `ui/Tooltip.jsx` (wrapper delgado sobre `@radix-ui/react-tooltip`, mismo patrón que `ui/Dialog.jsx`) se agrega primero. Luego `Sidebar.jsx` se reescribe completo: `NAV_ITEMS` (lista plana) pasa a `NAV_GROUPS` (3 grupos), se agrega estado de secciones plegadas persistido en `localStorage`, un hook local `useIconOnly` determina vía `window.innerWidth` si el sidebar se renderiza en modo solo-iconos (para decidir si envolver cada ítem en `Tooltip`), y el header usa `isLoading` de React Query para mostrar un skeleton.

**Tech Stack:** React 18, Tailwind 3.4 (tokens shadcn ya definidos en `index.css`/`tailwind.config.js`), `@tanstack/react-query`, `@radix-ui/react-tooltip` (nueva dependencia), `lucide-react`.

## Global Constraints

- No hay test runner de frontend en este proyecto — la verificación es `npm run lint` + `npm run build` + inspección manual (documentado en specs previos).
- Los tokens de color usados deben ser los ya definidos: `bg-card`, `text-foreground`, `text-muted-foreground`, `bg-primary`, `text-primary-foreground`, `bg-muted`, `border-border`, `bg-popover`, `text-popover-foreground`.
- Breakpoints Tailwind por defecto (no sobreescritos en `tailwind.config.js`): `md` = 768px, `lg` = 1024px.
- Alcance: solo `frontend/src/components/layout/Sidebar.jsx`, `frontend/src/components/ui/Tooltip.jsx` (nuevo), `frontend/package.json` y `frontend/package-lock.json`. Ningún otro archivo.
- Sin cambios de rutas, permisos, ni lógica de navegación — el filtrado por `tienePermiso(modulo, accion)` se mantiene idéntico, solo cambia cómo se agrupan/renderizan los ítems.

---

### Task 1: Componente Tooltip

**Files:**
- Create: `frontend/src/components/ui/Tooltip.jsx`
- Modify: `frontend/package.json` (nueva dependencia)

**Interfaces:**
- Produces: `Tooltip`, `TooltipProvider`, `TooltipTrigger`, `TooltipContent` — exportados desde `frontend/src/components/ui/Tooltip.jsx`, mismo patrón de uso que Radix (`<TooltipProvider><Tooltip><TooltipTrigger asChild>{child}</TooltipTrigger><TooltipContent>texto</TooltipContent></Tooltip></TooltipProvider>`).

- [ ] **Step 1: Instalar la dependencia**

Ejecutar dentro de `frontend/`:

```bash
npm install @radix-ui/react-tooltip
```

Verificar que `frontend/package.json` ahora incluye `"@radix-ui/react-tooltip"` en `dependencies` y que `frontend/package-lock.json` se actualizó.

- [ ] **Step 2: Crear el componente Tooltip**

Crear `frontend/src/components/ui/Tooltip.jsx` con exactamente este contenido (sigue el mismo patrón que `frontend/src/components/ui/Dialog.jsx`: wrapper delgado con `React.forwardRef`, `cn` para clases, `displayName` heredado del primitivo):

```jsx
import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '../../lib/utils';

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 overflow-hidden rounded-md border border-border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95',
        className
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent };
```

- [ ] **Step 3: Verificar que el proyecto compila**

Ejecutar dentro de `frontend/`:

```bash
npm run lint
npm run build
```

Ambos deben terminar sin errores. `Tooltip.jsx` no se usa todavía en ningún lado en este punto — es esperado que el build pase igual (el archivo no se importa aún).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ui/Tooltip.jsx frontend/package.json frontend/package-lock.json
git commit -m "feat(ui): agregar componente Tooltip sobre @radix-ui/react-tooltip"
```

---

### Task 2: Reescritura de Sidebar.jsx

**Files:**
- Modify: `frontend/src/components/layout/Sidebar.jsx` (reemplazo completo del archivo)

**Interfaces:**
- Consumes: `Tooltip`, `TooltipProvider`, `TooltipTrigger`, `TooltipContent` desde `../ui/Tooltip` (Task 1). `usePermisos()` (sin cambios), `getConfiguracion`/`logoSrc` desde `../../api/configuracion` (sin cambios).
- No produce nuevas interfaces públicas — `Sidebar` sigue recibiendo las mismas props (`visible`, `onCerrar`, `colapsado`, `onToggleColapsado`) y sin cambios en cómo `Layout.jsx` lo usa.

- [ ] **Step 1: Reemplazar el contenido completo de Sidebar.jsx**

Reemplazar TODO el contenido de `frontend/src/components/layout/Sidebar.jsx` con exactamente este código:

```jsx
import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { usePermisos } from '../../hooks/usePermisos';
import { getConfiguracion, logoSrc } from '../../api/configuracion';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '../ui/Tooltip';
import {
  LayoutDashboard, UtensilsCrossed, Wallet, BookOpen,
  Package, Boxes, Truck, Users, UserCog, Shield, Settings, X,
  BarChart2, ChefHat, ChevronLeft, ChevronDown, Building2, Landmark,
} from 'lucide-react';

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

const STORAGE_KEY = 'sidebar-secciones-colapsadas';

function leerSeccionesColapsadas() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

// Determina si el sidebar se ve en modo "solo iconos": siempre en tablet
// (768-1023px), y en desktop (>=1024px) según el prop `colapsado`. En
// móvil (<768px) nunca es icon-only (es un overlay expandido).
function useIconOnly(colapsado) {
  const [ancho, setAncho] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setAncho(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  if (ancho < 768) return false;
  if (ancho < 1024) return true;
  return colapsado;
}

export default function Sidebar({ visible, onCerrar, colapsado, onToggleColapsado }) {
  const { tienePermiso } = usePermisos();
  const { data: config = {}, isLoading: cargandoConfig } = useQuery({
    queryKey: ['configuracion'],
    queryFn: getConfiguracion,
    staleTime: 60_000,
  });
  const nombreNegocio = config.nombre_negocio || 'Restaurante';
  const logo = logoSrc(config.logo);
  const iconOnly = useIconOnly(colapsado);

  const [seccionesColapsadas, setSeccionesColapsadas] = useState(leerSeccionesColapsadas);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seccionesColapsadas));
  }, [seccionesColapsadas]);

  const toggleSeccion = (key) => {
    setSeccionesColapsadas((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const gruposVisibles = NAV_GROUPS
    .map((grupo) => ({
      ...grupo,
      items: grupo.items.filter((item) => item.siempre || tienePermiso(item.modulo, item.accion)),
    }))
    .filter((grupo) => grupo.items.length > 0);

  // En tablet/desktop: ancho dinámico según estado
  // visible=false → w-0 (oculto completamente)
  // visible=true, tablet → w-14 (solo iconos)
  // visible=true, desktop, colapsado → w-14
  // visible=true, desktop, expandido → w-60
  const anchoDesktop = !visible
    ? 'md:w-0 md:overflow-hidden md:border-r-0'
    : colapsado
      ? 'md:w-14 lg:w-14'
      : 'md:w-14 lg:w-60';

  // Labels: visibles en móvil (overlay) y en desktop expandido
  const labelClass = colapsado
    ? 'md:hidden'                // móvil: sí, tablet: no, desktop colapsado: no
    : 'md:hidden lg:inline';    // móvil: sí, tablet: no, desktop expandido: sí

  // Alineación del nav item
  const itemAlign = colapsado
    ? 'justify-start px-3 md:justify-center md:px-0'
    : 'justify-start px-3 md:justify-center md:px-0 lg:justify-start lg:px-3';

  // Header de sección: visible en móvil y desktop expandido, oculto en
  // tablet y desktop colapsado (mismo criterio que labelClass, pero flex).
  const headerVisibleClass = 'flex ' + (colapsado ? 'md:hidden' : 'md:hidden lg:flex');

  // Separador entre grupos: inverso al header — solo visible cuando el
  // header de sección está oculto (tablet siempre, desktop colapsado).
  const dividerClass = 'hidden ' + (colapsado ? 'md:block' : 'md:block lg:hidden');

  // Contenedor de ítems de un grupo: si el grupo NO está plegado, siempre
  // visible. Si está plegado, se oculta en móvil y desktop expandido
  // (donde el acordeón aplica), pero se ignora (siempre visible) en
  // tablet y desktop colapsado, donde no hay UI para plegar/desplegar.
  const itemsWrapperClass = (plegado) => {
    if (!plegado) return '';
    return colapsado ? 'hidden md:block' : 'hidden md:block lg:hidden';
  };

  const renderNavLink = (item) => {
    const { to, label, Icono } = item;
    const link = (
      <NavLink
        to={to}
        end={to === '/'}
        onClick={onCerrar}
        className={({ isActive }) => `
          relative flex items-center gap-3 py-2.5 rounded-lg text-sm font-medium transition-colors
          ${itemAlign}
          ${isActive
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
          }
        `}
      >
        {({ isActive }) => (
          <>
            {isActive && (
              <span
                aria-hidden
                className="absolute left-0 top-0 bottom-0 w-[3px] bg-primary-foreground rounded-r"
              />
            )}
            <Icono className="w-[18px] h-[18px] shrink-0" />
            <span className={`truncate ${labelClass}`}>
              {label}
            </span>
          </>
        )}
      </NavLink>
    );

    if (!iconOnly) return link;

    return (
      <Tooltip>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    );
  };

  return (
    <>
      {/* Backdrop — solo móvil cuando está visible */}
      {visible && (
        <div
          className="fixed inset-0 bg-black/50 z-20 md:hidden"
          onClick={onCerrar}
        />
      )}

      <aside
        className={`
          fixed top-0 left-0 h-full z-30 flex flex-col
          bg-card
          border-r border-border
          transition-all duration-300 ease-in-out
          w-64 shrink-0
          ${visible ? 'translate-x-0' : '-translate-x-full'}
          md:static md:translate-x-0 md:z-auto
          ${anchoDesktop}
        `}
      >
        {/* Header */}
        <div className={`
          flex items-center py-4 min-h-[60px]
          border-b border-border
          justify-between px-4
          md:justify-center md:px-0
          ${colapsado ? 'lg:justify-center lg:px-0' : 'lg:justify-between lg:px-5'}
        `}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg shrink-0 overflow-hidden bg-primary flex items-center justify-center">
              {logo
                ? <img src={logo} alt="Logo" className="w-full h-full object-cover" />
                : <UtensilsCrossed className="w-4 h-4 text-primary-foreground" />
              }
            </div>
            {cargandoConfig ? (
              <div className={`min-w-0 space-y-1.5 md:hidden ${colapsado ? 'lg:hidden' : 'lg:block'}`}>
                <div className="h-3.5 w-24 bg-muted rounded animate-pulse" />
                <div className="h-2.5 w-16 bg-muted rounded animate-pulse" />
              </div>
            ) : (
              <div className={`min-w-0 md:hidden ${colapsado ? 'lg:hidden' : 'lg:block'}`}>
                <p className="text-sm font-bold text-foreground leading-tight truncate">{nombreNegocio}</p>
                <p className="text-[11px] text-muted-foreground leading-tight">Sistema de Gestión</p>
              </div>
            )}
          </div>

          {/* X — solo en móvil */}
          <button
            onClick={onCerrar}
            className="md:hidden p-1 rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Nav */}
        <TooltipProvider delayDuration={200}>
          <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
            {gruposVisibles.map((grupo, idx) => {
              const plegado = !!seccionesColapsadas[grupo.key];
              return (
                <div key={grupo.key}>
                  {idx > 0 && <div className={`my-2 mx-1 border-t border-border ${dividerClass}`} />}

                  <button
                    type="button"
                    onClick={() => toggleSeccion(grupo.key)}
                    className={`w-full items-center justify-between px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors ${headerVisibleClass}`}
                  >
                    <span>{grupo.label}</span>
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${plegado ? '-rotate-90' : ''}`} />
                  </button>

                  <div className={`space-y-0.5 ${itemsWrapperClass(plegado)}`}>
                    {grupo.items.map((item) => (
                      <div key={item.to}>
                        {renderNavLink(item)}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </nav>
        </TooltipProvider>

        {/* CodeWave credit — solo cuando hay espacio para texto */}
        <div className={`shrink-0 flex items-center justify-center gap-1.5 py-2.5 border-t border-border ${colapsado ? 'md:hidden' : 'md:hidden lg:flex'}`}>
          <span className="text-[9px] text-muted-foreground font-medium whitespace-nowrap">by</span>
          <img src="/logo-light.png" alt="CodeWave" className="h-4 object-contain dark:hidden opacity-50" />
          <img src="/logo-dark.png"  alt="CodeWave" className="h-4 object-contain hidden dark:block opacity-50" />
        </div>

        {/* Toggle colapsar — solo desktop */}
        <button
          onClick={onToggleColapsado}
          title={colapsado ? 'Expandir menú' : 'Colapsar menú'}
          className="hidden lg:flex items-center justify-center h-11 border-t border-border text-muted-foreground hover:text-accent-foreground hover:bg-accent transition-colors shrink-0"
        >
          <ChevronLeft className={`w-4 h-4 transition-transform duration-300 ${colapsado ? 'rotate-180' : ''}`} />
        </button>
      </aside>
    </>
  );
}
```

- [ ] **Step 2: Verificar que el proyecto compila**

Ejecutar dentro de `frontend/`:

```bash
npm run lint
npm run build
```

Ambos deben terminar sin errores.

- [ ] **Step 3: Verificación manual (documentar, no ejecutable por el agente)**

Dejar documentado en el reporte del task que falta verificación manual en navegador (no disponible para subagentes):
- El ítem activo muestra la barra lateral izquierda en los 3 breakpoints.
- Cada sección se puede plegar/desplegar con click en el header, y el estado persiste tras recargar la página (localStorage).
- En tablet (768-1023px) y en desktop colapsado, todos los ítems de todas las secciones son visibles sin importar el estado guardado — sin headers de sección, con separadores sutiles entre grupos.
- El tooltip aparece al pasar el mouse sobre un ítem SOLO en modo icon-only (tablet o desktop colapsado), no en modo expandido.
- El skeleton de carga aparece brevemente en el header al cargar la página (visible con conexión lenta o limitando la red en devtools).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/layout/Sidebar.jsx
git commit -m "feat(sidebar): indicador de activo, secciones plegables, tooltips y skeleton de carga"
```
