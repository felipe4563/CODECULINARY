import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Minus, ShoppingCart, X, Loader2, CheckCircle2, AlertCircle, Package, Sun, Moon, User, Star, History, LogOut, KeyRound, Gift, ChevronDown } from 'lucide-react';
import {
  getMenuAutoservicio, crearPedidoAutoservicio, validarCuponAutoservicio, getEstadoPedidoAutoservicio,
} from '../../api/autoservicio';
import { getConfiguracionPublica, logoSrc } from '../../api/configuracion';
import {
  estadoCliente, solicitarPinCliente, confirmarPinCliente, verificarPinCliente,
  cambiarPinCliente, perfilCliente, historialCliente,
  recuperarPinSolicitarCliente, recuperarPinConfirmarCliente,
} from '../../api/clientePublico';
import { useClienteAutoservicioStore } from '../../store/clienteAutoservicioStore';
import { useTemaAutoservicio } from '../../hooks/useTemaAutoservicio';
import SelectorOpcionModal from '../ventas/components/SelectorOpcionModal';

const bs = (n) => `Bs ${parseFloat(n || 0).toFixed(2)}`;

export default function AutoservicioPage() {
  const { codigo } = useParams();
  const queryClient = useQueryClient();
  const [carrito, setCarrito] = useState([]); // [{ tipo: 'producto', producto, opcion_ids, cantidad } | { tipo: 'combo', combo, cantidad }]
  const [mostrarCarrito, setMostrarCarrito] = useState(false);
  const [pedido, setPedido] = useState(null); // { pedido, pago_qr } luego de confirmar
  const [cuponCodigo, setCuponCodigo] = useState('');
  const [cuponAplicado, setCuponAplicado] = useState(null); // { codigo, descuento } tras validar OK
  const [ciCliente, setCiCliente] = useState('');
  const { modo, toggleModo } = useTemaAutoservicio();
  const [mostrarCuenta, setMostrarCuenta] = useState(false);
  const [puntosACanjear, setPuntosACanjear] = useState(0);
  const [categoriaActiva, setCategoriaActiva] = useState(null); // null = todas
  const [selectorOpcion, setSelectorOpcion] = useState(null); // producto con grupos_opciones, mientras se elige
  const [colaOpcionesCombo, setColaOpcionesCombo] = useState(null); // { combo, pendientes: [producto...], resueltas: [{producto_id, opcion_ids}] } | null
  const { token } = useClienteAutoservicioStore();

  const { data: config } = useQuery({ queryKey: ['configuracion-publica'], queryFn: getConfiguracionPublica });
  const { data: menu, isLoading, isError, error } = useQuery({
    queryKey: ['autoservicio-menu', codigo],
    queryFn: () => getMenuAutoservicio(codigo),
    retry: false,
  });

  const promoPorProducto = useMemo(() => {
    const mapa = {};
    (menu?.promociones ?? []).forEach((p) => { mapa[p.producto_id] = p; });
    return mapa;
  }, [menu]);

  const precioConPromo = (producto) => {
    const base = parseFloat(producto.precio);
    const promo = promoPorProducto[producto.id];
    if (!promo) return base;
    const descuento = promo.tipo === 'porcentaje' ? base * (parseFloat(promo.valor) / 100) : parseFloat(promo.valor);
    return Math.max(0, base - descuento);
  };

  const categorias = useMemo(() => {
    const vistas = new Map();
    (menu?.productos ?? []).forEach((p) => { if (p.categoria) vistas.set(p.categoria.id, p.categoria); });
    return [...vistas.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [menu]);

  const productosFiltrados = useMemo(() => {
    const productos = menu?.productos ?? [];
    if (!categoriaActiva) return productos;
    return productos.filter((p) => p.categoria?.id === categoriaActiva);
  }, [menu, categoriaActiva]);

  const totalCarrito = useMemo(
    () => carrito.reduce((s, l) => s + (l.tipo === 'combo' ? parseFloat(l.combo.precio) : precioConPromo(l.producto) + l.extra) * l.cantidad, 0),
    [carrito, promoPorProducto]
  );

  // Un producto sin opciones es siempre una sola línea (sumar cantidad en
  // vez de apilar evita que "Charque x1" aparezca repetido en el carrito).
  // Con opciones, dos elecciones distintas del mismo producto (ej. "Grande"
  // vs "Chico") SÍ son líneas separadas — por eso acá se suma el total por
  // producto_id (para el contador en la grilla), no se pisa una con otra.
  const cantidadPorProducto = useMemo(() => {
    const map = {};
    carrito.forEach((l) => { if (l.tipo === 'producto') map[l.producto.id] = (map[l.producto.id] ?? 0) + l.cantidad; });
    return map;
  }, [carrito]);

  const cantidadPorCombo = useMemo(() => {
    const map = {};
    carrito.forEach((l) => { if (l.tipo === 'combo') map[l.combo.id] = (map[l.combo.id] ?? 0) + l.cantidad; });
    return map;
  }, [carrito]);

  // seleccion viene de SelectorOpcionModal: { nota, opcionIds, extra } — null
  // para un producto sin opciones. Dos líneas del mismo producto se
  // consideran la misma solo si eligieron exactamente lo mismo (mismo nota).
  const agregarAlCarrito = (producto, seleccion = null) => {
    const opcion_ids = seleccion?.opcionIds ?? [];
    const nota = seleccion?.nota ?? null;
    const extra = seleccion?.extra ?? 0;
    setCarrito((c) => {
      const idx = c.findIndex((l) => l.tipo === 'producto' && l.producto.id === producto.id && l.nota === nota);
      if (idx >= 0) {
        const copia = [...c];
        copia[idx] = { ...copia[idx], cantidad: copia[idx].cantidad + 1 };
        return copia;
      }
      return [...c, { tipo: 'producto', producto, opcion_ids, nota, extra, cantidad: 1 }];
    });
  };

  const handleAgregarProducto = (producto) => {
    if (producto.grupos_opciones?.length > 0) {
      setSelectorOpcion(producto);
      return;
    }
    agregarAlCarrito(producto);
  };

  const elegirOpcionProducto = (seleccion) => {
    agregarAlCarrito(selectorOpcion, seleccion);
    setSelectorOpcion(null);
  };

  const restarDelCarrito = (producto) => {
    setCarrito((c) => {
      const idx = c.findIndex((l) => l.tipo === 'producto' && l.producto.id === producto.id);
      if (idx < 0) return c;
      if (c[idx].cantidad <= 1) return c.filter((_, i) => i !== idx);
      const copia = [...c];
      copia[idx] = { ...copia[idx], cantidad: copia[idx].cantidad - 1 };
      return copia;
    });
  };

  // Para líneas de producto en el carrito (a diferencia de la grilla, acá
  // puede haber más de una línea del mismo producto_id con opciones
  // distintas) — se opera por índice, nunca por producto_id, para no tocar
  // la variante equivocada.
  const incrementarLinea = (idx) => {
    setCarrito((c) => c.map((l, i) => (i === idx ? { ...l, cantidad: l.cantidad + 1 } : l)));
  };

  const decrementarLinea = (idx) => {
    setCarrito((c) => {
      if (c[idx].cantidad <= 1) return c.filter((_, i) => i !== idx);
      return c.map((l, i) => (i === idx ? { ...l, cantidad: l.cantidad - 1 } : l));
    });
  };

  // Clave para distinguir variantes del mismo combo en el carrito (ej. combo
  // con "Papas: Grande" vs. mismo combo con "Papas: Chico") — mismo criterio
  // que agregarAlCarrito ya usa con `nota` para productos sueltos.
  const _claveOpcionesCombo = (opcionesPorProducto) => JSON.stringify(
    [...(opcionesPorProducto || [])]
      .map((o) => ({ producto_id: o.producto_id, opcion_ids: [...(o.opcion_ids || [])].sort((a, b) => a - b) }))
      .sort((a, b) => a.producto_id - b.producto_id)
  );

  const agregarComboAlCarrito = (combo, opcionesPorProducto = []) => {
    const clave = _claveOpcionesCombo(opcionesPorProducto);
    setCarrito((c) => {
      const idx = c.findIndex((l) => l.tipo === 'combo' && l.combo.id === combo.id && l.combo_opciones_key === clave);
      if (idx >= 0) {
        const copia = [...c];
        copia[idx] = { ...copia[idx], cantidad: copia[idx].cantidad + 1 };
        return copia;
      }
      return [...c, { tipo: 'combo', combo, cantidad: 1, opciones_por_producto: opcionesPorProducto, combo_opciones_key: clave }];
    });
  };

  const handleAgregarCombo = (combo) => {
    const productosConOpciones = (combo.productos || []).filter((p) => p.grupos_opciones?.length > 0);
    if (productosConOpciones.length === 0) {
      agregarComboAlCarrito(combo, []);
      return;
    }
    setColaOpcionesCombo({ combo, pendientes: productosConOpciones, resueltas: [] });
  };

  const elegirOpcionCombo = (seleccion) => {
    setColaOpcionesCombo((cola) => {
      const [actual, ...resto] = cola.pendientes;
      const resueltas = [...cola.resueltas, { producto_id: actual.id, opcion_ids: seleccion.opcionIds }];
      if (resto.length === 0) {
        agregarComboAlCarrito(cola.combo, resueltas);
        return null;
      }
      return { ...cola, pendientes: resto, resueltas };
    });
  };

  const comboContenido = (combo) => (combo.productos || []).map((p) => `${p.ComboProducto?.cantidad ?? 1}x ${p.nombre}`).join(', ');

  const itemsParaBackend = () => carrito.map(l => (
    l.tipo === 'combo'
      ? { combo_id: l.combo.id, cantidad: l.cantidad, opciones_por_producto: l.opciones_por_producto }
      : { producto_id: l.producto.id, cantidad: l.cantidad, opcion_ids: l.opcion_ids }
  ));

  const crear = useMutation({
    mutationFn: () => crearPedidoAutoservicio(codigo, itemsParaBackend(), cuponCodigo.trim(), ciCliente.trim(), puedeCanjear ? puntosACanjear : 0),
    onSuccess: (datos) => {
      setPedido(datos);
      queryClient.invalidateQueries({ queryKey: ['cliente-perfil'] });
    },
  });

  const validarCupon = useMutation({
    mutationFn: () => validarCuponAutoservicio(codigo, cuponCodigo.trim(), itemsParaBackend()),
    onSuccess: (datos) => setCuponAplicado(datos),
  });

  const onCambiarCuponCodigo = (valor) => {
    setCuponCodigo(valor);
    if (cuponAplicado) setCuponAplicado(null);
    if (validarCupon.isError) validarCupon.reset();
  };

  const totalConDescuento = Math.max(0, totalCarrito - (cuponAplicado?.descuento ?? 0));

  const puedeCanjear = token && config?.fidelidad_activa === 'true' && config?.fidelidad_canje_qr === 'true';
  const { data: perfil } = useQuery({
    queryKey: ['cliente-perfil'],
    queryFn: perfilCliente,
    enabled: !!token,
  });
  // No hay una vista previa del descuento en Bs acá: el valor de cada punto
  // (Configuracion.valor_punto_bs) no está expuesto en la config pública, y
  // el backend ya recalcula todo dentro de crearCompleta/iniciarPagoQr — el
  // cliente ve el monto final recién en la pantalla del QR de pago.

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  if (isError) {
    return (
      <div className="relative min-h-screen flex flex-col items-center justify-center gap-3 p-6 text-center">
        <ToggleTema />
        <AlertCircle className="w-10 h-10 text-muted-foreground" />
        <p className="text-foreground font-medium">
          {error?.response?.data?.mensaje ?? 'Esta mesa no está habilitada para pedir ahora.'}
        </p>
        <p className="text-sm text-muted-foreground">Llamá al mozo o cajero para que te ayude.</p>
      </div>
    );
  }

  if (pedido) {
    return <EsperaPago codigo={codigo} pedido={pedido} onNuevoPedido={() => { setPedido(null); setCarrito([]); setCuponCodigo(''); setCuponAplicado(null); setCiCliente(''); setPuntosACanjear(0); }} />;
  }

  const totalItems = carrito.reduce((s, l) => s + l.cantidad, 0);

  return (
    <div className="min-h-screen bg-background pb-28">
      <header className="flex items-center gap-3 p-4 border-b border-border bg-card/95 backdrop-blur sticky top-0 z-10">
        {config?.logo && <img src={logoSrc(config.logo)} alt="" className="w-11 h-11 rounded-xl object-contain shrink-0" />}
        <div className="flex-1 min-w-0">
          <p className="font-bold text-foreground truncate">{config?.nombre_negocio ?? 'Menú'}</p>
          <p className="text-xs text-muted-foreground">Mesa {menu.mesa.nombre}</p>
        </div>
        <button
          onClick={toggleModo}
          title={modo === 'dark' ? 'Modo claro' : 'Modo oscuro'}
          className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
        >
          {modo === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>
        <button
          onClick={() => setMostrarCuenta(true)}
          title="Mi cuenta"
          className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
        >
          <User className="w-5 h-5" />
        </button>
      </header>

      {categorias.length > 1 && (
        <div className="px-4 pt-4 pb-1">
          <div className="relative">
            <select
              value={categoriaActiva ?? ''}
              onChange={(e) => setCategoriaActiva(e.target.value ? Number(e.target.value) : null)}
              className="w-full appearance-none bg-card border border-input rounded-lg pl-3 pr-9 py-2 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Todas las categorías</option>
              {categorias.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.nombre}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          </div>
        </div>
      )}

      {menu.combos?.length > 0 && (
        <div className="relative">
          <div className="flex gap-2 overflow-x-auto px-4 pt-3 pb-1 scrollbar-hide">
            {menu.combos.map((combo) => {
              const cantidad = cantidadPorCombo[combo.id] ?? 0;
              return (
                <button
                  key={combo.id}
                  onClick={() => handleAgregarCombo(combo)}
                  className={`shrink-0 flex flex-col items-start gap-0.5 px-3.5 py-2.5 rounded-xl border transition-colors text-left ${cantidad ? 'border-primary bg-primary/10' : 'border-border bg-card hover:bg-accent'}`}
                >
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                    <Gift className="w-3.5 h-3.5 text-primary shrink-0" /> {combo.nombre}
                    {cantidad > 0 && <span className="text-xs font-bold text-primary">×{cantidad}</span>}
                  </span>
                  {combo.productos?.length > 0 && (
                    <span className="text-[11px] text-muted-foreground max-w-[220px] truncate">{comboContenido(combo)}</span>
                  )}
                  <span className="text-xs font-bold text-primary">{bs(combo.precio)}</span>
                </button>
              );
            })}
          </div>
          <div className="pointer-events-none absolute right-0 top-0 bottom-1 w-10 bg-gradient-to-l from-background to-transparent" />
        </div>
      )}

      <div className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
        {productosFiltrados.map((p) => {
          const cantidad = cantidadPorProducto[p.id] ?? 0;
          const promo = promoPorProducto[p.id];
          const tieneOpciones = p.grupos_opciones?.length > 0;
          return (
            <div
              key={p.id}
              className={`flex flex-col rounded-2xl border overflow-hidden bg-card transition-all ${cantidad ? 'border-primary shadow-sm' : 'border-border'}`}
            >
              <div className="w-full aspect-square bg-muted overflow-hidden">
                {p.imagen ? (
                  <img src={p.imagen} alt={p.nombre} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Package className="w-9 h-9 text-muted-foreground/60" />
                  </div>
                )}
              </div>
              <div className="p-3 flex flex-col gap-2 flex-1">
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground leading-tight line-clamp-2">{p.nombre}</p>
                  {promo ? (
                    <div className="flex items-center gap-1.5 mt-1">
                      <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{bs(precioConPromo(p))}</p>
                      <p className="text-xs text-muted-foreground line-through">{bs(p.precio)}</p>
                    </div>
                  ) : (
                    <p className="text-sm font-bold text-primary mt-1">{bs(p.precio)}{tieneOpciones ? ' desde' : ''}</p>
                  )}
                  {tieneOpciones && <p className="text-[11px] text-muted-foreground mt-0.5">Elegí opciones</p>}
                </div>

                {/* Con opciones, "+"/"-" en la grilla es ambiguo (¿a cuál
                    variante le suma?) — siempre abre el selector; el badge
                    muestra el total ya agregado y las cantidades por
                    variante se ajustan desde el carrito. */}
                {cantidad > 0 && !tieneOpciones ? (
                  <div className="flex items-center justify-between bg-primary/10 rounded-lg p-1">
                    <button
                      onClick={() => restarDelCarrito(p)}
                      className="w-7 h-7 rounded-md bg-card flex items-center justify-center text-foreground hover:bg-accent transition-colors"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="text-sm font-semibold text-foreground">{cantidad}</span>
                    <button
                      onClick={() => agregarAlCarrito(p)}
                      className="w-7 h-7 rounded-md bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => handleAgregarProducto(p)}
                    className="w-full py-1.5 rounded-lg bg-primary/10 text-primary text-sm font-semibold hover:bg-primary/20 transition-colors flex items-center justify-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" /> {cantidad > 0 ? `Agregar (${cantidad} en el pedido)` : 'Agregar'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {carrito.length > 0 && (
        <button
          onClick={() => setMostrarCarrito(true)}
          className="fixed bottom-4 left-4 right-4 flex items-center justify-between px-5 py-3.5 rounded-2xl bg-primary text-primary-foreground font-semibold shadow-lg shadow-primary/30 max-w-md mx-auto"
        >
          <span className="flex items-center gap-2"><ShoppingCart className="w-5 h-5" /> {totalItems} ítem{totalItems !== 1 ? 's' : ''}</span>
          <span>{bs(totalCarrito)}</span>
        </button>
      )}

      {mostrarCarrito && (
        <div className="fixed inset-0 z-20 flex items-end bg-black/50" onClick={() => setMostrarCarrito(false)}>
          <div className="w-full max-w-md mx-auto bg-card rounded-t-2xl p-4 space-y-3 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-foreground">Tu pedido</h2>
              <button onClick={() => setMostrarCarrito(false)}><X className="w-5 h-5 text-muted-foreground" /></button>
            </div>
            {carrito.map((l, idx) => {
              const esCombo = l.tipo === 'combo';
              const nombre = esCombo ? l.combo.nombre : l.producto.nombre;
              const imagen = esCombo ? null : l.producto.imagen;
              const precioUnitario = esCombo ? parseFloat(l.combo.precio) : precioConPromo(l.producto) + l.extra;
              // Un combo puede tener varias líneas (una por combinación de
              // opciones elegidas), igual que ya pasa con productos con
              // opciones — por eso acá se opera siempre por índice.
              const onSumar = () => incrementarLinea(idx);
              const onRestar = () => decrementarLinea(idx);
              return (
                <div key={esCombo ? `combo-${l.combo.id}-${l.combo_opciones_key ?? 'base'}` : `producto-${l.producto.id}-${l.nota ?? 'base'}`} className="flex items-center gap-3 text-sm">
                  <div className="w-11 h-11 rounded-lg bg-muted overflow-hidden shrink-0 flex items-center justify-center">
                    {imagen ? (
                      <img src={imagen} alt="" className="w-full h-full object-cover" />
                    ) : esCombo ? (
                      <Gift className="w-4 h-4 text-primary" />
                    ) : (
                      <Package className="w-4 h-4 text-muted-foreground/60" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-foreground truncate">{esCombo && <Gift className="w-3 h-3 inline mr-1 text-primary" />}{nombre}</p>
                    {l.nota && <p className="text-muted-foreground text-xs truncate">{l.nota}</p>}
                    <p className="text-muted-foreground text-xs">{bs(precioUnitario)} c/u</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={onRestar} className="w-6 h-6 rounded-md bg-muted flex items-center justify-center hover:bg-accent transition-colors">
                      <Minus className="w-3 h-3 text-foreground" />
                    </button>
                    <span className="w-4 text-center font-semibold text-foreground">{l.cantidad}</span>
                    <button onClick={onSumar} className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center hover:bg-primary/20 transition-colors">
                      <Plus className="w-3 h-3 text-primary" />
                    </button>
                  </div>
                  <span className="text-foreground font-medium w-16 text-right">{bs(precioUnitario * l.cantidad)}</span>
                </div>
              );
            })}
            <div className="pt-2 border-t border-border space-y-1">
              {cuponAplicado && (
                <div className="flex items-center justify-between text-sm text-emerald-600 dark:text-emerald-400">
                  <span>Cupón {cuponAplicado.codigo}</span><span>-{bs(cuponAplicado.descuento)}</span>
                </div>
              )}
              <div className="flex items-center justify-between font-bold text-foreground">
                <span>Total</span><span>{bs(totalConDescuento)}</span>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">¿Tenés un cupón?</label>
              <div className="flex gap-2">
                <input
                  value={cuponCodigo}
                  onChange={(e) => onCambiarCuponCodigo(e.target.value)}
                  placeholder="Código (opcional)"
                  className="flex-1 min-w-0 bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  onClick={() => validarCupon.mutate()}
                  disabled={!cuponCodigo.trim() || validarCupon.isPending || !!cuponAplicado}
                  className="px-4 rounded-lg bg-secondary text-secondary-foreground text-sm font-semibold disabled:opacity-60 shrink-0"
                >
                  {validarCupon.isPending ? '...' : cuponAplicado ? 'Aplicado' : 'Aplicar'}
                </button>
              </div>
              {validarCupon.isError && (
                <p className="text-sm text-destructive mt-1">{validarCupon.error?.response?.data?.mensaje ?? 'Cupón inválido.'}</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">¿Tenés CI registrado? (opcional, para sumar puntos)</label>
              <input
                value={ciCliente}
                onChange={(e) => setCiCliente(e.target.value)}
                placeholder="Número de CI"
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            {puedeCanjear && perfil?.puntos > 0 && (
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Usar puntos ({perfil.puntos} disponibles)
                </label>
                <input
                  type="number"
                  min={0}
                  max={perfil.puntos}
                  value={puntosACanjear}
                  onChange={(e) => setPuntosACanjear(Math.max(0, Math.min(perfil.puntos, parseInt(e.target.value, 10) || 0)))}
                  placeholder="0"
                  className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            )}
            {crear.isError && (
              <p className="text-sm text-destructive">{crear.error?.response?.data?.mensaje ?? 'No se pudo crear el pedido.'}</p>
            )}
            <button
              onClick={() => crear.mutate()}
              disabled={crear.isPending}
              className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-60"
            >
              {crear.isPending ? 'Enviando...' : 'Pagar con QR'}
            </button>
          </div>
        </div>
      )}

      {mostrarCuenta && (
        <CuentaSheet onClose={() => setMostrarCuenta(false)} />
      )}

      {selectorOpcion && (
        <SelectorOpcionModal
          producto={selectorOpcion}
          onElegir={elegirOpcionProducto}
          onClose={() => setSelectorOpcion(null)}
        />
      )}

      {colaOpcionesCombo && (
        <SelectorOpcionModal
          key={colaOpcionesCombo.pendientes[0]?.id}
          producto={colaOpcionesCombo.pendientes[0]}
          subtitulo={`Combo: ${colaOpcionesCombo.combo.nombre} — Producto ${colaOpcionesCombo.resueltas.length + 1} de ${colaOpcionesCombo.pendientes.length + colaOpcionesCombo.resueltas.length}`}
          onElegir={elegirOpcionCombo}
          onClose={() => setColaOpcionesCombo(null)}
        />
      )}
    </div>
  );
}

function ToggleTema() {
  const { modo, toggleModo } = useTemaAutoservicio();
  return (
    <button
      onClick={toggleModo}
      title={modo === 'dark' ? 'Modo claro' : 'Modo oscuro'}
      className="absolute top-4 right-4 p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
    >
      {modo === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
    </button>
  );
}

function CuentaSheet({ onClose }) {
  const { token, setToken, logout } = useClienteAutoservicioStore();
  const queryClient = useQueryClient();
  const [vista, setVista] = useState('inicio'); // inicio | ingresar-pin | crear-pin | codigo | historial | cambiar-pin | recuperar-codigo
  const [numeroDocumento, setNumeroDocumento] = useState('');
  const [pin, setPin] = useState('');
  const [email, setEmail] = useState('');
  const [codigo, setCodigo] = useState('');
  const [pinNuevo, setPinNuevo] = useState('');
  const [pinActual, setPinActual] = useState('');
  const [emailParcial, setEmailParcial] = useState('');
  const [pedidoAbierto, setPedidoAbierto] = useState(null);
  const [error, setError] = useState('');

  const { data: perfil } = useQuery({ queryKey: ['cliente-perfil'], queryFn: perfilCliente, enabled: !!token });
  const { data: historial = [] } = useQuery({ queryKey: ['cliente-historial'], queryFn: historialCliente, enabled: !!token && vista === 'historial' });

  // Purga el caché de react-query de la sesión anterior antes de guardar el
  // token nuevo: 'cliente-perfil'/'cliente-historial' son claves globales,
  // no por cliente, así que sin esto el próximo render podría mostrar por un
  // instante el nombre/puntos/historial del cliente que tenía la sesión
  // previa en este mismo dispositivo compartido, antes de que el refetch
  // resuelva.
  const limpiarCacheCliente = () => {
    queryClient.removeQueries({ queryKey: ['cliente-perfil'] });
    queryClient.removeQueries({ queryKey: ['cliente-historial'] });
  };

  const consultarEstado = useMutation({
    mutationFn: () => estadoCliente(numeroDocumento.trim()),
    onSuccess: (datos) => { setError(''); setVista(datos.tiene_pin ? 'ingresar-pin' : 'crear-pin'); },
    onError: (e) => setError(e?.response?.data?.mensaje ?? 'No se pudo verificar ese CI'),
  });

  const login = useMutation({
    mutationFn: () => verificarPinCliente(numeroDocumento.trim(), pin.trim()),
    onSuccess: (datos) => { limpiarCacheCliente(); setToken(datos.token); setError(''); setVista('inicio'); },
    onError: (e) => setError(e?.response?.data?.mensaje ?? 'PIN incorrecto'),
  });

  const solicitar = useMutation({
    mutationFn: () => solicitarPinCliente(numeroDocumento.trim(), pin.trim(), email.trim()),
    onSuccess: () => { setError(''); setVista('codigo'); },
    onError: (e) => setError(e?.response?.data?.mensaje ?? 'No se pudo enviar el código'),
  });

  const confirmar = useMutation({
    mutationFn: () => confirmarPinCliente(numeroDocumento.trim(), codigo.trim()),
    onSuccess: (datos) => { limpiarCacheCliente(); setToken(datos.token); setError(''); setVista('inicio'); },
    onError: (e) => setError(e?.response?.data?.mensaje ?? 'Código incorrecto'),
  });

  const cambiar = useMutation({
    mutationFn: () => cambiarPinCliente(pinActual.trim(), pinNuevo.trim()),
    onSuccess: () => { setError(''); setPinActual(''); setPinNuevo(''); setVista('inicio'); },
    onError: (e) => setError(e?.response?.data?.mensaje ?? 'No se pudo cambiar el PIN'),
  });

  const recuperarSolicitar = useMutation({
    mutationFn: () => recuperarPinSolicitarCliente(numeroDocumento.trim()),
    onSuccess: (datos) => { setError(''); setEmailParcial(datos.email_parcial); setVista('recuperar-codigo'); },
    onError: (e) => setError(e?.response?.data?.mensaje ?? 'No se pudo enviar el código'),
  });

  const recuperarConfirmar = useMutation({
    mutationFn: () => recuperarPinConfirmarCliente(numeroDocumento.trim(), codigo.trim(), pinNuevo.trim()),
    onSuccess: (datos) => {
      limpiarCacheCliente(); setToken(datos.token); setError('');
      setCodigo(''); setPinNuevo(''); setVista('inicio');
    },
    onError: (e) => setError(e?.response?.data?.mensaje ?? 'Código incorrecto'),
  });

  const inputCls = 'w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring';
  const botonCls = 'w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-60';

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/50" onClick={onClose}>
      <div className="w-full max-w-md mx-auto bg-card rounded-t-2xl p-4 space-y-3 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-foreground flex items-center gap-2"><User className="w-4 h-4" /> Mi cuenta</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-muted-foreground" /></button>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {token && vista === 'inicio' && (
          <div className="space-y-3">
            <div className="rounded-xl bg-primary/10 p-3">
              <p className="font-semibold text-foreground">{perfil?.nombre}</p>
              <p className="text-sm text-primary flex items-center gap-1 mt-0.5"><Star className="w-3.5 h-3.5" /> {perfil?.puntos ?? 0} puntos</p>
            </div>
            <button onClick={() => setVista('historial')} className="w-full flex items-center gap-2 py-2.5 px-3 rounded-lg hover:bg-accent transition-colors text-sm text-foreground">
              <History className="w-4 h-4" /> Ver historial de pedidos
            </button>
            <button onClick={() => setVista('cambiar-pin')} className="w-full flex items-center gap-2 py-2.5 px-3 rounded-lg hover:bg-accent transition-colors text-sm text-foreground">
              <KeyRound className="w-4 h-4" /> Cambiar PIN
            </button>
            <button onClick={() => { limpiarCacheCliente(); logout(); onClose(); }} className="w-full flex items-center gap-2 py-2.5 px-3 rounded-lg hover:bg-accent transition-colors text-sm text-destructive">
              <LogOut className="w-4 h-4" /> Cerrar sesión
            </button>
          </div>
        )}

        {!token && vista === 'inicio' && (
          <div className="space-y-3">
            <label className="block text-xs font-medium text-muted-foreground">Tu número de CI</label>
            <input value={numeroDocumento} onChange={(e) => setNumeroDocumento(e.target.value)} placeholder="Número de CI" className={inputCls} />
            <button onClick={() => consultarEstado.mutate()} disabled={!numeroDocumento.trim() || consultarEstado.isPending} className={botonCls}>
              {consultarEstado.isPending ? 'Verificando...' : 'Continuar'}
            </button>
          </div>
        )}

        {vista === 'ingresar-pin' && (
          <div className="space-y-3">
            <label className="block text-xs font-medium text-muted-foreground">Ingresá tu PIN</label>
            <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="••••" maxLength={4} className={inputCls} />
            <button onClick={() => login.mutate()} disabled={pin.trim().length !== 4 || login.isPending} className={botonCls}>
              {login.isPending ? 'Ingresando...' : 'Ingresar'}
            </button>
            <button
              onClick={() => { setError(''); recuperarSolicitar.mutate(); }}
              disabled={recuperarSolicitar.isPending}
              className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-60"
            >
              {recuperarSolicitar.isPending ? 'Enviando código...' : '¿Olvidaste tu PIN?'}
            </button>
          </div>
        )}

        {vista === 'crear-pin' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Todavía no tenés un PIN. Creá uno para poder canjear puntos y ver tu historial.</p>
            <label className="block text-xs font-medium text-muted-foreground">Elegí un PIN de 4 dígitos</label>
            <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="••••" maxLength={4} className={inputCls} />
            <label className="block text-xs font-medium text-muted-foreground">Tu email (para confirmar)</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo@ejemplo.com" className={inputCls} />
            <button onClick={() => solicitar.mutate()} disabled={pin.trim().length !== 4 || !email.trim() || solicitar.isPending} className={botonCls}>
              {solicitar.isPending ? 'Enviando...' : 'Crear PIN'}
            </button>
          </div>
        )}

        {vista === 'codigo' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Te mandamos un código a tu email. Ingresalo acá (vence en 10 minutos):</p>
            <input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Código de 6 dígitos" maxLength={6} className={inputCls} />
            <button onClick={() => confirmar.mutate()} disabled={codigo.trim().length !== 6 || confirmar.isPending} className={botonCls}>
              {confirmar.isPending ? 'Confirmando...' : 'Confirmar'}
            </button>
          </div>
        )}

        {vista === 'recuperar-codigo' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Te mandamos un código a {emailParcial || 'tu email registrado'}. Ingresalo y elegí un PIN nuevo (vence en 10 minutos):</p>
            <label className="block text-xs font-medium text-muted-foreground">Código de 6 dígitos</label>
            <input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Código de 6 dígitos" maxLength={6} className={inputCls} />
            <label className="block text-xs font-medium text-muted-foreground">PIN nuevo</label>
            <input type="password" inputMode="numeric" value={pinNuevo} onChange={(e) => setPinNuevo(e.target.value)} placeholder="••••" maxLength={4} className={inputCls} />
            <button
              onClick={() => recuperarConfirmar.mutate()}
              disabled={codigo.trim().length !== 6 || pinNuevo.trim().length !== 4 || recuperarConfirmar.isPending}
              className={botonCls}
            >
              {recuperarConfirmar.isPending ? 'Confirmando...' : 'Confirmar y entrar'}
            </button>
          </div>
        )}

        {vista === 'cambiar-pin' && (
          <div className="space-y-3">
            <label className="block text-xs font-medium text-muted-foreground">PIN actual</label>
            <input type="password" inputMode="numeric" value={pinActual} onChange={(e) => setPinActual(e.target.value)} placeholder="••••" maxLength={4} className={inputCls} />
            <label className="block text-xs font-medium text-muted-foreground">PIN nuevo</label>
            <input type="password" inputMode="numeric" value={pinNuevo} onChange={(e) => setPinNuevo(e.target.value)} placeholder="••••" maxLength={4} className={inputCls} />
            <button onClick={() => cambiar.mutate()} disabled={pinActual.trim().length !== 4 || pinNuevo.trim().length !== 4 || cambiar.isPending} className={botonCls}>
              {cambiar.isPending ? 'Guardando...' : 'Cambiar PIN'}
            </button>
          </div>
        )}

        {vista === 'historial' && (
          <div className="space-y-2">
            {historial.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Todavía no tenés pedidos.</p>
            ) : (
              historial.map((p) => {
                const abierto = pedidoAbierto === p.id;
                return (
                  <div key={p.id} className="border-b border-border pb-2">
                    <button
                      onClick={() => setPedidoAbierto(abierto ? null : p.id)}
                      className="w-full flex items-center justify-between text-sm text-left"
                    >
                      <div>
                        <p className="text-foreground">{new Date(p.creado_en).toLocaleDateString('es-BO')}</p>
                        <p className="text-xs text-muted-foreground">{p.mesa?.nombre ?? p.tipo}</p>
                      </div>
                      <span className="font-medium text-foreground">{bs(p.total)}</span>
                    </button>
                    {abierto && (
                      <div className="mt-2 space-y-1 pl-1">
                        {(p.detalles ?? []).map((d) => (
                          <div key={d.id} className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>{d.cantidad}x {d.producto?.nombre ?? d.combo?.nombre ?? 'Ítem'}</span>
                            <span>{bs(d.precio * d.cantidad)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function EsperaPago({ codigo, pedido, onNuevoPedido }) {
  const { data: estado, isError, refetch } = useQuery({
    queryKey: ['autoservicio-estado', pedido.pedido.id],
    queryFn: () => getEstadoPedidoAutoservicio(codigo, pedido.pedido.id),
    refetchInterval: (query) => (query.state.data?.estado === 'pendiente' ? 3000 : false),
  });

  const estadoActual = estado?.estado ?? 'pendiente';

  // Sin esta rama, si las consultas de estado fallan (corte de red, backend
  // reiniciando, sesión de mesa cerrada) `data` queda undefined para siempre,
  // refetchInterval evalúa `undefined?.estado === 'pendiente'` como false y
  // nunca se vuelve a armar: la pantalla se queda con el spinner "Esperando
  // confirmación..." aunque el pago ya se haya confirmado del lado del server.
  //
  // `!estado` evita que esta rama gane después de un `completado` ya
  // confirmado: una vez pagada la sesión de mesa se cierra, así que un
  // refetch posterior (ej. el cliente vuelve a la app tras >30s) devuelve
  // 409 aunque el pago ya se haya acreditado — sin este guard, el cliente
  // vería "no pudimos confirmar" justo después de ver "¡Pago confirmado!".
  if (isError && !estado) {
    return (
      <div className="relative min-h-screen flex flex-col items-center justify-center gap-3 p-6 text-center">
        <ToggleTema />
        <AlertCircle className="w-14 h-14 text-muted-foreground" />
        <p className="text-lg font-bold text-foreground">No pudimos confirmar el estado de tu pedido</p>
        <p className="text-sm text-muted-foreground">Revisá tu conexión y volvé a intentar.</p>
        <button onClick={() => refetch()} className="mt-4 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-medium">
          Reintentar
        </button>
      </div>
    );
  }

  if (estadoActual === 'completado') {
    return (
      <div className="relative min-h-screen flex flex-col items-center justify-center gap-3 p-6 text-center">
        <ToggleTema />
        <CheckCircle2 className="w-14 h-14 text-emerald-500" />
        <p className="text-lg font-bold text-foreground">¡Pago confirmado!</p>
        <p className="text-sm text-muted-foreground">Tu pedido ya está en cocina.</p>
        <button onClick={onNuevoPedido} className="mt-4 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-medium">
          Pedir algo más
        </button>
      </div>
    );
  }

  if (estadoActual === 'expirado' || estadoActual === 'fallido' || estadoActual === 'cancelado') {
    return (
      <div className="relative min-h-screen flex flex-col items-center justify-center gap-3 p-6 text-center">
        <ToggleTema />
        <AlertCircle className="w-14 h-14 text-destructive" />
        <p className="text-lg font-bold text-foreground">El pago no se completó</p>
        <button onClick={onNuevoPedido} className="mt-4 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-medium">
          Volver a intentar
        </button>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
      <ToggleTema />
      <p className="text-lg font-bold text-foreground">Escaneá el QR con tu app del banco</p>
      {pedido.pago_qr?.qr_code && (
        <img src={pedido.pago_qr.qr_code} alt="QR de pago" className="w-56 h-56 rounded-xl border border-border" />
      )}
      <p className="text-2xl font-bold text-foreground">{bs(pedido.pago_qr?.monto_total)}</p>
      <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Esperando confirmación...</p>
    </div>
  );
}
