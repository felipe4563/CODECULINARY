import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Plus, Minus, ShoppingCart, X, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { getMenuAutoservicio, crearPedidoAutoservicio, getEstadoPedidoAutoservicio } from '../../api/autoservicio';
import { getConfiguracionPublica, logoSrc } from '../../api/configuracion';

const bs = (n) => `Bs ${parseFloat(n || 0).toFixed(2)}`;

export default function AutoservicioPage() {
  const { codigo } = useParams();
  const [carrito, setCarrito] = useState([]); // [{ producto, opcion_ids, cantidad }]
  const [mostrarCarrito, setMostrarCarrito] = useState(false);
  const [pedido, setPedido] = useState(null); // { pedido, pago_qr } luego de confirmar

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

  const agregarAlCarrito = (producto) => {
    setCarrito((c) => [...c, { producto, opcion_ids: [], cantidad: 1 }]);
  };

  const quitarDelCarrito = (idx) => setCarrito((c) => c.filter((_, i) => i !== idx));

  const crear = useMutation({
    mutationFn: () => crearPedidoAutoservicio(codigo, carrito.map(l => ({
      producto_id: l.producto.id, cantidad: l.cantidad, opcion_ids: l.opcion_ids,
    }))),
    onSuccess: (datos) => setPedido(datos),
  });

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  if (isError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertCircle className="w-10 h-10 text-muted-foreground" />
        <p className="text-foreground font-medium">
          {error?.response?.data?.mensaje ?? 'Esta mesa no está habilitada para pedir ahora.'}
        </p>
        <p className="text-sm text-muted-foreground">Llamá al mozo o cajero para que te ayude.</p>
      </div>
    );
  }

  if (pedido) {
    return <EsperaPago codigo={codigo} pedido={pedido} onNuevoPedido={() => { setPedido(null); setCarrito([]); }} />;
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="flex items-center gap-3 p-4 border-b border-border bg-card sticky top-0 z-10">
        {config?.logo && <img src={logoSrc(config.logo)} alt="" className="w-10 h-10 rounded-lg object-contain" />}
        <div>
          <p className="font-bold text-foreground">{config?.nombre_negocio ?? 'Menú'}</p>
          <p className="text-xs text-muted-foreground">{menu.mesa.nombre}</p>
        </div>
      </header>

      <div className="p-4 space-y-3">
        {menu.productos.map((p) => (
          <div key={p.id} className="bg-card border border-border rounded-xl p-3.5 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="font-medium text-foreground truncate">{p.nombre}</p>
              <p className="text-sm text-muted-foreground">{bs(p.precio)}</p>
            </div>
            <button
              onClick={() => agregarAlCarrito(p)}
              className="p-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      {carrito.length > 0 && (
        <button
          onClick={() => setMostrarCarrito(true)}
          className="fixed bottom-4 left-4 right-4 flex items-center justify-between px-5 py-3.5 rounded-xl bg-primary text-primary-foreground font-semibold shadow-lg"
        >
          <span className="flex items-center gap-2"><ShoppingCart className="w-5 h-5" /> {carrito.length} ítem{carrito.length !== 1 ? 's' : ''}</span>
          <span>{bs(totalCarrito)}</span>
        </button>
      )}

      {mostrarCarrito && (
        <div className="fixed inset-0 z-20 flex items-end bg-black/50">
          <div className="w-full bg-card rounded-t-2xl p-4 space-y-3 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-foreground">Tu pedido</h2>
              <button onClick={() => setMostrarCarrito(false)}><X className="w-5 h-5 text-muted-foreground" /></button>
            </div>
            {carrito.map((l, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-foreground">{l.producto.nombre} x{l.cantidad}</span>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">{bs(l.producto.precio * l.cantidad)}</span>
                  <button onClick={() => quitarDelCarrito(i)}><Minus className="w-4 h-4 text-destructive" /></button>
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between font-bold text-foreground pt-2 border-t border-border">
              <span>Total</span><span>{bs(totalCarrito)}</span>
            </div>
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
  if (isError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-6 text-center">
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
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-6 text-center">
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
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertCircle className="w-14 h-14 text-destructive" />
        <p className="text-lg font-bold text-foreground">El pago no se completó</p>
        <button onClick={onNuevoPedido} className="mt-4 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-medium">
          Volver a intentar
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-lg font-bold text-foreground">Escaneá el QR con tu app del banco</p>
      {pedido.pago_qr?.qr_code && (
        <img src={pedido.pago_qr.qr_code} alt="QR de pago" className="w-56 h-56 rounded-xl border border-border" />
      )}
      <p className="text-2xl font-bold text-foreground">{bs(pedido.pago_qr?.monto_total)}</p>
      <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Esperando confirmación...</p>
    </div>
  );
}
