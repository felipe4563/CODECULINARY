import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { usePermisos } from '../../hooks/usePermisos';
import { getConfiguracion, logoSrc } from '../../api/configuracion';
import {
  LayoutDashboard, UtensilsCrossed, Wallet, BookOpen,
  Package, Boxes, Truck, Users, UserCog, Shield, Settings, X,
  BarChart2, ChefHat, ChevronDown, ChevronRight, Building2, Landmark, Store, Grid3x3,
  Gift, Tag, Star, Ticket, Cake, Disc3, Wheat, Printer, Plug,
} from 'lucide-react';

const NAV_GROUPS = [
  {
    key: 'operacion',
    label: 'Operación',
    items: [
      { to: '/',           label: 'Dashboard',    Icono: LayoutDashboard, siempre: true },
      { to: '/ventas',     label: 'Ventas / POS',  Icono: UtensilsCrossed, modulo: 'ventas',     accion: 'ver' },
      { to: '/pedidos-externos', label: 'Pedidos externos', Icono: Truck, modulo: 'ventas', accion: 'ver' },
      { to: '/cocina',     label: 'Cocina',        Icono: ChefHat,         modulo: 'cocina',     accion: 'ver' },
      { to: '/pantalla-cocina-impresion', label: 'Pantalla Cocina (BT)', Icono: Printer, modulo: 'cocina', accion: 'ver' },
      { to: '/caja',       label: 'Caja',          Icono: Wallet,          modulo: 'caja',       accion: 'ver' },
      { to: '/libro-caja', label: 'Libro Caja',    Icono: BookOpen,        modulo: 'libro_caja', accion: 'ver' },
    ],
  },
  {
    key: 'catalogo',
    label: 'Catálogo',
    items: [
      { to: '/productos',    label: 'Productos',    Icono: Package, modulo: 'inventario',   accion: 'ver' },
      { to: '/combos',       label: 'Combos',       Icono: Gift,    modulo: 'combos',       accion: 'ver' },
      { to: '/promociones',  label: 'Promociones',  Icono: Tag,     modulo: 'promociones',  accion: 'ver' },
      { to: '/cupones',      label: 'Cupones',      Icono: Ticket,  modulo: 'cupones',      accion: 'ver' },
      { to: '/ruleta',       label: 'Ruleta',       Icono: Disc3,   modulo: 'ruleta',       accion: 'girar' },
      { to: '/inventario',   label: 'Inventario',   Icono: Boxes,   modulo: 'inventario',   accion: 'ajustar' },
      { to: '/compras',      label: 'Compras',      Icono: Truck,   modulo: 'compras',      accion: 'ver' },
      { to: '/insumos',      label: 'Insumos',      Icono: Wheat,   modulo: 'insumos',      accion: 'ver' },
      { to: '/clientes',     label: 'Clientes',     Icono: Users,   modulo: 'ventas',       accion: 'ver' },
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
      {
        to: '/configuracion', label: 'Configuración', Icono: Settings, modulo: 'configuracion', accion: 'ver',
        subItems: [
          { to: '/configuracion/negocio', label: 'Negocio',      Icono: Store },
          { to: '/configuracion/areas',   label: 'Áreas',        Icono: Building2 },
          { to: '/configuracion/mesas',   label: 'Mesas',        Icono: Grid3x3 },
          { to: '/configuracion/flujo',   label: 'Flujo Cocina', Icono: ChefHat },
          { to: '/configuracion/fidelidad', label: 'Fidelidad', Icono: Star },
          { to: '/configuracion/cumpleanos', label: 'Cumpleaños', Icono: Cake },
          { to: '/configuracion/ruleta', label: 'Ruleta', Icono: Disc3 },
          { to: '/configuracion/integraciones', label: 'Integraciones', Icono: Plug },
        ],
      },
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

// El sidebar solo se cierra automáticamente al navegar en móvil (<768px);
// en tablet/escritorio permanece abierto tras elegir un ítem.
function useEsMovil() {
  const [ancho, setAncho] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setAncho(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return ancho < 768;
}

export default function Sidebar({ visible, onCerrar }) {
  const { tienePermiso } = usePermisos();
  const location = useLocation();
  const { data: config = {}, isLoading: cargandoConfig } = useQuery({
    queryKey: ['configuracion'],
    queryFn: getConfiguracion,
    staleTime: 60_000,
  });
  const nombreNegocio = config.nombre_negocio || 'Restaurante';
  const logo = logoSrc(config.logo);
  const esMovil = useEsMovil();

  const [seccionesColapsadas, setSeccionesColapsadas] = useState(leerSeccionesColapsadas);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seccionesColapsadas));
  }, [seccionesColapsadas]);

  const toggleSeccion = (key) => {
    setSeccionesColapsadas((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Ítems con subItems (ej. Configuración) se abren solos si la ruta actual
  // cae dentro de alguno de sus subítems; el usuario puede plegarlos/desplegarlos después.
  const [itemsAbiertos, setItemsAbiertos] = useState(() => {
    const abiertos = {};
    NAV_GROUPS.forEach((grupo) => grupo.items.forEach((item) => {
      if (item.subItems?.some((sub) => location.pathname.startsWith(sub.to))) {
        abiertos[item.to] = true;
      }
    }));
    return abiertos;
  });

  const toggleItem = (to) => {
    setItemsAbiertos((prev) => ({ ...prev, [to]: !prev[to] }));
  };

  const gruposVisibles = NAV_GROUPS
    .map((grupo) => ({
      ...grupo,
      items: grupo.items.filter((item) => item.siempre || tienePermiso(item.modulo, item.accion)),
    }))
    .filter((grupo) => grupo.items.length > 0);

  const cerrarSiMovil = () => {
    if (esMovil) onCerrar();
  };

  return (
    <>
      {/* Backdrop — solo en móvil. En tablet/escritorio el sidebar convive
          con la página (no la bloquea), así que no hay overlay que cerrar
          a ciegas antes de poder seguir trabajando. */}
      {visible && esMovil && (
        <div
          className="fixed inset-0 bg-black/50 z-20"
          onClick={onCerrar}
        />
      )}

      <aside
        className={`
          fixed top-0 left-0 h-full z-30 flex flex-col
          bg-card
          border-r border-border
          transition-transform duration-300 ease-in-out
          w-64 shrink-0
          ${visible ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* Header */}
        <div className="flex items-center justify-between py-4 px-4 min-h-[60px] border-b border-border">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg shrink-0 overflow-hidden bg-primary flex items-center justify-center">
              {logo
                ? <img src={logo} alt="Logo" className="w-full h-full object-cover" />
                : <UtensilsCrossed className="w-4 h-4 text-primary-foreground" />
              }
            </div>
            {cargandoConfig ? (
              <div className="min-w-0 space-y-1.5">
                <div className="h-3.5 w-24 bg-muted rounded animate-pulse" />
                <div className="h-2.5 w-16 bg-muted rounded animate-pulse" />
              </div>
            ) : (
              <div className="min-w-0">
                <p className="text-sm font-bold text-foreground leading-tight truncate">{nombreNegocio}</p>
                <p className="text-[11px] text-muted-foreground leading-tight">Sistema de Gestión</p>
              </div>
            )}
          </div>

          <button
            onClick={onCerrar}
            className="p-1 rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5 scrollbar-hide">
          {gruposVisibles.map((grupo) => {
            const plegado = !!seccionesColapsadas[grupo.key];
            return (
              <div key={grupo.key}>
                <button
                  type="button"
                  onClick={() => toggleSeccion(grupo.key)}
                  className="w-full flex items-center justify-between px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors"
                >
                  <span>{grupo.label}</span>
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${plegado ? '-rotate-90' : ''}`} />
                </button>

                <div className={`space-y-0.5 ${plegado ? 'hidden' : ''}`}>
                  {grupo.items.map((item) => {
                    const { to, label, Icono, subItems } = item;

                    if (subItems) {
                      const subActivo = subItems.some((sub) => location.pathname.startsWith(sub.to));
                      const abierto = !!itemsAbiertos[to];
                      return (
                        <div key={to}>
                          <button
                            type="button"
                            onClick={() => toggleItem(to)}
                            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                              subActivo
                                ? 'text-foreground'
                                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                            }`}
                          >
                            <Icono className="w-[18px] h-[18px] shrink-0" />
                            <span className="truncate flex-1 text-left">{label}</span>
                            <ChevronRight className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${abierto ? 'rotate-90' : ''}`} />
                          </button>

                          <div className={`mt-0.5 space-y-0.5 ${abierto ? '' : 'hidden'}`}>
                            {subItems.map((sub) => (
                              <NavLink
                                key={sub.to}
                                to={sub.to}
                                onClick={cerrarSiMovil}
                                className={({ isActive }) => `
                                  relative flex items-center gap-3 pl-9 pr-3 py-2 rounded-lg text-sm font-medium transition-colors
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
                                    <sub.Icono className="w-4 h-4 shrink-0" />
                                    <span className="truncate">{sub.label}</span>
                                  </>
                                )}
                              </NavLink>
                            ))}
                          </div>
                        </div>
                      );
                    }

                    return (
                      <NavLink
                        key={to}
                        to={to}
                        end={to === '/'}
                        onClick={cerrarSiMovil}
                        className={({ isActive }) => `
                          relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
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
                            <span className="truncate">{label}</span>
                          </>
                        )}
                      </NavLink>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* CodeWave credit */}
        <div className="shrink-0 flex items-center justify-center gap-1.5 py-2.5 border-t border-border">
          <span className="text-[9px] text-muted-foreground font-medium whitespace-nowrap">by</span>
          <img src="/logo-light.png" alt="CodeWave" className="h-4 object-contain dark:hidden opacity-50" />
          <img src="/logo-dark.png"  alt="CodeWave" className="h-4 object-contain hidden dark:block opacity-50" />
        </div>
      </aside>
    </>
  );
}
