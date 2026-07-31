# Rediseño Visual: VentasPage + Modales de Venta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retonear `VentasPage.jsx` y sus 7 componentes en `frontend/src/pages/ventas/components/` a los tokens del sistema de diseño shadcn (`bg-card`, `text-foreground`, `bg-primary`, etc.), igual que ya se hizo con el Dashboard y el chrome (Layout/Topbar/Sidebar). Es un cambio puro de clases de color — sin tocar layout, lógica, ni comportamiento.

**Architecture:** Tres tareas independientes por agrupación de archivos: (1) `VentasPage.jsx` (el archivo más grande, incluye el componente `ModalCobrar` anidado), (2) el clúster de selección de mesa (`ModalMesas.jsx`, `TarjetaMesa.jsx`, `CategoriasBar.jsx`), (3) el clúster de modales simples (`ModalLlevar.jsx`, `ModalPeso.jsx`, `ModalPagoQr.jsx`, `SelectorOpcionModal.jsx`). Cada tarea reescribe sus archivos completos — el volumen de líneas que cambian de clase hace que un diff parcial no aporte valor de revisión.

## Global Constraints

- No existe test runner de frontend en este proyecto — verificación es `npm run lint` + `npm run build` + inspección manual (pendiente, fuera de alcance de subagentes).
- **Se mantienen sin cambio** (colores semánticos/categóricos, no de marca):
  - Estados de mesa en `TarjetaMesa.jsx` y la leyenda de `ModalMesas.jsx`: disponible=verde, ocupada=rojo, reservada=ámbar (incluyendo los chips de "Mesas ocupadas" en `VentasPage.jsx`, que reutilizan el mismo rojo).
  - Colores de estado en `ModalPagoQr.jsx` (rojo para fallido/expirado).
  - El toggle "Para llevar" en `VentasPage.jsx` y el botón "Crear pedido" en `ModalLlevar.jsx` **si** están inactivos mantienen su naranja fijo (`orange-500`/`orange-50`/`orange-600`) — es un indicador de "modo distinto a mesa", no de marca. Ver la única excepción en Task 1 Step 1 abajo.
  - La nota de un ítem del carrito (`text-amber-600 dark:text-amber-400` en `VentasPage.jsx`) — es un resaltado visual de nota, no relacionado a botones/acciones.
  - El verde de éxito (`text-green-500` en la confirmación de venta cobrada) — es semántico, no de marca.
- **Cambian a tokens de marca** (`bg-primary`/`text-primary-foreground`/`ring-ring`/`hover:border-primary`): toda acción principal, estado activo/seleccionado, o foco de formulario que hoy use `blue-*`. Esto incluye el botón "Crear pedido" en `ModalLlevar.jsx` (es una acción real, no un indicador de estado — distinto del toggle "Para llevar" en sí).
- **Botones neutros con hover** (cerrar, cancelar, +/-, iconos): usan el patrón ya establecido en `frontend/src/components/ui/Modal.jsx` (`text-muted-foreground hover:text-foreground hover:bg-accent`) o, para botones con fondo visible, `hover:bg-accent hover:text-accent-foreground` — mismo patrón que ya usan `Topbar.jsx`/`Sidebar.jsx`.
- **Acciones destructivas** (quitar del carrito, "Vaciar", errores): `text-destructive` en vez de `text-red-500`/`text-red-600` fijos — el token ya existe desde la Fase 1.
- Ninguna tarea modifica lógica, props, ni estructura JSX más allá de las clases `className`.

---

### Task 1: `VentasPage.jsx`

**Files:**
- Modify: `frontend/src/pages/ventas/VentasPage.jsx` (reescritura completa)

**Interfaces:** No consume ni produce interfaces nuevas — mismos props/estado/handlers que ya existen, solo cambian las clases de color.

- [ ] **Step 1: Reemplazar el contenido completo de `frontend/src/pages/ventas/VentasPage.jsx`**

