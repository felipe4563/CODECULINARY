import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Plus, Minus, ShoppingCart, X, Loader2, CheckCircle2, AlertCircle, Package, Sun, Moon, User, Star, History, LogOut, KeyRound } from 'lucide-react';
import {
  getMenuAutoservicio, crearPedidoAutoservicio, validarCuponAutoservicio, getEstadoPedidoAutoservicio,
} from '../../api/autoservicio';
import { getConfiguracionPublica, logoSrc } from '../../api/configuracion';
import {
  estadoCliente, solicitarPinCliente, confirmarPinCliente, verificarPinCliente,
  cambiarPinCliente, perfilCliente, historialCliente,
} from '../../api/clientePublico';
import { useClienteAutoservicioStore } from '../../store/clienteAutoservicioStore';
import { useTemaAutoservicio } from '../../hooks/useTemaAutoservicio';

const bs = (n) => `Bs ${parseFloat(n || 0).toFixed(2)}`;

export default function AutoservicioPage() {
  const { codigo } = useParams();
  const [carrito, setCarrito] = useState([]); // [{ producto, opcion_ids, cantidad }]
  const [mostrarCarrito, setMostrarCarrito] = useState(false);
  const [pedido, setPedido] = useState(null); // { pedido, pago_qr } luego de confirmar
  const [cuponCodigo, setCuponCodigo] = useState('');
  const [cuponAplicado, setCuponAplicado] = useState(null); // { codigo, descuento } tras validar OK
  const [ciCliente, setCiCliente] = useState('');
  const { modo, toggleModo } = useTemaAutoservicio();
  const [mostrarCuenta, setMostrarCuenta] = useState(false);
  const [puntosACanjear, setPuntosACanjear] = useState(0);
  const { token } = useClienteAutoservicioStore();

  const { data: config } = useQuery({ queryKey: ['configuracion-publica'], queryFn: getConfiguracionPublica });
  const { data: menu, isLoading, isError, error } = useQuery({
    queryKey: ['autoservicio-menu', codigo],
    queryFn: () => getMenuAutoservicio(codigo),
    retry: false,
  });

  const totalCarrito = useMemo(
    () => carrito.reduce((s, l) => s + l.producto.precio * l.cantidad, 0),
    [carrito]
  );

  // Sin variantes/opciones en esta pantalla todavía, cada producto es una
  // sola línea — sumar cantidad en vez de apilar líneas repetidas evita que
  // "Charque x1" aparezca 3 veces seguidas en el carrito.
  const cantidadPorProducto = useMemo(() => {
    const map = {};
    carrito.forEach((l) => { map[l.producto.id] = l.cantidad; });
    return map;
  }, [carrito]);

  const agregarAlCarrito = (producto) => {
    setCarrito((c) => {
      const idx = c.findIndex((l) => l.producto.id === producto.id);
      if (idx >= 0) {
        const copia = [...c];
        copia[idx] = { ...copia[idx], cantidad: copia[idx].cantidad + 1 };
        return copia;
      }
      return [...c, { producto, opcion_ids: [], cantidad: 1 }];
    });
  };

  const restarDelCarrito = (producto) => {
    setCarrito((c) => {
      const idx = c.findIndex((l) => l.producto.id === producto.id);
      if (idx < 0) return c;
      if (c[idx].cantidad <= 1) return c.filter((_, i) => i !== idx);
      const copia = [...c];
      copia[idx] = { ...copia[idx], cantidad: copia[idx].cantidad - 1 };
      return copia;
    });
  };

  const itemsParaBackend = () => carrito.map(l => ({
    producto_id: l.producto.id, cantidad: l.cantidad, opcion_ids: l.opcion_ids,
  }));

  const crear = useMutation({
    mutationFn: () => crearPedidoAutoservicio(codigo, itemsParaBackend(), cuponCodigo.trim(), ciCliente.trim(), puedeCanjear ? puntosACanjear : 0),
    onSuccess: (datos) => setPedido(datos),
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
    return <EsperaPago codigo={codigo} pedido={pedido} onNuevoPedido={() => { setPedido(null); setCarrito([]); setCuponCodigo(''); setCuponAplicado(null); setCiCliente(''); }} />;
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

      <div className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
        {menu.productos.map((p) => {
          const cantidad = cantidadPorProducto[p.id] ?? 0;
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
                  <p className="text-sm font-bold text-primary mt-1">{bs(p.precio)}</p>
                </div>

                {cantidad > 0 ? (
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
                    onClick={() => agregarAlCarrito(p)}
                    className="w-full py-1.5 rounded-lg bg-primary/10 text-primary text-sm font-semibold hover:bg-primary/20 transition-colors flex items-center justify-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" /> Agregar
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
            {carrito.map((l) => (
              <div key={l.producto.id} className="flex items-center gap-3 text-sm">
                <div className="w-11 h-11 rounded-lg bg-muted overflow-hidden shrink-0">
                  {l.producto.imagen ? (
                    <img src={l.producto.imagen} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center"><Package className="w-4 h-4 text-muted-foreground/60" /></div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-foreground truncate">{l.producto.nombre}</p>
                  <p className="text-muted-foreground text-xs">{bs(l.producto.precio)} c/u</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => restarDelCarrito(l.producto)} className="w-6 h-6 rounded-md bg-muted flex items-center justify-center hover:bg-accent transition-colors">
                    <Minus className="w-3 h-3 text-foreground" />
                  </button>
                  <span className="w-4 text-center font-semibold text-foreground">{l.cantidad}</span>
                  <button onClick={() => agregarAlCarrito(l.producto)} className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center hover:bg-primary/20 transition-colors">
                    <Plus className="w-3 h-3 text-primary" />
                  </button>
                </div>
                <span className="text-foreground font-medium w-16 text-right">{bs(l.producto.precio * l.cantidad)}</span>
              </div>
            ))}
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
  const [vista, setVista] = useState('inicio'); // inicio | pin | codigo | historial | cambiar-pin
  const [numeroDocumento, setNumeroDocumento] = useState('');
  const [pin, setPin] = useState('');
  const [email, setEmail] = useState('');
  const [codigo, setCodigo] = useState('');
  const [pinNuevo, setPinNuevo] = useState('');
  const [pinActual, setPinActual] = useState('');
  const [error, setError] = useState('');

  const { data: perfil } = useQuery({ queryKey: ['cliente-perfil'], queryFn: perfilCliente, enabled: !!token });
  const { data: historial = [] } = useQuery({ queryKey: ['cliente-historial'], queryFn: historialCliente, enabled: !!token && vista === 'historial' });

  const consultarEstado = useMutation({
    mutationFn: () => estadoCliente(numeroDocumento.trim()),
    onSuccess: (datos) => { setError(''); setVista(datos.tiene_pin ? 'ingresar-pin' : 'crear-pin'); },
    onError: (e) => setError(e?.response?.data?.mensaje ?? 'No se pudo verificar ese CI'),
  });

  const login = useMutation({
    mutationFn: () => verificarPinCliente(numeroDocumento.trim(), pin.trim()),
    onSuccess: (datos) => { setToken(datos.token); setError(''); setVista('inicio'); },
    onError: (e) => setError(e?.response?.data?.mensaje ?? 'PIN incorrecto'),
  });

  const solicitar = useMutation({
    mutationFn: () => solicitarPinCliente(numeroDocumento.trim(), pin.trim(), email.trim()),
    onSuccess: () => { setError(''); setVista('codigo'); },
    onError: (e) => setError(e?.response?.data?.mensaje ?? 'No se pudo enviar el código'),
  });

  const confirmar = useMutation({
    mutationFn: () => confirmarPinCliente(numeroDocumento.trim(), codigo.trim()),
    onSuccess: (datos) => { setToken(datos.token); setError(''); setVista('inicio'); },
    onError: (e) => setError(e?.response?.data?.mensaje ?? 'Código incorrecto'),
  });

  const cambiar = useMutation({
    mutationFn: () => cambiarPinCliente(pinActual.trim(), pinNuevo.trim()),
    onSuccess: () => { setError(''); setPinActual(''); setPinNuevo(''); setVista('inicio'); },
    onError: (e) => setError(e?.response?.data?.mensaje ?? 'No se pudo cambiar el PIN'),
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
            <button onClick={() => { logout(); onClose(); }} className="w-full flex items-center gap-2 py-2.5 px-3 rounded-lg hover:bg-accent transition-colors text-sm text-destructive">
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
            <input value={pin} onChange={(e) => setPin(e.target.value)} placeholder="••••" maxLength={4} className={inputCls} />
            <button onClick={() => login.mutate()} disabled={pin.trim().length !== 4 || login.isPending} className={botonCls}>
              {login.isPending ? 'Ingresando...' : 'Ingresar'}
            </button>
          </div>
        )}

        {vista === 'crear-pin' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Todavía no tenés un PIN. Creá uno para poder canjear puntos y ver tu historial.</p>
            <label className="block text-xs font-medium text-muted-foreground">Elegí un PIN de 4 dígitos</label>
            <input value={pin} onChange={(e) => setPin(e.target.value)} placeholder="••••" maxLength={4} className={inputCls} />
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

        {vista === 'cambiar-pin' && (
          <div className="space-y-3">
            <label className="block text-xs font-medium text-muted-foreground">PIN actual</label>
            <input value={pinActual} onChange={(e) => setPinActual(e.target.value)} placeholder="••••" maxLength={4} className={inputCls} />
            <label className="block text-xs font-medium text-muted-foreground">PIN nuevo</label>
            <input value={pinNuevo} onChange={(e) => setPinNuevo(e.target.value)} placeholder="••••" maxLength={4} className={inputCls} />
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
              historial.map((p) => (
                <div key={p.id} className="flex items-center justify-between text-sm border-b border-border pb-2">
                  <div>
                    <p className="text-foreground">{new Date(p.creado_en).toLocaleDateString('es-BO')}</p>
                    <p className="text-xs text-muted-foreground">{p.mesa?.nombre ?? p.tipo}</p>
                  </div>
                  <span className="font-medium text-foreground">{bs(p.total)}</span>
                </div>
              ))
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
