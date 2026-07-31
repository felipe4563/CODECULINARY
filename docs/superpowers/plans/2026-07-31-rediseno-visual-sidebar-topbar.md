# Rediseño Visual — Fase 2: Sidebar/Topbar/Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retonar `Sidebar.jsx`, `Topbar.jsx` y `Layout.jsx` — el marco visual compartido por las 29 páginas del sistema — para que usen las variables CSS del tema (`bg-primary`, `bg-accent`, `bg-card`, `border-border`, `text-muted-foreground`, etc.) en vez de colores Tailwind fijos (`bg-blue-600`, `text-amber-600`, `bg-gray-*`). Esto hace que el color de marca configurado en `Configuración → Negocio` (fase 1, ya mergeada) se refleje de inmediato en la navegación de todo el sistema.

**Architecture:** Sustitución de clases de color uno a uno, sin tocar estructura, layout, responsive ni comportamiento (colapsar/expandir sidebar, overlay móvil, toggle de tema). Los botones de ícono pequeños (hamburguesa, cerrar, cambiar tema, logout, colapsar) se quedan como `<button>` planos con clases retonadas — no se fuerza el componente `<Button>` de shadcn (tamaño fijo `h-10 w-10`) en controles compactos que no se pueden verificar visualmente en este entorno sin navegador.

**Tech Stack:** React 18 + Vite 5 + Tailwind 3.4 (JavaScript, sin TypeScript). Depende de la Fase 1 ya mergeada (variables CSS de `frontend/src/index.css`, mapeo de Tailwind en `frontend/tailwind.config.js`).

## Global Constraints

- Ningún cambio de estructura, layout, responsive ni comportamiento — solo clases de color.
- No usar el componente `<Button>` de shadcn en los botones de ícono de estos 3 archivos (riesgo de tamaño/espaciado no verificable sin navegador en este entorno).
- Mapeo de tokens a usar exactamente:
  - `bg-white dark:bg-gray-900` / `bg-white dark:bg-gray-800` (paneles/barras) → `bg-card`
  - `border-gray-200 dark:border-gray-700/60` / `border-gray-200 dark:border-gray-700` (bordes de paneles) → `border-border`
  - `bg-blue-600` (marca/activo) → `bg-primary`
  - texto sobre `bg-primary` (`text-white`) → `text-primary-foreground`
  - `text-gray-900 dark:text-white` / `text-gray-800 dark:text-gray-100` (texto principal) → `text-foreground`
  - `text-gray-500 dark:text-gray-400` / `text-gray-400 dark:text-gray-500` / `text-gray-400 dark:text-gray-600` (texto secundario) → `text-muted-foreground`
  - `text-gray-600 dark:text-gray-400` (texto de nav inactivo) → `text-muted-foreground`
  - hover de fondo neutro (`hover:bg-gray-100 dark:hover:bg-gray-700`, `hover:bg-gray-100 dark:hover:bg-gray-800`, `hover:bg-gray-50 dark:hover:bg-gray-800`) → `hover:bg-accent`
  - hover de texto neutro sobre esos fondos (`hover:text-gray-900 dark:hover:text-white`, `hover:text-gray-700 dark:hover:text-white`) → `hover:text-accent-foreground` (o `hover:text-foreground` cuando el fondo no cambia — ver Task 2/3 para el caso exacto)
  - `group-hover:text-amber-600 dark:group-hover:text-amber-400` (nombre de usuario en Topbar) → `group-hover:text-primary`
  - `bg-gray-200 dark:bg-gray-600` (separador vertical) → `bg-border`
  - `bg-gray-100 dark:bg-gray-950` (fondo de página en Layout) → `bg-background`
  - hover destructivo de logout (`hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-600 dark:hover:text-red-400`) → `hover:bg-destructive/10 hover:text-destructive`
- No hay test runner de frontend en este proyecto — verificación por `npm run build` + `npx eslint` (0 errores) en cada tarea, tal como en la Fase 1.

---

### Task 1: `Layout.jsx` — fondo de página al token del tema

**Files:**
- Modify: `frontend/src/components/layout/Layout.jsx`

**Interfaces:** Ninguna — solo una clase de color, sin cambios de props ni comportamiento.

- [ ] **Step 1: Reemplazar el contenido de `frontend/src/components/layout/Layout.jsx`**

