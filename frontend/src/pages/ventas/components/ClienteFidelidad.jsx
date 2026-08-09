import { useState, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, X, Star, UserPlus, AlertTriangle, Loader2 } from 'lucide-react';
import { getClientes, crearCliente, buscarClientePorDocumento, buscarClientesPorNombre } from '../../../api/clientes';
import { getConfiguracion } from '../../../api/configuracion';

// Mini-formulario para dar de alta un cliente sin salir del cobro. Solo pide
// lo esencial: nombre (obligatorio), documento (evita duplicados a futuro) y
// fecha de nacimiento (la usa el sistema de cumpleaños, independiente de si
// fidelidad está activa). El resto de los datos del cliente se completa
// después, si hace falta, desde la página Clientes.
//
// El autocompletado por CI/nombre contra la API de Personas es el mismo que
// usa ModalCliente en ClientesPage.jsx (mismo debounce, mismos endpoints) —
// acá va la versión compacta, sin el buscador por código interno (caso
// borde, no vale la pena en un formulario pensado para ser rápido en caja).
function FormNuevoCliente({ onCancelar, onCreado }) {
  const [nombre, setNombre] = useState('');
  const [documento, setDocumento] = useState('');
  const [fechaNacimiento, setFechaNacimiento] = useState('');
  const [avisoBusqueda, setAvisoBusqueda] = useState('');
  const [busquedaNombre, setBusquedaNombre] = useState('');
  const [buscandoNombre, setBuscandoNombre] = useState(false);
  const [mostrarBusquedaNombre, setMostrarBusquedaNombre] = useState(false);
  const [error, setError] = useState('');

  const mutCrear = useMutation({
    mutationFn: crearCliente,
    onSuccess: (cliente) => onCreado(cliente),
    onError: (err) => setError(err?.response?.data?.mensaje ?? 'Error al crear el cliente'),
  });

  // Autocompletar por CI contra la API de Personas — busca automáticamente
  // apenas hay suficientes dígitos, sin botón (igual que en ClientesPage).
  const buscarPorCi = useMutation({
    mutationFn: (numero) => buscarClientePorDocumento(numero),
    onSuccess: (datos, numero) => {
      if (!datos) { setAvisoBusqueda('No se encontró ninguna persona con ese número de documento.'); return; }
      setAvisoBusqueda('');
      setNombre(n => datos.nombre || n);
      setDocumento(datos.numero_documento || numero);
      setFechaNacimiento(f => datos.fecha_nacimiento || f);
    },
    onError: (err) => setAvisoBusqueda(err?.response?.data?.mensaje ?? 'No se pudo consultar la API de personas'),
  });

  const documentoQuery = documento.trim();
  const documentoListo = documentoQuery.length >= 5;
  const yaBuscadoRef = useRef('');
  const mutarBuscarCi = buscarPorCi.mutate;

  useEffect(() => {
    if (!documentoListo || yaBuscadoRef.current === documentoQuery) return;
    const id = setTimeout(() => {
      yaBuscadoRef.current = documentoQuery;
      mutarBuscarCi(documentoQuery);
    }, 400);
    return () => clearTimeout(id);
  }, [documentoQuery, documentoListo, mutarBuscarCi]);

  // Búsqueda por nombre, para cuando no se tiene a mano el número de
  // documento — misma API de Personas, endpoint de texto libre.
  const { data: resultadosNombre = [], isFetching: buscandoNombreCargando } = useQuery({
    queryKey: ['personas-buscar-nombre', busquedaNombre],
    queryFn: () => buscarClientesPorNombre(busquedaNombre.trim()),
    enabled: buscandoNombre && busquedaNombre.trim().length >= 3,
  });

  function elegirResultadoNombre(p) {
    setNombre(p.nombre || '');
    setDocumento(p.numero_documento || '');
    setFechaNacimiento(p.fecha_nacimiento || '');
    setBuscandoNombre(false);
    setBusquedaNombre('');
  }

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!nombre.trim()) { setError('El nombre es requerido'); return; }
    setError('');
    mutCrear.mutate({
      nombre: nombre.trim(),
      numero_documento: documento.trim() || undefined,
      fecha_nacimiento: fechaNacimiento || undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2 bg-muted/50 border border-border rounded-xl p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <UserPlus className="w-3.5 h-3.5" /> Nuevo cliente
        </p>
        <button type="button" onClick={onCancelar} className="text-muted-foreground hover:text-foreground transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="relative">
        <input
          value={documento}
          onChange={(e) => { setDocumento(e.target.value); setAvisoBusqueda(''); }}
          placeholder="N° documento (busca automático)"
          className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring pr-8"
        />
        {documentoListo && buscarPorCi.isPending && (
          <Loader2 className="w-4 h-4 text-muted-foreground animate-spin absolute right-2.5 top-1/2 -translate-y-1/2" />
        )}
      </div>

      {avisoBusqueda && <p className="text-xs text-amber-600 dark:text-amber-400">{avisoBusqueda}</p>}

      {!mostrarBusquedaNombre ? (
        <button
          type="button"
          onClick={() => setMostrarBusquedaNombre(true)}
          className="text-xs text-primary hover:underline"
        >
          ¿No lo encuentra? Buscar por nombre completo
        </button>
      ) : (
        <div className="space-y-1.5">
          <div className="relative">
            <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={busquedaNombre}
              onChange={(e) => { setBusquedaNombre(e.target.value); setBuscandoNombre(true); }}
              onFocus={() => setBuscandoNombre(true)}
              placeholder="Ej: Juan Pérez"
              autoFocus
              className="w-full bg-background border border-input rounded-lg pl-9 pr-9 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {buscandoNombreCargando && <Loader2 className="w-4 h-4 text-muted-foreground animate-spin absolute right-3 top-1/2 -translate-y-1/2" />}
          </div>
          {buscandoNombre && busquedaNombre.trim().length >= 3 && (
            <div className="border border-border rounded-lg overflow-hidden max-h-32 overflow-y-auto bg-background">
              {!buscandoNombreCargando && resultadosNombre.length === 0 ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">Sin resultados</p>
              ) : resultadosNombre.map((p) => (
                <button
                  key={p.codigo}
                  type="button"
                  onClick={() => elegirResultadoNombre(p)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center justify-between gap-2"
                >
                  <span className="truncate text-foreground">{p.nombre}</span>
                  {p.numero_documento && <span className="text-xs text-muted-foreground shrink-0">CI {p.numero_documento}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <input
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        placeholder="Nombre *"
        className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />

      <div>
        <label className="block text-xs text-muted-foreground mb-1">Fecha de nacimiento (opcional)</label>
        <input
          type="date"
          value={fechaNacimiento}
          onChange={(e) => setFechaNacimiento(e.target.value)}
          className="w-full bg-background border border-input rounded-lg px-2 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {error && (
        <p className="text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />{error}
        </p>
      )}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancelar}
          className="flex-1 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={mutCrear.isPending}
          className="flex-1 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold transition-colors disabled:opacity-60"
        >
          {mutCrear.isPending ? 'Creando...' : 'Crear y usar'}
        </button>
      </div>
    </form>
  );
}

// Selector de cliente (búsqueda + alta rápida) para usar dentro del modal de
// cobro. Siempre visible: capturar el cliente sirve tanto para fidelidad
// (puntos) como para el sistema de cumpleaños, que es independiente de si el
// programa de fidelidad está activado. El bloque de canje de puntos sí queda
// condicionado a fidelidad, más abajo.
export default function ClienteFidelidad({ cliente, onCambiarCliente, puntosCanjear, onCambiarPuntos, metodoPago = 'efectivo' }) {
  const [busqueda, setBusqueda] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [creando, setCreando] = useState(false);
  const qc = useQueryClient();

  const { data: config = {} } = useQuery({ queryKey: ['configuracion'], queryFn: getConfiguracion, staleTime: 60_000 });
  const fidelidadActiva = config.fidelidad_activa === 'true';
  const valorPunto = parseFloat(config.valor_punto_bs || 0);
  const canjePermitido = metodoPago === 'qr'
    ? config.fidelidad_canje_qr === 'true'
    : config.fidelidad_canje_efectivo !== 'false';

  const { data: resultados = [] } = useQuery({
    queryKey: ['clientes-buscar', busqueda],
    queryFn: () => getClientes({ buscar: busqueda }),
    enabled: buscando && busqueda.trim().length >= 2,
  });

  if (!cliente) {
    if (creando) {
      return (
        <FormNuevoCliente
          onCancelar={() => setCreando(false)}
          onCreado={(nuevoCliente) => {
            qc.invalidateQueries({ queryKey: ['clientes-buscar'] });
            onCambiarCliente(nuevoCliente);
            setCreando(false);
          }}
        />
      );
    }

    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <Star className="w-3.5 h-3.5" /> Cliente (opcional{fidelidadActiva ? ', para sumar puntos' : ''})
          </label>
          <button
            type="button"
            onClick={() => setCreando(true)}
            className="text-xs text-primary font-medium hover:underline flex items-center gap-1 shrink-0"
          >
            <UserPlus className="w-3.5 h-3.5" /> Agregar cliente
          </button>
        </div>
        <div className="relative">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={busqueda}
            onChange={(e) => { setBusqueda(e.target.value); setBuscando(true); }}
            onFocus={() => setBuscando(true)}
            placeholder="Buscar por nombre o documento..."
            className="w-full bg-background border border-input rounded-xl pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
          />
        </div>
        {buscando && busqueda.trim().length >= 2 && (
          <div className="border border-border rounded-xl overflow-hidden max-h-40 overflow-y-auto">
            {resultados.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">Sin resultados</p>
            ) : resultados.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => { onCambiarCliente(c); setBuscando(false); setBusqueda(''); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center justify-between gap-2"
              >
                <span className="truncate text-foreground">{c.nombre}</span>
                <span className="text-xs text-muted-foreground shrink-0">{c.puntos} pts</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2 bg-muted/50 border border-border rounded-xl p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex items-center gap-2">
          <Star className="w-4 h-4 text-primary shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{cliente.nombre}</p>
            <p className="text-xs text-muted-foreground">{cliente.puntos} puntos disponibles</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => { onCambiarCliente(null); onCambiarPuntos(0, 0); }}
          className="p-1 rounded-lg text-muted-foreground hover:text-destructive transition-colors shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {fidelidadActiva && cliente.puntos > 0 && valorPunto > 0 && (
        canjePermitido ? (
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground shrink-0">Canjear puntos</label>
            <input
              type="number" min="0" max={cliente.puntos}
              value={puntosCanjear}
              onChange={(e) => {
                const v = Math.max(0, Math.min(cliente.puntos, parseInt(e.target.value, 10) || 0));
                onCambiarPuntos(v, v * valorPunto);
              }}
              className="w-20 bg-background border border-input rounded-lg px-2 py-1 text-sm text-foreground text-center focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {puntosCanjear > 0 && (
              <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">-Bs {(puntosCanjear * valorPunto).toFixed(2)}</span>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic">
            El canje de puntos no está habilitado para {metodoPago === 'qr' ? 'pagos por QR' : 'pago en efectivo'}.
          </p>
        )
      )}
    </div>
  );
}
