import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePermisos } from '../../hooks/usePermisos';
import { getClientes, crearCliente, actualizarCliente, buscarClientePorDocumento, buscarClientesPorNombre, buscarClientePorCodigo } from '../../api/clientes';
import {
  Users, Plus, Search, X, Edit2, Phone, Mail, MapPin,
  CreditCard, UserCircle, AlertTriangle, Star, Loader2,
} from 'lucide-react';

/* ─── helpers ─── */
const fmtFecha = (s) =>
  s ? new Date(s).toLocaleDateString('es-BO', { dateStyle: 'medium' }) : '—';

/* ─── avatar inicial ─── */
function Avatar({ nombre, size = 'md' }) {
  const colores = ['bg-indigo-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-violet-500', 'bg-blue-500', 'bg-teal-500'];
  const idx = (nombre?.charCodeAt(0) ?? 0) % colores.length;
  const cls = size === 'lg' ? 'w-12 h-12 text-base' : 'w-8 h-8 text-sm';
  return (
    <div className={`${cls} ${colores[idx]} rounded-full flex items-center justify-center text-white font-bold shrink-0`}>
      {nombre?.charAt(0)?.toUpperCase() ?? '?'}
    </div>
  );
}

/* ─── modal crear/editar ─── */
function ModalCliente({ cliente, onClose, onGuardar, loading }) {
  const [form, setForm] = useState({
    nombre:           cliente?.nombre           ?? '',
    tipo_documento:   cliente?.tipo_documento   ?? 'CI',
    numero_documento: cliente?.numero_documento ?? '',
    email:            cliente?.email            ?? '',
    telefono:         cliente?.telefono         ?? '',
    direccion:        cliente?.direccion        ?? '',
    fecha_nacimiento: cliente?.fecha_nacimiento  ?? '',
  });
  const [error, setError] = useState('');
  const [avisoBusqueda, setAvisoBusqueda] = useState('');
  const [busquedaNombre, setBusquedaNombre] = useState('');
  const [buscandoNombre, setBuscandoNombre] = useState(false);
  const [mostrarBusquedaNombre, setMostrarBusquedaNombre] = useState(false);
  const [busquedaCodigo, setBusquedaCodigo] = useState('');
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.nombre.trim()) { setError('El nombre es requerido'); return; }
    setError('');
    onGuardar({ ...form, fecha_nacimiento: form.fecha_nacimiento || null });
  };

  const esEdicion = !!cliente;

  // Autocompletar por CI contra la API de Personas (registro civil) — busca
  // automáticamente apenas hay suficientes dígitos, sin botón. Solo aplica
  // al crear (en edición no queremos pisar datos ya guardados).
  const buscarPorCi = useMutation({
    mutationFn: (numero) => buscarClientePorDocumento(numero),
    onSuccess: (datos, numero) => {
      if (!datos) { setAvisoBusqueda('No se encontró ninguna persona con ese número de documento.'); return; }
      setAvisoBusqueda('');
      setForm(f => ({
        ...f,
        nombre: datos.nombre || f.nombre,
        numero_documento: datos.numero_documento || numero,
        fecha_nacimiento: datos.fecha_nacimiento || f.fecha_nacimiento,
      }));
    },
    onError: (err) => setAvisoBusqueda(err?.response?.data?.mensaje ?? 'No se pudo consultar la API de personas'),
  });

  const documentoQuery = form.tipo_documento === 'CI' ? form.numero_documento.trim() : '';
  const documentoListo = !esEdicion && documentoQuery.length >= 5;
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
    setForm(f => ({
      ...f,
      nombre: p.nombre || f.nombre,
      tipo_documento: 'CI',
      numero_documento: p.numero_documento || f.numero_documento,
      fecha_nacimiento: p.fecha_nacimiento || f.fecha_nacimiento,
    }));
    setBuscandoNombre(false);
    setBusquedaNombre('');
  }

  // Por "código" (PK interna de la API de Personas, distinta del CI) — para
  // los registros que la documentación marca como sin numero_documento, que
  // no aparecen en el buscador de CI ni siempre en el de nombre.
  const buscarPorCodigo = useMutation({
    mutationFn: () => buscarClientePorCodigo(busquedaCodigo.trim()),
    onSuccess: (datos) => {
      if (!datos) { setAvisoBusqueda('No se encontró ninguna persona con ese código.'); return; }
      setAvisoBusqueda('');
      setForm(f => ({
        ...f,
        nombre: datos.nombre || f.nombre,
        tipo_documento: 'CI',
        numero_documento: datos.numero_documento || f.numero_documento,
        fecha_nacimiento: datos.fecha_nacimiento || f.fecha_nacimiento,
      }));
    },
    onError: (err) => setAvisoBusqueda(err?.response?.data?.mensaje ?? 'No se pudo consultar la API de personas'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-md border border-border max-h-[90vh] overflow-y-auto">
        {/* header */}
        <div className="px-6 py-4 rounded-t-2xl flex items-center justify-between bg-primary">
          <div className="flex items-center gap-3">
            {esEdicion
              ? <Edit2 className="w-5 h-5 text-primary-foreground" />
              : <Plus className="w-5 h-5 text-primary-foreground" />}
            <h2 className="text-primary-foreground font-semibold">
              {esEdicion ? 'Editar Cliente' : 'Nuevo Cliente'}
            </h2>
          </div>
          <button onClick={onClose} className="text-primary-foreground/80 hover:text-primary-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {!esEdicion && (
            <>
              {/* buscar por código interno (primero) */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">
                  Buscar por CI
                </label>
                <div className="flex gap-2">
                  <input
                    value={busquedaCodigo}
                    onChange={(e) => { setBusquedaCodigo(e.target.value); setAvisoBusqueda(''); }}
                    placeholder="Ej: 7897245"
                    className="flex-1 bg-background border border-input rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
                  />
                  <button
                    type="button"
                    onClick={() => buscarPorCodigo.mutate()}
                    disabled={!busquedaCodigo.trim() || buscarPorCodigo.isPending}
                    title="Buscar por código"
                    className="shrink-0 flex items-center justify-center w-11 rounded-xl border border-input text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                  >
                    {buscarPorCodigo.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {avisoBusqueda && <p className="text-xs text-amber-600 dark:text-amber-400">{avisoBusqueda}</p>}

              {/* buscar por nombre (opcional, si no se tiene el código) */}
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
                  <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">
                    Buscar por nombre
                  </label>
                  <div className="relative">
                    <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      value={busquedaNombre}
                      onChange={(e) => { setBusquedaNombre(e.target.value); setBuscandoNombre(true); }}
                      onFocus={() => setBuscandoNombre(true)}
                      placeholder="Ej: Juan Pérez"
                      autoFocus
                      className="w-full bg-background border border-input rounded-xl pl-9 pr-9 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
                    />
                    {buscandoNombreCargando && <Loader2 className="w-4 h-4 text-muted-foreground animate-spin absolute right-3 top-1/2 -translate-y-1/2" />}
                  </div>
                  {buscandoNombre && busquedaNombre.trim().length >= 3 && (
                    <div className="border border-border rounded-xl overflow-hidden max-h-40 overflow-y-auto">
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
            </>
          )}

          {/* nombre */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">
              Nombre completo *
            </label>
            <input
              value={form.nombre}
              onChange={set('nombre')}
              placeholder="Ej: Juan Pérez"
              autoFocus
              className="w-full rounded-xl border border-input bg-background text-foreground px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* documento */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">
              N° documento
            </label>
            <div className="relative">
              <input
                value={form.numero_documento}
                onChange={(e) => { set('numero_documento')(e); setAvisoBusqueda(''); }}
                placeholder="12345678"
                className="w-full rounded-xl border border-input bg-background text-foreground px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring pr-8"
              />
              {documentoListo && buscarPorCi.isPending && (
                <Loader2 className="w-4 h-4 text-muted-foreground animate-spin absolute right-3 top-1/2 -translate-y-1/2" />
              )}
            </div>
          </div>

          {/* contacto */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">
                Teléfono
              </label>
              <input
                value={form.telefono}
                onChange={set('telefono')}
                placeholder="+591 7XXXXXXX"
                className="w-full rounded-xl border border-input bg-background text-foreground px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">
                Email
              </label>
              <input
                type="email"
                value={form.email}
                onChange={set('email')}
                placeholder="correo@ejemplo.com"
                className="w-full rounded-xl border border-input bg-background text-foreground px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          {/* dirección + fecha de nacimiento */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">
                Dirección
              </label>
              <input
                value={form.direccion}
                onChange={set('direccion')}
                placeholder="Av. Principal #123..."
                className="w-full rounded-xl border border-input bg-background text-foreground px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">
                Fecha de nacimiento
              </label>
              <input
                type="date"
                value={form.fecha_nacimiento}
                onChange={set('fecha_nacimiento')}
                className="w-full rounded-xl border border-input bg-background text-foreground px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          {error && (
            <p className="text-rose-600 dark:text-rose-400 text-sm flex items-center gap-1">
              <AlertTriangle className="w-4 h-4" />{error}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2.5 rounded-xl bg-primary hover:bg-primary/90 disabled:opacity-60 text-primary-foreground text-sm font-semibold transition-colors"
            >
              {loading ? 'Guardando...' : esEdicion ? 'Actualizar' : 'Crear cliente'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── tarjeta cliente móvil ─── */
function ClienteCard({ cliente, idx, puedoEditar, onEditar }) {
  return (
    <div
      className="bg-card rounded-xl border border-border shadow-sm p-4"
      style={{ animation: 'cliFadeUp .35s ease both', animationDelay: `${idx * 30}ms` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar nombre={cliente.nombre} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{cliente.nombre}</p>
            {cliente.numero_documento && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                <CreditCard className="w-3 h-3" />
                {cliente.tipo_documento} {cliente.numero_documento}
              </p>
            )}
            {cliente.puntos > 0 && (
              <p className="text-xs text-primary flex items-center gap-1 mt-0.5 font-medium">
                <Star className="w-3 h-3" />
                {cliente.puntos} puntos
              </p>
            )}
          </div>
        </div>
        {puedoEditar && (
          <button
            onClick={() => onEditar(cliente)}
            className="shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
          >
            <Edit2 className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-1.5 text-xs">
        {cliente.telefono && (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Phone className="w-3 h-3 shrink-0" />
            <span className="truncate">{cliente.telefono}</span>
          </div>
        )}
        {cliente.email && (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Mail className="w-3 h-3 shrink-0" />
            <span className="truncate">{cliente.email}</span>
          </div>
        )}
        {cliente.direccion && (
          <div className="col-span-2 flex items-center gap-1.5 text-muted-foreground">
            <MapPin className="w-3 h-3 shrink-0" />
            <span className="truncate">{cliente.direccion}</span>
          </div>
        )}
      </div>

      <div className="mt-2 text-xs text-muted-foreground">
        Registrado el {fmtFecha(cliente.creado_en)}
      </div>
    </div>
  );
}

/* ─── página principal ─── */
export default function ClientesPage() {
  const { tienePermiso } = usePermisos();
  const qc = useQueryClient();

  const puedoVer    = tienePermiso('clientes', 'ver');
  const puedoCrear  = tienePermiso('clientes', 'crear');
  const puedoEditar = tienePermiso('clientes', 'editar');

  const [buscar, setBuscar] = useState('');
  const [modal, setModal] = useState(null); // null | 'nuevo' | cliente
  const [toast, setToast] = useState(null);

  const mostrarToast = (msg, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  const { data: clientes = [], isLoading } = useQuery({
    queryKey: ['clientes'],
    queryFn: getClientes,
    enabled: puedoVer,
  });

  const mutCrear = useMutation({
    mutationFn: crearCliente,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clientes'] });
      setModal(null);
      mostrarToast('Cliente creado');
    },
    onError: (e) => mostrarToast(e?.response?.data?.mensaje ?? 'Error al crear cliente', false),
  });

  const mutEditar = useMutation({
    mutationFn: ({ id, datos }) => actualizarCliente(id, datos),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clientes'] });
      setModal(null);
      mostrarToast('Cliente actualizado');
    },
    onError: (e) => mostrarToast(e?.response?.data?.mensaje ?? 'Error al actualizar', false),
  });

  const handleGuardar = (datos) => {
    if (modal === 'nuevo') mutCrear.mutate(datos);
    else mutEditar.mutate({ id: modal.id, datos });
  };

  const clientesFiltrados = useMemo(() => {
    if (!buscar.trim()) return clientes;
    const q = buscar.toLowerCase();
    return clientes.filter(c =>
      c.nombre?.toLowerCase().includes(q) ||
      c.numero_documento?.toLowerCase().includes(q) ||
      c.telefono?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q)
    );
  }, [clientes, buscar]);

  if (!puedoVer) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
        <Users className="w-12 h-12" />
        <p className="text-sm">Sin acceso al módulo de clientes</p>
      </div>
    );
  }

  const isMutLoading = mutCrear.isPending || mutEditar.isPending;

  return (
    <>
      <style>{`
        @keyframes cliFadeUp { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:translateY(0); } }
        @keyframes toastIn   { from { opacity:0; transform:translateX(20px); } to { opacity:1; transform:translateX(0); } }
      `}</style>

      {/* toast */}
      {toast && (
        <div
          className={`fixed top-5 right-5 z-[100] px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white flex items-center gap-2 ${toast.ok ? 'bg-emerald-600' : 'bg-rose-600'}`}
          style={{ animation: 'toastIn .25s ease both' }}
        >
          {toast.ok ? '✓' : '✕'} {toast.msg}
        </div>
      )}

      {modal && (
        <ModalCliente
          cliente={modal === 'nuevo' ? null : modal}
          onClose={() => setModal(null)}
          onGuardar={handleGuardar}
          loading={isMutLoading}
        />
      )}

      <div className="space-y-6">
        {/* header */}
        <div className="rounded-2xl p-5 sm:p-6 bg-primary text-primary-foreground relative overflow-hidden">
          <div className="absolute -top-6 -right-6 w-32 h-32 bg-primary-foreground/10 rounded-full" />
          <div className="absolute -bottom-4 -right-16 w-48 h-48 bg-primary-foreground/5 rounded-full" />
          <div className="relative flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold">Clientes</h1>
              <p className="text-primary-foreground/70 text-sm mt-0.5">Directorio de clientes registrados</p>
            </div>
            {puedoCrear && (
              <button
                onClick={() => setModal('nuevo')}
                className="flex items-center gap-2 bg-primary-foreground text-primary px-4 py-2 rounded-xl text-sm font-semibold shadow hover:shadow-md transition-all hover:scale-[1.02]"
              >
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">Nuevo Cliente</span>
                <span className="sm:hidden">Nuevo</span>
              </button>
            )}
          </div>
        </div>

        {/* summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            {
              label: 'Total clientes',
              value: clientes.length,
              sub: 'registrados',
              delay: 100,
            },
            {
              label: 'Con documento',
              value: clientes.filter(c => c.numero_documento).length,
              sub: 'identificados',
              delay: 160,
            },
            {
              label: 'Con contacto',
              value: clientes.filter(c => c.telefono || c.email).length,
              sub: 'con tel. o email',
              delay: 220,
            },
          ].map(({ label, value, sub, delay }) => (
            <div
              key={label}
              className="bg-card rounded-2xl border border-border shadow-sm p-5 relative overflow-hidden"
              style={{ animation: 'cliFadeUp .4s ease both', animationDelay: `${delay}ms` }}
            >
              <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl bg-primary" />
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
              <p className="text-2xl font-bold text-foreground">{value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
            </div>
          ))}
        </div>

        {/* buscador */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={buscar}
            onChange={e => setBuscar(e.target.value)}
            placeholder="Buscar por nombre, documento, teléfono o email..."
            className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {buscar && (
            <button
              onClick={() => setBuscar('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* contenido */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-28 bg-muted rounded-xl animate-pulse" />
            ))}
          </div>
        ) : clientesFiltrados.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
            <UserCircle className="w-12 h-12 opacity-40" />
            <p className="text-sm">
              {buscar ? 'Sin resultados para esa búsqueda' : 'Sin clientes registrados'}
            </p>
            {puedoCrear && !buscar && (
              <button
                onClick={() => setModal('nuevo')}
                className="text-primary text-sm font-medium hover:underline"
              >
                Registrar primer cliente
              </button>
            )}
          </div>
        ) : (
          <>
            {/* mobile: cards */}
            <div className="sm:hidden space-y-3">
              {clientesFiltrados.map((c, i) => (
                <ClienteCard key={c.id} cliente={c} idx={i} puedoEditar={puedoEditar} onEditar={setModal} />
              ))}
            </div>

            {/* desktop: tabla */}
            <div className="hidden sm:block bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Cliente</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Documento</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Teléfono</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Email</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Dirección</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Puntos</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Registrado</th>
                      {puedoEditar && <th className="px-4 py-3" />}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {clientesFiltrados.map((c, i) => (
                      <tr
                        key={c.id}
                        className="hover:bg-muted/50 transition-colors"
                        style={{ animation: 'cliFadeUp .3s ease both', animationDelay: `${i * 20}ms` }}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <Avatar nombre={c.nombre} />
                            <span className="font-medium text-foreground">{c.nombre}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {c.numero_documento ? (
                            <span className="inline-flex items-center gap-1 text-foreground">
                              <CreditCard className="w-3.5 h-3.5 text-muted-foreground" />
                              <span className="text-xs text-muted-foreground">{c.tipo_documento}</span>
                              {c.numero_documento}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {c.telefono ? (
                            <span className="inline-flex items-center gap-1 text-foreground">
                              <Phone className="w-3.5 h-3.5 text-muted-foreground" />{c.telefono}
                            </span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          {c.email ? (
                            <span className="inline-flex items-center gap-1 text-foreground">
                              <Mail className="w-3.5 h-3.5 text-muted-foreground" />{c.email}
                            </span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          {c.direccion ? (
                            <span className="inline-flex items-center gap-1 text-foreground text-xs">
                              <MapPin className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                              <span className="truncate max-w-[140px]">{c.direccion}</span>
                            </span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          {c.puntos > 0 ? (
                            <span className="inline-flex items-center gap-1 text-primary font-medium">
                              <Star className="w-3.5 h-3.5" />{c.puntos}
                            </span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                          {fmtFecha(c.creado_en)}
                        </td>
                        {puedoEditar && (
                          <td className="px-4 py-3">
                            <button
                              onClick={() => setModal(c)}
                              className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-2 border-t border-border text-xs text-muted-foreground">
                {clientesFiltrados.length} cliente{clientesFiltrados.length !== 1 ? 's' : ''}
                {buscar && ` encontrado${clientesFiltrados.length !== 1 ? 's' : ''}`}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