```jsx
import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';

export default function Layout() {
  const [sidebarVisible, setSidebarVisible]     = useState(true);
  const [sidebarColapsado, setSidebarColapsado] = useState(
    () => localStorage.getItem('sidebar-colapsado') === 'true'
  );

  function toggleColapsado() {
    setSidebarColapsado(v => {
      localStorage.setItem('sidebar-colapsado', String(!v));
      return !v;
    });
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden transition-colors">
      <Sidebar
        visible={sidebarVisible}
        onCerrar={() => setSidebarVisible(false)}
        colapsado={sidebarColapsado}
        onToggleColapsado={toggleColapsado}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar onToggleSidebar={() => setSidebarVisible(v => !v)} />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
        
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verificar**

Run: `cd frontend && npm run build` (debe pasar sin errores) y `npx eslint src/components/layout/Layout.jsx` (0 errores).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/layout/Layout.jsx
git commit -m "feat: retonar fondo de Layout al tema (bg-background)"
```

---

### Task 2: `Topbar.jsx` — retonar al tema

**Files:**
- Modify: `frontend/src/components/layout/Topbar.jsx`

**Interfaces:** Ninguna — mismos props (`onToggleSidebar`), mismo comportamiento (toggle de tema, logout, link a perfil).

- [ ] **Step 1: Reemplazar el contenido de `frontend/src/components/layout/Topbar.jsx`**

```jsx
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../hooks/useTheme';
import { useNavigate, Link } from 'react-router-dom';
import { Menu, LogOut, Sun, Moon } from 'lucide-react';
import api from '../../api/cliente';

export default function Topbar({ onToggleSidebar }) {
  const { usuario, logout } = useAuth();
  const { modo, toggleModo } = useTheme();
  const navigate = useNavigate();

  async function handleLogout() {
    try {
      await api.post('/auth/logout');
    } catch {
      // ignorar errores de red al cerrar sesión
    }
    logout();
    navigate('/login');
  }

  return (
    <header className="h-14 bg-card border-b border-border flex items-center justify-between px-4 shrink-0 transition-colors">
      {/* Botón hamburguesa — todos los tamaños */}
      <button
        onClick={onToggleSidebar}
        title="Menú"
        className="p-2 rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Controles derecha */}
      <div className="flex items-center gap-2">
        <button
          onClick={toggleModo}
          title={modo === 'dark' ? 'Modo claro' : 'Modo oscuro'}
          className="p-2 rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          {modo === 'dark'
            ? <Sun className="w-4 h-4" />
            : <Moon className="w-4 h-4" />
          }
        </button>

        <div className="w-px h-5 bg-border" />

        <Link
          to="/perfil"
          className="text-right px-1 group cursor-pointer"
          title="Ver mi perfil"
        >
          <p className="text-sm font-semibold text-foreground group-hover:text-primary leading-tight transition-colors">{usuario?.nombre}</p>
          <p className="text-xs text-muted-foreground leading-tight">
            {usuario?.rol}
            {usuario?.rol && usuario?.sucursal_activa && ' · '}
            {usuario?.sucursal_activa?.nombre}
          </p>
        </Link>

        <button
          onClick={handleLogout}
          title="Cerrar sesión"
          className="p-2 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Verificar**

Run: `cd frontend && npm run build` (debe pasar sin errores) y `npx eslint src/components/layout/Topbar.jsx` (0 errores).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/layout/Topbar.jsx
git commit -m "feat: retonar Topbar al tema (bg-card, bg-primary, bg-accent, etc.)"
```

---

### Task 3: `Sidebar.jsx` — retonar al tema

**Files:**
- Modify: `frontend/src/components/layout/Sidebar.jsx`

**Interfaces:** Ninguna — mismos props (`visible`, `onCerrar`, `colapsado`, `onToggleColapsado`), mismo comportamiento responsive/colapsable.

- [ ] **Step 1: Reemplazar el contenido de `frontend/src/components/layout/Sidebar.jsx`**