```jsx
import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  RefreshCw, AlertCircle, Package, ShoppingCart, ShoppingBag,
  Plus, Minus, Trash2, CreditCard, Wallet, ChevronRight, LayoutGrid, CheckCircle2,
} from 'lucide-react';
import { getMesas } from '../../api/mesas';
import { getVentas, crearVentaCompleta, cobrarVenta, reimprimirVenta } from '../../api/ventas';
import { getEstadoCajas } from '../../api/caja';
import { getProductos } from '../../api/productos';
import { getCategorias } from '../../api/categorias';
import { BASE_URL } from '../../api/configuracion';
import { usePermisos } from '../../hooks/usePermisos';
import { useAuth } from '../../hooks/useAuth';
import { imprimirLocal, reimprimirConFallback } from '../../utils/impresionLocal';
import { calcularPrecioPesable } from '../../utils/precio';
import ModalLlevar from './components/ModalLlevar';
import ModalMesas from './components/ModalMesas';
import CategoriasBar from './components/CategoriasBar';
import ModalPagoQr from './components/ModalPagoQr';
import SelectorOpcionModal from './components/SelectorOpcionModal';
import ModalPeso from './components/ModalPeso';
import Modal from '../../components/ui/Modal';
import socket from '../../socket';

function nuevoLineaId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `linea-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function VentasPage() {
  const { tienePermiso } = usePermisos();
  const { usuario } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const puedeVer    = tienePermiso('ventas', 'ver');
  const puedeCrear  = tienePermiso('ventas', 'crear');
  const puedeCobrar = tienePermiso('ventas', 'cobrar');

  const [categoriaActiva, setCategoriaActiva] = useState(null);
  const [carrito, setCarrito] = useState([]); // [{linea_id, producto_id, nombre, precio, cantidad, nota, peso?, precio_kg?}]
  const [mesaSeleccionada, setMesaSeleccionada] = useState(null); // id o null
  const [modoLlevar, setModoLlevar] = useState(null); // nombre_cliente o null
  const [modalLlevar, setModalLlevar] = useState(false);
  const [modalMesas, setModalMesas] = useState(false);
  const [modalCobrar, setModalCobrar] = useState(false);
  const [tabMobile, setTabMobile] = useState('productos'); // 'productos' | 'orden'
  const [selectorOpcion, setSelectorOpcion] = useState(null); // producto con grupo_opciones, o null
  const [modalPeso, setModalPeso] = useState(null); // producto pesable pendiente de peso, o null

  const { data: mesas = [], isLoading: cargandoMesas } = useQuery({
    queryKey: ['mesas'],
    queryFn: getMesas,
    enabled: puedeVer,
  });

  const { data: cajasEstado = [], isLoading: cargandoCaja } = useQuery({
    queryKey: ['caja-estado', usuario?.sucursal_activa?.id],
    queryFn: () => getEstadoCajas(usuario?.sucursal_activa?.id),
    refetchInterval: 60_000,
    enabled: puedeVer && !!usuario?.sucursal_activa?.id,
  });

  // sesión abierta del usuario actual (no la primera que aparezca en la sucursal), usada como caja operativa de la venta
  const cajaActiva = cajasEstado.map(c => c.sesion_abierta).find(s => s?.usuario_id === usuario?.id) ?? null;

  const { data: pedidosActivos = [] } = useQuery({
    queryKey: ['ventas', 'activos'],
    queryFn: () => getVentas({ estado: 'pendiente,listo' }),
    enabled: puedeVer,
  });

  const { data: categorias = [] } = useQuery({
    queryKey: ['categorias'],
    queryFn: getCategorias,
  });

  const { data: productos = [], isLoading: cargandoProductos } = useQuery({
    queryKey: ['productos-pos', categoriaActiva],
    queryFn: () => getProductos({ solo_vendibles: true, solo_disponibles: true, order_by: 'mas_vendido', ...(categoriaActiva ? { categoria_id: categoriaActiva } : {}) }),
  });

  useEffect(() => {
    function onActualizar() {
      queryClient.invalidateQueries({ queryKey: ['mesas'] });
      queryClient.invalidateQueries({ queryKey: ['ventas'] });
    }
    socket.on('restaurante:actualizar', onActualizar);
    return () => socket.off('restaurante:actualizar', onActualizar);
  }, [queryClient]);

  const pedidoPorMesa = pedidosActivos.reduce((acc, p) => {
    if (p.mesa_id) acc[p.mesa_id] = p;
    return acc;
  }, {});

  const cantidadPorProducto = useMemo(() => {
    return carrito.reduce((acc, it) => { acc[it.producto_id] = (acc[it.producto_id] ?? 0) + it.cantidad; return acc; }, {});
  }, [carrito]);

  const total = carrito.reduce((sum, it) => sum + it.cantidad * it.precio, 0);
  const totalItems = carrito.reduce((sum, it) => sum + it.cantidad, 0);
  const puedeCobrarAhora = totalItems > 0 && (mesaSeleccionada != null || modoLlevar != null);

  function agregarAlCarrito(prod, nota) {
    setCarrito((prev) => {
      const existente = prev.find((it) => it.producto_id === prod.id && it.nota === nota);
      if (existente) {
        return prev.map((it) => it === existente ? { ...it, cantidad: it.cantidad + 1 } : it);
      }
      return [...prev, { linea_id: nuevoLineaId(), producto_id: prod.id, nombre: prod.nombre, precio: parseFloat(prod.precio), cantidad: 1, nota }];
    });
  }

  function agregarPesableAlCarrito(prod, pesoKg) {
    const precio = calcularPrecioPesable(pesoKg, parseFloat(prod.precio));
    setCarrito((prev) => [...prev, {
      linea_id: nuevoLineaId(), producto_id: prod.id, nombre: prod.nombre,
      precio, cantidad: 1, nota: null, peso: pesoKg, precio_kg: parseFloat(prod.precio),
    }]);
  }

  function handleProducto(prod) {
    if (!puedeCrear) return;
    if (prod.es_pesable) {
      setModalPeso(prod);
      return;
    }
    if (prod.grupos_opciones?.length > 0) {
      setSelectorOpcion(prod);
      return;
    }
    agregarAlCarrito(prod, null);
  }

  function elegirOpcion(nota) {
    agregarAlCarrito(selectorOpcion, nota);
    setSelectorOpcion(null);
  }

  function incrementar(linea_id) {
    setCarrito((prev) => prev.map((it) => it.linea_id === linea_id ? { ...it, cantidad: it.cantidad + 1 } : it));
  }

  function decrementar(linea_id) {
    setCarrito((prev) => {
      const item = prev.find((it) => it.linea_id === linea_id);
      if (item.cantidad <= 1) return prev.filter((it) => it !== item);
      return prev.map((it) => it === item ? { ...it, cantidad: it.cantidad - 1 } : it);
    });
  }

  function quitar(linea_id) {
    setCarrito((prev) => prev.filter((it) => it.linea_id !== linea_id));
  }

  function handleClickMesaDisponible(mesa) {
    setModoLlevar(null);
    setMesaSeleccionada((prev) => prev === mesa.id ? null : mesa.id);
  }

  function handleClickMesaOcupada(mesa) {
    const pedido = pedidoPorMesa[mesa.id];
    if (pedido) navigate(`/ventas/pedido/${pedido.id}`);
  }

  function limpiarTodo() {
    setCarrito([]);
    setMesaSeleccionada(null);
    setModoLlevar(null);
  }

  const mesaActual = mesas.find((m) => m.id === mesaSeleccionada);
  const mesasOcupadas = mesas.filter((m) => m.estado === 'ocupada' && pedidoPorMesa[m.id]);

  if (!puedeVer) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
        <AlertCircle className="w-10 h-10" />
        <p className="text-sm font-medium">No tienes permiso para ver ventas</p>
      </div>
    );
  }

  if (!cargandoCaja && !cajaActiva) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-amber-600 dark:text-amber-400">
        <Wallet className="w-10 h-10" />
        <p className="text-sm font-medium">No hay caja abierta</p>
        <button onClick={() => navigate('/caja')} className="text-sm underline flex items-center gap-1">
          Ir a Caja <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <header className="flex items-center justify-between gap-3 pb-3 border-b border-border shrink-0">
        <h1 className="font-bold text-foreground">Ventas</h1>
        <div className="flex md:hidden gap-1 bg-muted p-1 rounded-xl">
          <button
            onClick={() => setTabMobile('productos')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${tabMobile === 'productos' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}
          >
            Menú
          </button>
          <button
            onClick={() => setTabMobile('orden')}
            className={`relative px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${tabMobile === 'orden' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}
          >
            Orden
            {totalItems > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-primary text-primary-foreground text-[10px] rounded-full flex items-center justify-center">
                {totalItems}
              </span>
            )}
          </button>
        </div>
      </header>

      <div className="flex flex-1 gap-4 overflow-hidden pt-4">
        {/* Panel izquierdo: productos */}
        <div className={`flex flex-col flex-1 min-w-0 overflow-hidden ${tabMobile === 'orden' ? 'hidden md:flex' : 'flex'}`}>
          <CategoriasBar
            categorias={categorias}
            categoriaActiva={categoriaActiva}
            onSeleccionar={setCategoriaActiva}
          />

          <div className="flex-1 overflow-y-auto mt-2 pb-4">
            {cargandoProductos ? (
              <div className="flex items-center justify-center h-32 gap-2 text-muted-foreground">
                <RefreshCw className="w-4 h-4 animate-spin" /><span className="text-sm">Cargando...</span>
              </div>
            ) : productos.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2 text-muted-foreground">
                <Package className="w-8 h-8" />
                <p className="text-sm">No hay productos en esta categoría</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {productos.map((prod) => {
                  const cantidadEnCarrito = cantidadPorProducto[prod.id];
                  return (
                    <button
                      key={prod.id}
                      onClick={() => handleProducto(prod)}
                      disabled={!puedeCrear}
                      className={`relative flex flex-col rounded-xl border transition-all text-left overflow-hidden ${
                        !puedeCrear
                          ? 'opacity-50 cursor-not-allowed'
                          : cantidadEnCarrito
                          ? 'border-primary bg-primary/10 hover:bg-primary/15'
                          : 'border-border bg-card hover:border-primary/50 hover:shadow-sm'
                      }`}
                    >
                      <div className="w-full aspect-square bg-muted overflow-hidden">
                        {prod.imagen ? (
                          <img src={`${BASE_URL}${prod.imagen}`} alt={prod.nombre} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Package className="w-10 h-10 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                      <div className="p-2.5">
                        <p className="text-sm font-medium text-foreground leading-tight line-clamp-2">{prod.nombre}</p>
                        <p className="text-sm font-bold text-primary mt-1">Bs {parseFloat(prod.precio).toFixed(2)}{prod.es_pesable ? '/kg' : ''}</p>
                      </div>
                      {cantidadEnCarrito && !prod.es_pesable && (
                        <span className="absolute top-2 right-2 w-6 h-6 bg-primary text-primary-foreground text-xs font-bold rounded-full flex items-center justify-center shadow">
                          {cantidadEnCarrito}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Panel derecho: orden + mesas + cobro */}
        <aside className={`flex flex-col w-full md:w-[320px] lg:w-[360px] xl:w-[400px] shrink-0 overflow-y-auto gap-4 ${tabMobile === 'productos' ? 'hidden md:flex' : 'flex'}`}>

          {/* Carrito */}
          <div className="flex flex-col bg-card border border-border rounded-2xl overflow-hidden shrink-0">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShoppingCart className="w-4 h-4 text-muted-foreground" />
                <span className="font-semibold text-sm text-foreground">Orden</span>
              </div>
              {carrito.length > 0 && (
                <button onClick={limpiarTodo} className="text-xs text-destructive hover:text-destructive/80">Vaciar</button>
              )}
            </div>
            <div className="max-h-64 overflow-y-auto divide-y divide-border">
              {carrito.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-24 gap-2 text-muted-foreground">
                  <ShoppingCart className="w-8 h-8" />
                  <p className="text-xs">Toca un producto para agregarlo</p>
                </div>
              ) : (
                carrito.map((it) => (
                  <div key={it.linea_id} className="px-4 py-2.5 flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{it.nombre}</p>
                      {it.nota && <p className="text-xs text-amber-600 dark:text-amber-400 truncate">{it.nota}</p>}
                      {it.peso != null ? (
                        <p className="text-xs text-muted-foreground">{it.peso.toFixed(3)} kg × Bs {it.precio_kg.toFixed(2)}/kg</p>
                      ) : (
                        <p className="text-xs text-muted-foreground">Bs {it.precio.toFixed(2)} c/u</p>
                      )}
                    </div>
                    {it.peso != null ? (
                      <span className="text-sm font-semibold text-foreground shrink-0">{it.peso.toFixed(3)} kg</span>
                    ) : (
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => decrementar(it.linea_id)} className="w-6 h-6 rounded-lg bg-muted hover:bg-accent hover:text-accent-foreground flex items-center justify-center">
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="w-5 text-center text-sm font-semibold text-foreground">{it.cantidad}</span>
                        <button onClick={() => incrementar(it.linea_id)} className="w-6 h-6 rounded-lg bg-muted hover:bg-accent hover:text-accent-foreground flex items-center justify-center">
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                    <button onClick={() => quitar(it.linea_id)} className="shrink-0 p-1 text-muted-foreground hover:text-destructive">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="px-4 py-3 flex items-center justify-between bg-muted border-t border-border">
              <span className="text-sm font-medium text-muted-foreground">Total</span>
              <span className="text-xl font-bold text-foreground">Bs {total.toFixed(2)}</span>
            </div>
          </div>

          {/* Mesa / para llevar */}
          <div className="flex flex-col bg-card border border-border rounded-2xl overflow-hidden shrink-0">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <span className="font-semibold text-sm text-foreground">Mesa</span>
              <button
                onClick={() => setModalLlevar(true)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  modoLlevar ? 'bg-orange-500 text-white' : 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 hover:bg-orange-100 dark:hover:bg-orange-900/30'
                }`}
              >
                <ShoppingBag className="w-3.5 h-3.5" />
                {modoLlevar ? `Llevar: ${modoLlevar}` : 'Para llevar'}
              </button>
            </div>

            <div className="p-3 flex flex-col gap-3">
              <button
                onClick={() => setModalMesas(true)}
                disabled={cargandoMesas}
                className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl border-2 text-left transition-colors ${
                  mesaActual
                    ? 'border-primary bg-primary/10'
                    : 'border-dashed border-border hover:border-primary'
                }`}
              >
                <LayoutGrid className={`w-4.5 h-4.5 shrink-0 ${mesaActual ? 'text-primary' : 'text-muted-foreground'}`} />
                <span className="flex-1 min-w-0">
                  {mesaActual ? (
                    <>
                      <span className="block text-sm font-semibold text-foreground">{mesaActual.nombre}</span>
                      <span className="block text-xs text-muted-foreground">{mesaActual.area?.nombre ?? 'Sin área'} · {mesaActual.asientos} asientos</span>
                    </>
                  ) : (
                    <span className="text-sm font-medium text-muted-foreground">
                      {cargandoMesas ? 'Cargando mesas...' : 'Elegir mesa'}
                    </span>
                  )}
                </span>
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              </button>

              {mesasOcupadas.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
                    Mesas ocupadas ({mesasOcupadas.length})
                  </p>
                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                    {mesasOcupadas.map((mesa) => (
                      <button
                        key={mesa.id}
                        onClick={() => handleClickMesaOcupada(mesa)}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-xs font-medium text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                        {mesa.nombre}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Cobrar */}
          {puedeCobrar && (
            <button
              onClick={() => setModalCobrar(true)}
              disabled={!puedeCobrarAhora}
              className="w-full flex items-center justify-center gap-2 py-3.5 bg-primary hover:bg-primary/90 active:bg-primary/80 disabled:opacity-50 text-primary-foreground rounded-xl font-bold text-base transition-colors shadow-sm shrink-0"
            >
              <CreditCard className="w-5 h-5" /> Cobrar
            </button>
          )}
        </aside>
      </div>

      {modalLlevar && (
        <ModalLlevar
          cargando={false}
          onClose={() => setModalLlevar(false)}
          onConfirmar={(nombre) => {
            setMesaSeleccionada(null);
            setModoLlevar(nombre || 'Cliente');
            setModalLlevar(false);
          }}
        />
      )}

      {modalMesas && (
        <ModalMesas
          mesas={mesas}
          pedidoPorMesa={pedidoPorMesa}
          mesaSeleccionada={mesaSeleccionada}
          onSeleccionar={(mesa) => handleClickMesaDisponible(mesa)}
          onClose={() => setModalMesas(false)}
        />
      )}

      {modalCobrar && (
        <ModalCobrar
          total={total}
          carrito={carrito}
          tipo={modoLlevar ? 'llevar' : 'mesa'}
          mesaId={mesaSeleccionada}
          nombreCliente={modoLlevar}
          sesionCajaId={cajaActiva?.id}
          onClose={() => setModalCobrar(false)}
          onExito={() => {
            limpiarTodo();
            setModalCobrar(false);
            queryClient.invalidateQueries({ queryKey: ['mesas'] });
            queryClient.invalidateQueries({ queryKey: ['ventas'] });
          }}
        />
      )}

      {selectorOpcion && (
        <SelectorOpcionModal
          producto={selectorOpcion}
          onElegir={elegirOpcion}
          onClose={() => setSelectorOpcion(null)}
        />
      )}

      {modalPeso && (
        <ModalPeso
          producto={modalPeso}
          onConfirmar={(pesoKg) => { agregarPesableAlCarrito(modalPeso, pesoKg); setModalPeso(null); }}
          onClose={() => setModalPeso(null)}
        />
      )}
    </div>
  );
}

/* ─── Modal Cobrar ──────────────────────────────────────────────────────── */

function ModalCobrar({ total, carrito, tipo, mesaId, nombreCliente, sesionCajaId, onClose, onExito }) {
  const [metodo, setMetodo] = useState('efectivo');
  const [notas, setNotas] = useState('');
  const [error, setError] = useState(null);
  const [pagoQrEstado, setPagoQrEstado] = useState(null); // { pedidoId, pagoQr } | null
  const [ventaExitosa, setVentaExitosa] = useState(null); // { pedidoId, metodoPago } | null

  const reimprimir = useMutation({
    mutationFn: () => reimprimirVenta(ventaExitosa.pedidoId),
    onSuccess: (datos) => reimprimirConFallback(datos),
  });

  const iniciar = useMutation({
    mutationFn: () => crearVentaCompleta({
      tipo,
      mesa_id: tipo === 'mesa' ? mesaId : undefined,
      nombre_cliente: nombreCliente ?? undefined,
      notas: notas.trim() || undefined,
      items: carrito.map((it) => ({ producto_id: it.producto_id, cantidad: it.cantidad, nota: it.nota, peso: it.peso })),
      metodo_pago: metodo,
      monto_recibido: total,
      sesion_caja_id: sesionCajaId,
    }),
    onSuccess: (resultado) => {
      if (resultado.pago_qr) {
        setPagoQrEstado({ pedidoId: resultado.pedido.id, pagoQr: resultado.pago_qr });
      } else {
        imprimirLocal(resultado.datos_impresion);
        setVentaExitosa({ pedidoId: resultado.id, metodoPago: metodo });
      }
    },
    onError: (err) => setError(err?.response?.data?.mensaje ?? 'Error al cobrar'),
  });

  const reintentar = useMutation({
    mutationFn: () => cobrarVenta(pagoQrEstado.pedidoId, { metodo_pago: 'qr', monto_recibido: total }),
    onSuccess: (resultado) => setPagoQrEstado({ pedidoId: resultado.pedido.id, pagoQr: resultado.pago_qr }),
    onError: (err) => setError(err?.response?.data?.mensaje ?? 'Error al generar el QR'),
  });

  if (ventaExitosa) {
    return (
      <Modal titulo="Venta cobrada" onClose={onExito} ancho="max-w-sm">
        <div className="space-y-5 text-center">
          <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto" />
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Total cobrado</p>
            <p className="text-3xl font-bold text-foreground">Bs {total.toFixed(2)}</p>
            <p className="text-sm text-muted-foreground mt-1">
              {ventaExitosa.metodoPago === 'qr' ? 'QR / Transferencia' : 'Efectivo'}
            </p>
          </div>
          {reimprimir.isError && (
            <p className="text-sm text-destructive">No se pudo reimprimir.</p>
          )}
          <div className="flex justify-center gap-3">
            <button
              onClick={() => reimprimir.mutate()}
              disabled={reimprimir.isPending}
              className="px-4 py-2 rounded-xl text-sm border border-border text-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-60"
            >
              {reimprimir.isPending ? 'Imprimiendo...' : '🖨 Imprimir de nuevo'}
            </button>
            <button
              onClick={onExito}
              className="px-5 py-2 rounded-xl text-sm bg-primary hover:bg-primary/90 text-primary-foreground font-semibold transition-colors"
            >
              Cerrar
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  if (pagoQrEstado) {
    return (
      <ModalPagoQr
        pedidoId={pagoQrEstado.pedidoId}
        pagoQr={pagoQrEstado.pagoQr}
        onClose={onClose}
        onCompletado={(pedido) => setVentaExitosa({ pedidoId: pedido.id, metodoPago: 'qr' })}
        onReintentar={() => reintentar.mutate()}
      />
    );
  }

  return (
    <Modal titulo="Cobrar orden" onClose={onClose} ancho="max-w-sm">
      <div className="space-y-5">
        <div className="bg-muted rounded-xl p-4 text-center">
          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Total a cobrar</p>
          <p className="text-3xl font-bold text-foreground">Bs {total.toFixed(2)}</p>
        </div>

        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Método de pago</p>
          <div className="grid grid-cols-2 gap-2">
            {[{ id: 'efectivo', label: 'Efectivo' }, { id: 'qr', label: 'QR / Transferencia' }].map((m) => (
              <button
                key={m.id}
                onClick={() => { setMetodo(m.id); setError(null); }}
                className={`py-3 rounded-xl text-sm font-medium border transition-colors ${
                  metodo === m.id ? 'bg-primary border-primary text-primary-foreground' : 'border-border text-muted-foreground hover:border-primary/50'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Nota del pedido (opcional)</p>
          <textarea
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            placeholder="Ej: entregar en recepción, para llevar en dos bolsas..."
            rows={2}
            className="w-full text-sm border border-input rounded-xl px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end gap-3 pt-1">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors">
            Cancelar
          </button>
          <button
            onClick={() => iniciar.mutate()}
            disabled={iniciar.isPending}
            className="px-5 py-2 rounded-xl text-sm bg-primary hover:bg-primary/90 text-primary-foreground font-semibold transition-colors disabled:opacity-60"
          >
            {iniciar.isPending ? 'Procesando...' : 'Confirmar cobro'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Verificar lint**

Run: `cd frontend && npm run lint`
Expected: 0 errores nuevos en `VentasPage.jsx`.

- [ ] **Step 3: Verificar build**

Run: `cd frontend && npm run build`
Expected: si falla, debe ser exactamente por el problema preexistente y no relacionado en `frontend/src/api/ventas.js` (`reimprimirVenta` no exportada, de un commit anterior a este plan). Verifícalo leyendo el mensaje de error.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/ventas/VentasPage.jsx
git commit -m "style(ventas): retonear VentasPage.jsx a los tokens shadcn"
```

---

### Task 2: Clúster de selección de mesa — `ModalMesas.jsx`, `TarjetaMesa.jsx`, `CategoriasBar.jsx`

**Files:**
- Modify: `frontend/src/pages/ventas/components/ModalMesas.jsx` (reescritura completa)
- Modify: `frontend/src/pages/ventas/components/TarjetaMesa.jsx` (reescritura completa)
- Modify: `frontend/src/pages/ventas/components/CategoriasBar.jsx` (reescritura completa)

**Interfaces:** No consume ni produce interfaces nuevas.

- [ ] **Step 1: Reemplazar el contenido completo de `frontend/src/pages/ventas/components/ModalMesas.jsx`**

```jsx
import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import Modal from '../../../components/ui/Modal';
import TarjetaMesa from './TarjetaMesa';

const LEYENDA = [
  { estado: 'disponible', label: 'Disponible', punto: 'bg-green-500' },
  { estado: 'ocupada', label: 'Ocupada', punto: 'bg-red-500' },
  { estado: 'reservada', label: 'Reservada', punto: 'bg-amber-500' },
];

export default function ModalMesas({ mesas, pedidoPorMesa, mesaSeleccionada, onSeleccionar, onClose }) {
  const [areaActiva, setAreaActiva] = useState('todas');
  const [busqueda, setBusqueda] = useState('');

  const areas = useMemo(() => {
    const nombres = new Set(mesas.map((m) => m.area?.nombre ?? 'Sin área'));
    return Array.from(nombres);
  }, [mesas]);

  const mesasFiltradas = mesas.filter((mesa) => {
    const area = mesa.area?.nombre ?? 'Sin área';
    if (areaActiva !== 'todas' && area !== areaActiva) return false;
    if (busqueda.trim() && !mesa.nombre.toLowerCase().includes(busqueda.trim().toLowerCase())) return false;
    return true;
  });

  function elegir(mesa) {
    if (mesa.estado !== 'disponible') return;
    onSeleccionar(mesa);
    onClose();
  }

  return (
    <Modal titulo="Elegir mesa" onClose={onClose} ancho="max-w-3xl">
      <div className="flex flex-col gap-3 -mt-1">
        {/* Buscador + leyenda */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar mesa..."
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-input bg-muted text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex items-center gap-3 shrink-0 pl-1">
            {LEYENDA.map((l) => (
              <span key={l.estado} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={`w-2 h-2 rounded-full ${l.punto}`} />
                {l.label}
              </span>
            ))}
          </div>
        </div>

        {/* Chips de área */}
        {areas.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            <button
              onClick={() => setAreaActiva('todas')}
              className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                areaActiva === 'todas' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              }`}
            >
              Todas ({mesas.length})
            </button>
            {areas.map((area) => (
              <button
                key={area}
                onClick={() => setAreaActiva(area)}
                className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                  areaActiva === area ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                }`}
              >
                {area} ({mesas.filter((m) => (m.area?.nombre ?? 'Sin área') === area).length})
              </button>
            ))}
          </div>
        )}

        {/* Grid de mesas */}
        {mesasFiltradas.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-muted-foreground">
            <p className="text-sm">No se encontraron mesas</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-[55vh] overflow-y-auto pr-1 -mr-1">
            {mesasFiltradas.map((mesa) => (
              <TarjetaMesa
                key={mesa.id}
                mesa={mesa}
                pedido={pedidoPorMesa[mesa.id]}
                seleccionada={mesaSeleccionada === mesa.id}
                clickable={mesa.estado === 'disponible'}
                onClick={() => elegir(mesa)}
              />
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Reemplazar el contenido completo de `frontend/src/pages/ventas/components/TarjetaMesa.jsx`**

```jsx
import { Users } from 'lucide-react';

const ESTADO_CONFIG = {
  disponible: {
    label: 'Disponible',
    badge: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
    border: 'border-green-400 dark:border-green-600',
    bg: 'bg-green-50 dark:bg-green-950/30',
    punto: 'bg-green-500',
  },
  ocupada: {
    label: 'Ocupada',
    badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
    border: 'border-red-400 dark:border-red-600',
    bg: 'bg-red-50 dark:bg-red-950/30',
    punto: 'bg-red-500',
  },
  reservada: {
    label: 'Reservada',
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
    border: 'border-amber-400 dark:border-amber-600',
    bg: 'bg-amber-50 dark:bg-amber-950/30',
    punto: 'bg-amber-500',
  },
};

export default function TarjetaMesa({ mesa, pedido, onClick, clickable, seleccionada = false }) {
  const cfg = ESTADO_CONFIG[mesa.estado] ?? ESTADO_CONFIG.disponible;

  return (
    <button
      type="button"
      onClick={clickable ? onClick : undefined}
      disabled={!clickable}
      className={`
        w-full text-left rounded-xl border-2 p-4 transition-all duration-150
        ${cfg.border} ${cfg.bg}
        ${seleccionada ? 'ring-2 ring-ring ring-offset-2 dark:ring-offset-background' : ''}
        ${clickable
          ? 'cursor-pointer hover:shadow-md hover:scale-[1.02] active:scale-[0.98]'
          : 'cursor-default opacity-70'
        }
      `}
    >
      {/* Encabezado */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <span className="text-base font-bold text-foreground leading-tight">
          {mesa.nombre}
        </span>
        <span className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full ${cfg.badge}`}>
          {cfg.label}
        </span>
      </div>

      {/* Info */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Users className="w-3.5 h-3.5" />
        <span>{mesa.asientos} asientos</span>
      </div>

      {/* Área */}
      {mesa.area && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {mesa.area.nombre}
        </p>
      )}

      {/* Orden activa */}
      {pedido && (
        <div className="mt-3 pt-2.5 border-t border-border">
          <p className="text-xs font-medium text-foreground">
            Orden #{pedido.id}
          </p>
          <p className="text-xs text-muted-foreground">
            {pedido.detalles?.length ?? 0} ítem(s) · Bs {parseFloat(pedido.total ?? 0).toFixed(2)}
          </p>
        </div>
      )}
    </button>
  );
}
```

- [ ] **Step 3: Reemplazar el contenido completo de `frontend/src/pages/ventas/components/CategoriasBar.jsx`**

```jsx
export default function CategoriasBar({ categorias, categoriaActiva, onSeleccionar }) {
  const items = [{ id: null, nombre: 'Todos' }, ...categorias];

  return (
    <div className="flex flex-wrap gap-2 shrink-0">
      {items.map((cat) => {
        const activa = categoriaActiva === cat.id;
        return (
          <button
            key={cat.id ?? 'todos'}
            type="button"
            onClick={() => onSeleccionar(cat.id)}
            className={`px-4 py-2 rounded-full text-sm font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:focus-visible:ring-offset-background ${
              activa
                ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/30'
                : 'bg-card border border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
            }`}
          >
            {cat.nombre}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Verificar lint y build**

Run: `cd frontend && npm run lint` — 0 errores nuevos en estos 3 archivos.
Run: `cd frontend && npm run build` — mismo criterio que Task 1 (falla esperada solo por `reimprimirVenta`, preexistente).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/ventas/components/ModalMesas.jsx frontend/src/pages/ventas/components/TarjetaMesa.jsx frontend/src/pages/ventas/components/CategoriasBar.jsx
git commit -m "style(ventas): retonear clúster de selección de mesa a los tokens shadcn"
```

---

### Task 3: Clúster de modales simples — `ModalLlevar.jsx`, `ModalPeso.jsx`, `ModalPagoQr.jsx`, `SelectorOpcionModal.jsx`

**Files:**
- Modify: `frontend/src/pages/ventas/components/ModalLlevar.jsx` (reescritura completa)
- Modify: `frontend/src/pages/ventas/components/ModalPeso.jsx` (reescritura completa)
- Modify: `frontend/src/pages/ventas/components/ModalPagoQr.jsx` (reescritura completa)
- Modify: `frontend/src/pages/ventas/components/SelectorOpcionModal.jsx` (reescritura completa)

**Interfaces:** No consume ni produce interfaces nuevas.

- [ ] **Step 1: Reemplazar el contenido completo de `frontend/src/pages/ventas/components/ModalLlevar.jsx`**

```jsx
import { useState } from 'react';
import Modal from '../../../components/ui/Modal';

export default function ModalLlevar({ onClose, onConfirmar, cargando }) {
  const [nombre, setNombre] = useState('');
  return (
    <Modal titulo="Nuevo pedido para llevar" onClose={onClose} ancho="max-w-sm">
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
            Nombre del cliente
          </label>
          <input
            type="text"
            autoFocus
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && nombre.trim() && onConfirmar(nombre.trim())}
            placeholder="Ej: Juan, Mesa exterior..."
            className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
          />
        </div>
        <div className="flex justify-end gap-3 pt-1">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={() => onConfirmar(nombre.trim() || 'Cliente')}
            disabled={cargando}
            className="px-5 py-2 rounded-xl text-sm bg-primary hover:bg-primary/90 disabled:opacity-60 text-primary-foreground font-semibold transition-colors"
          >
            {cargando ? 'Creando...' : 'Crear pedido'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Reemplazar el contenido completo de `frontend/src/pages/ventas/components/ModalPeso.jsx`**

```jsx
import { useState } from 'react';
import Modal from '../../../components/ui/Modal';
import { calcularPrecioPesable } from '../../../utils/precio';

export default function ModalPeso({ producto, pesoInicial, onConfirmar, onClose, textoConfirmar = 'Agregar' }) {
  const [peso, setPeso] = useState(pesoInicial != null ? String(pesoInicial) : '');

  const pesoNum = parseFloat(peso);
  const pesoValido = pesoNum > 0;
  const precioKg = parseFloat(producto.precio);
  const precioCalculado = pesoValido ? calcularPrecioPesable(pesoNum, precioKg) : null;

  function confirmar() {
    if (!pesoValido) return;
    onConfirmar(pesoNum);
  }

  return (
    <Modal titulo={`${producto.nombre} — por peso`} onClose={onClose} ancho="max-w-sm">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Precio por kg: Bs {precioKg.toFixed(2)}</p>

        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
            Peso (kg) *
          </label>
          <input
            autoFocus
            type="number"
            min="0.001"
            step="0.001"
            value={peso}
            onChange={(e) => setPeso(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') confirmar(); }}
            placeholder="0.000"
            className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
          />
        </div>

        <div className="bg-muted rounded-xl p-4 text-center">
          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Precio calculado</p>
          <p className="text-2xl font-bold text-foreground">
            {precioCalculado !== null ? `Bs ${precioCalculado.toFixed(2)}` : '—'}
          </p>
        </div>

        <div className="flex justify-end gap-3 pt-1">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors">
            Cancelar
          </button>
          <button
            onClick={confirmar}
            disabled={!pesoValido}
            className="px-5 py-2 rounded-xl text-sm bg-primary hover:bg-primary/90 text-primary-foreground font-semibold transition-colors disabled:opacity-60"
          >
            {textoConfirmar}
          </button>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 3: Reemplazar el contenido completo de `frontend/src/pages/ventas/components/ModalPagoQr.jsx`**

```jsx
import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { consultarEstadoPagoQr, cancelarPagoQr } from '../../../api/pagosQr';
import { reimprimirVenta } from '../../../api/ventas';
import { imprimirLocal } from '../../../utils/impresionLocal';
import Modal from '../../../components/ui/Modal';

export default function ModalPagoQr({ pedidoId, pagoQr, onClose, onCompletado, onReintentar }) {
  const [restanteMs, setRestanteMs] = useState(() => Math.max(0, new Date(pagoQr.expires_at).getTime() - Date.now()));

  const estadoQuery = useQuery({
    queryKey: ['pago-qr-estado', pedidoId, pagoQr.tx_id],
    queryFn: () => consultarEstadoPagoQr(pedidoId),
    refetchInterval: (query) => {
      const estado = query.state.data?.estado;
      return (!estado || estado === 'pendiente') ? 3000 : false;
    },
  });

  const cancelar = useMutation({
    mutationFn: () => cancelarPagoQr(pedidoId),
    onSuccess: () => onClose(),
  });

  useEffect(() => {
    const intervalo = setInterval(() => {
      setRestanteMs(Math.max(0, new Date(pagoQr.expires_at).getTime() - Date.now()));
    }, 1000);
    return () => clearInterval(intervalo);
  }, [pagoQr.expires_at]);

  const estado = estadoQuery.data?.estado ?? 'pendiente';

  const handleClose = () => {
    if (estado === 'pendiente') {
      if (!cancelar.isPending) cancelar.mutate();
      return;
    }
    onClose();
  };

  useEffect(() => {
    if (estado === 'completado' && estadoQuery.data?.pedido) {
      reimprimirVenta(estadoQuery.data.pedido.id).then(imprimirLocal).catch(() => {
        // Sin agente local en esta PC: no pasa nada, el socket.io del backend
        // ya mandó el mismo ticket como respaldo (ver _emitirImpresion).
      });
      onCompletado(estadoQuery.data.pedido);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  const minutos = Math.floor(restanteMs / 60000);
  const segundos = Math.floor((restanteMs % 60000) / 1000);

  return (
    <Modal titulo="Cobro por QR" onClose={handleClose} ancho="max-w-sm">
      <div className="space-y-4 text-center">
        {estado === 'pendiente' && (
          <>
            <img
              src={pagoQr.qr_code}
              alt="Código QR de pago"
              className="mx-auto w-56 h-56 sm:w-64 sm:h-64 rounded-xl border border-border object-contain"
            />
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Total que paga el cliente</p>
              <p className="text-2xl font-bold text-foreground">
                Bs {Number(pagoQr.monto_total ?? pagoQr.monto_neto).toFixed(2)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Expira en {minutos}:{String(segundos).padStart(2, '0')}
              </p>
            </div>
            <button
              onClick={handleClose}
              disabled={cancelar.isPending}
              className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-60"
            >
              Cancelar cobro QR
            </button>
          </>
        )}

        {(estado === 'fallido' || estado === 'expirado') && (
          <div className="space-y-4">
            <p className="text-sm text-destructive">
              {estado === 'expirado' ? 'El QR expiró sin que se registre el pago.' : 'El pago no se completó.'}
            </p>
            <div className="flex justify-center gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                Cambiar método de pago
              </button>
              <button
                onClick={onReintentar}
                className="px-4 py-2 rounded-xl text-sm bg-primary hover:bg-primary/90 text-primary-foreground font-semibold transition-colors"
              >
                Reintentar
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
```

- [ ] **Step 4: Reemplazar el contenido completo de `frontend/src/pages/ventas/components/SelectorOpcionModal.jsx`**

```jsx
import { useState, useEffect } from 'react';
import Modal from '../../../components/ui/Modal';

export default function SelectorOpcionModal({ producto, onElegir, onClose }) {
  const grupos = producto.grupos_opciones ?? [];
  const [paso, setPaso] = useState(0);
  const [selecciones, setSelecciones] = useState({}); // { [grupoId]: string[] }
  const [multipleElegidas, setMultipleElegidas] = useState([]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMultipleElegidas([]);
  }, [paso]);

  const grupoActual = grupos[paso];
  const esUltimoPaso = paso === grupos.length - 1;

  function construirNotaFinal(seleccionesFinales) {
    const partes = grupos
      .map((g) => {
        const elegidas = seleccionesFinales[g.id] ?? [];
        if (elegidas.length === 0) return null;
        return `${g.nombre}: ${elegidas.join(', ')}`;
      })
      .filter(Boolean);
    if (partes.length === 0) return null;
    const texto = partes.join(' · ');
    return texto.length > 255 ? `${texto.slice(0, 252)}...` : texto;
  }

  function avanzar(seleccionesActualizadas) {
    if (esUltimoPaso) {
      onElegir(construirNotaFinal(seleccionesActualizadas));
    } else {
      setSelecciones(seleccionesActualizadas);
      setPaso((p) => p + 1);
    }
  }

  function elegirUnica(opcionNombre) {
    avanzar({ ...selecciones, [grupoActual.id]: [opcionNombre] });
  }

  function saltarPaso() {
    avanzar({ ...selecciones, [grupoActual.id]: [] });
  }

  function toggleMultiple(opcionNombre) {
    setMultipleElegidas((prev) =>
      prev.includes(opcionNombre) ? prev.filter((o) => o !== opcionNombre) : [...prev, opcionNombre]
    );
  }

  function confirmarMultiple() {
    avanzar({ ...selecciones, [grupoActual.id]: multipleElegidas });
  }

  return (
    <Modal titulo={`${producto.nombre} — ${grupoActual.nombre}`} onClose={onClose}>
      <div className="space-y-4">
        {grupos.length > 1 && (
          <p className="text-xs text-muted-foreground">Paso {paso + 1} de {grupos.length}</p>
        )}

        {grupoActual.tipo_seleccion === 'multiple' ? (
          <>
            <div className="flex flex-wrap gap-2">
              {grupoActual.opciones.map((opcion) => (
                <button
                  key={opcion.id}
                  type="button"
                  onClick={() => toggleMultiple(opcion.nombre)}
                  className={`px-4 py-2 rounded-full text-sm font-semibold border transition-all ${
                    multipleElegidas.includes(opcion.nombre)
                      ? 'bg-primary border-primary text-primary-foreground'
                      : 'bg-card border-border text-muted-foreground hover:border-primary/50'
                  }`}
                >
                  {opcion.nombre}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={confirmarMultiple}
              disabled={grupoActual.obligatorio && multipleElegidas.length === 0}
              className="w-full px-4 py-2 rounded-xl text-sm font-semibold bg-primary hover:bg-primary/90 text-primary-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {esUltimoPaso ? 'Agregar' : 'Continuar'}
            </button>
          </>
        ) : (
          <div className="flex flex-wrap gap-2">
            {grupoActual.opciones.map((opcion) => (
              <button
                key={opcion.id}
                type="button"
                onClick={() => elegirUnica(opcion.nombre)}
                className="px-4 py-2 rounded-full text-sm font-semibold bg-card border border-border text-muted-foreground hover:border-primary/50 hover:text-foreground transition-all"
              >
                {opcion.nombre}
              </button>
            ))}
          </div>
        )}

        {!grupoActual.obligatorio && (
          <button
            type="button"
            onClick={saltarPaso}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Saltar este paso
          </button>
        )}
      </div>
    </Modal>
  );
}
```

- [ ] **Step 5: Verificar lint y build**

Run: `cd frontend && npm run lint` — 0 errores nuevos en estos 4 archivos.
Run: `cd frontend && npm run build` — mismo criterio que Task 1.

- [ ] **Step 6: Verificación manual (queda pendiente para el usuario)**

No hay navegador disponible para verificar esto en un subagente. Documenta en el reporte que falta confirmar manualmente:
1. El color de marca (`color_primario`) se refleja en: categoría activa, chip de área activo en "Elegir mesa", producto seleccionado en el grid, mesa seleccionada, botón "Cobrar", pasos del selector de opciones — en modo claro y oscuro.
2. Los estados de mesa (disponible/ocupada/reservada) siguen mostrándose en verde/rojo/ámbar sin cambio.
3. El toggle "Para llevar" sigue naranja, visualmente distinto de "mesa seleccionada" (ahora del color de marca).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/ventas/components/ModalLlevar.jsx frontend/src/pages/ventas/components/ModalPeso.jsx frontend/src/pages/ventas/components/ModalPagoQr.jsx frontend/src/pages/ventas/components/SelectorOpcionModal.jsx
git commit -m "style(ventas): retonear modales simples a los tokens shadcn"
```