```jsx
import { NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { usePermisos } from '../../hooks/usePermisos';
import { getConfiguracion, logoSrc } from '../../api/configuracion';
import {
  LayoutDashboard, UtensilsCrossed, Wallet, BookOpen,
  Package, Boxes, Truck, Users, UserCog, Shield, Settings, X,
  BarChart2, ChefHat, ChevronLeft, Building2, Landmark,
} from 'lucide-react';

const NAV_ITEMS = [
  { to: '/',             label: 'Dashboard',     Icono: LayoutDashboard, siempre: true },
  { to: '/ventas',       label: 'Ventas / POS',  Icono: UtensilsCrossed, modulo: 'ventas',        accion: 'ver' },
  { to: '/cocina',       label: 'Cocina',        Icono: ChefHat,         modulo: 'cocina',        accion: 'ver' },
  { to: '/caja',         label: 'Caja',          Icono: Wallet,          modulo: 'caja',          accion: 'ver' },
  { to: '/libro-caja',   label: 'Libro Caja',    Icono: BookOpen,        modulo: 'libro_caja',    accion: 'ver' },
  { to: '/productos',    label: 'Productos',     Icono: Package,         modulo: 'inventario',    accion: 'ver' },
  { to: '/inventario',   label: 'Inventario',    Icono: Boxes,           modulo: 'inventario',    accion: 'ajustar' },
  { to: '/compras',      label: 'Compras',       Icono: Truck,           modulo: 'compras',       accion: 'ver' },
  { to: '/clientes',     label: 'Clientes',      Icono: Users,           modulo: 'ventas',        accion: 'ver' },
  { to: '/reportes',     label: 'Reportes',      Icono: BarChart2,       modulo: 'reportes',      accion: 'ver' },
  { to: '/usuarios',     label: 'Usuarios',      Icono: UserCog,         modulo: 'usuarios',      accion: 'ver' },
  { to: '/roles',        label: 'Roles',         Icono: Shield,          modulo: 'roles',         accion: 'ver' },
  { to: '/sucursales',   label: 'Sucursales',    Icono: Building2,       modulo: 'sucursales',    accion: 'ver' },
  { to: '/cajas',        label: 'Cajas',         Icono: Landmark,        modulo: 'cajas',         accion: 'ver' },
  { to: '/configuracion',label: 'Configuración', Icono: Settings,        modulo: 'configuracion', accion: 'ver' },
];

export default function Sidebar({ visible, onCerrar, colapsado, onToggleColapsado }) {
  const { tienePermiso } = usePermisos();
  const { data: config = {} } = useQuery({
    queryKey: ['configuracion'],
    queryFn: getConfiguracion,
    staleTime: 60_000,
  });
  const nombreNegocio = config.nombre_negocio || 'Restaurante';
  const logo = logoSrc(config.logo);

  const itemsVisibles = NAV_ITEMS.filter(
    (item) => item.siempre || tienePermiso(item.modulo, item.accion)
  );

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
            <div className={`min-w-0 md:hidden ${colapsado ? 'lg:hidden' : 'lg:block'}`}>
              <p className="text-sm font-bold text-foreground leading-tight truncate">{nombreNegocio}</p>
              <p className="text-[11px] text-muted-foreground leading-tight">Sistema de Gestión</p>
            </div>
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
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {itemsVisibles.map(({ to, label, Icono }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={onCerrar}
              title={label}
              className={({ isActive }) => `
                flex items-center gap-3 py-2.5 rounded-lg text-sm font-medium transition-colors
                ${itemAlign}
                ${isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                }
              `}
            >
              <Icono className="w-[18px] h-[18px] shrink-0" />
              <span className={`truncate ${labelClass}`}>
                {label}
              </span>
            </NavLink>
          ))}
        </nav>

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
          className="hidden lg:flex items-center justify-center h-11 border-t border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
        >
          <ChevronLeft className={`w-4 h-4 transition-transform duration-300 ${colapsado ? 'rotate-180' : ''}`} />
        </button>
      </aside>
    </>
  );
}
```

- [ ] **Step 2: Verificar**

Run: `cd frontend && npm run build` (debe pasar sin errores) y `npx eslint src/components/layout/Sidebar.jsx` (0 errores).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/layout/Sidebar.jsx
git commit -m "feat: retonar Sidebar al tema (bg-card, bg-primary, bg-accent, etc.)"
```

---

## Qué queda para después

Con Sidebar/Topbar/Layout retonados, el siguiente plan migra Ventas/POS + Cocina (las páginas de mayor uso diario), y ahí recién se diseñan los componentes `Table`/`Badge` compartidos, informados por el uso real en esas páginas — no antes, para no adivinar su forma.
