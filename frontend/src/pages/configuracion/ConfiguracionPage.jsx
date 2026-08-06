import { useRef, useState } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Building2, Grid3x3, Users, AlertCircle, RefreshCw, ChefHat, CheckCircle2, Store, Upload, X, Star, Cake, Disc3 } from 'lucide-react';
import { getAreas, crearArea, actualizarArea, eliminarArea } from '../../api/areas';
import { getMesas, crearMesa, actualizarMesa, eliminarMesa } from '../../api/mesas';
import { getConfiguracion, actualizarConfiguracion, subirLogo, logoSrc } from '../../api/configuracion';
import { usePermisos } from '../../hooks/usePermisos';
import Modal from '../../components/ui/Modal';

const TABS = [
  { id: 'negocio', label: 'Negocio',      descripcion: 'Datos generales, logo y colores de marca',  Icono: Store },
  { id: 'areas',   label: 'Áreas',        descripcion: 'Zonas del local donde se ubican las mesas', Icono: Building2 },
  { id: 'mesas',   label: 'Mesas',        descripcion: 'Mesas por área y su capacidad',             Icono: Grid3x3 },
  { id: 'flujo',   label: 'Flujo Cocina', descripcion: 'Cómo se comunica la sala con la cocina',    Icono: ChefHat },
  { id: 'fidelidad', label: 'Fidelidad', descripcion: 'Puntos por compra y valor de canje para clientes', Icono: Star },
  { id: 'cumpleanos', label: 'Cumpleaños', descripcion: 'Cupón automático de cumpleaños para clientes', Icono: Cake },
  { id: 'ruleta', label: 'Ruleta', descripcion: 'Costo en puntos y límites de giro de la ruleta de premios', Icono: Disc3 },
];

/* ─── Bloque reutilizable de sección con encabezado ──────────────────────── */
function SettingsSection({ titulo, descripcion, accion, children }) {
  return (
    <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
      <div className="px-5 py-4 sm:px-6 sm:py-5 border-b border-border flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{titulo}</h2>
          {descripcion && <p className="text-xs text-muted-foreground mt-1">{descripcion}</p>}
        </div>
        {accion}
      </div>
      <div className="p-5 sm:p-6">{children}</div>
    </div>
  );
}

/* ─── Tarjeta simple sin encabezado propio (para tabs de una sola sección,
     donde el título ya lo muestra la cabecera de la página) ──────────────── */
function SettingsCard({ toolbar, children }) {
  return (
    <div className="bg-card border border-border rounded-2xl shadow-sm p-5 sm:p-6 space-y-4">
      {toolbar && <div className="flex items-center justify-between flex-wrap gap-3">{toolbar}</div>}
      {children}
    </div>
  );
}

export default function ConfiguracionPage() {
  const { tienePermiso } = usePermisos();
  const puedeVer    = tienePermiso('configuracion', 'ver');
  const puedeEditar = tienePermiso('configuracion', 'editar');
  const { tab } = useParams();

  if (!puedeVer) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
        <AlertCircle className="w-10 h-10" />
        <p className="font-medium">No tienes permiso para ver la configuración</p>
      </div>
    );
  }

  const tabActual = TABS.find(t => t.id === tab);
  if (!tabActual) return <Navigate to="/configuracion/negocio" replace />;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <tabActual.Icono className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-foreground">{tabActual.label}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{tabActual.descripcion}</p>
        </div>
      </div>

      {tab === 'negocio' && <TabNegocio puedeEditar={puedeEditar} />}
      {tab === 'areas'   && <TabAreas   puedeEditar={puedeEditar} />}
      {tab === 'mesas'   && <TabMesas   puedeEditar={puedeEditar} />}
      {tab === 'flujo'   && <TabFlujo   puedeEditar={puedeEditar} />}
      {tab === 'fidelidad' && <TabFidelidad puedeEditar={puedeEditar} />}
      {tab === 'cumpleanos' && <TabCumpleanos puedeEditar={puedeEditar} />}
      {tab === 'ruleta' && <TabRuleta puedeEditar={puedeEditar} />}
    </div>
  );
}

/* ─── Tab Negocio ────────────────────────────────────────────────────────── */

const ZONAS_HORARIAS = [
  'America/La_Paz',
  'America/Lima',
  'America/Bogota',
  'America/Santiago',
  'America/Buenos_Aires',
  'America/Caracas',
  'America/Guayaquil',
  'America/Asuncion',
  'America/Montevideo',
  'America/Mexico_City',
  'America/Sao_Paulo',
  'America/New_York',
  'Europe/Madrid',
];

function TabNegocio({ puedeEditar }) {
  const qc = useQueryClient();
  const logoRef = useRef(null);
  const [guardado, setGuardado] = useState(false);
  const [subiendoLogo, setSubiendoLogo] = useState(false);
  const [errorLogo, setErrorLogo] = useState('');

  const { data: config = {}, isLoading } = useQuery({
    queryKey: ['configuracion'],
    queryFn: getConfiguracion,
  });

  const [form, setForm] = useState(null);

  // Sincronizar form con config cuando carga por primera vez
  if (!isLoading && form === null) {
    setForm({
      nombre_negocio: config.nombre_negocio ?? '',
      direccion:      config.direccion      ?? '',
      telefono:       config.telefono       ?? '',
      moneda:         config.moneda         ?? 'Bs',
      simbolo_moneda: config.simbolo_moneda ?? 'Bs.',
      zona_horaria:   config.zona_horaria   ?? 'America/La_Paz',
      pie_ticket:     config.pie_ticket     ?? '¡Gracias por su preferencia!',
      logo:           config.logo           ?? '',
      color_primario:   config.color_primario   ?? '',
      color_secundario: config.color_secundario ?? '',
    });
  }

  const guardar = useMutation({
    mutationFn: (datos) => actualizarConfiguracion(datos),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['configuracion'] });
      setGuardado(true);
      setTimeout(() => setGuardado(false), 2500);
    },
  });

  function set(k, v) {
    setForm(f => ({ ...f, [k]: v }));
  }

  function guardarNegocio() {
    const datos = { ...form };
    if (!datos.color_primario) delete datos.color_primario;
    if (!datos.color_secundario) delete datos.color_secundario;
    guardar.mutate(datos);
  }

  async function handleLogo(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorLogo('');
    setSubiendoLogo(true);
    try {
      const url = await subirLogo(file);
      set('logo', url);
    } catch {
      setErrorLogo('Error al subir la imagen. Intenta de nuevo.');
    } finally {
      setSubiendoLogo(false);
      e.target.value = '';
    }
  }

  if (isLoading || form === null) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-8">
        <RefreshCw className="w-4 h-4 animate-spin" /><span className="text-sm">Cargando...</span>
      </div>
    );
  }

  const campo = (label, key, opts = {}) => (
    <div>
      <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
        {label}
      </label>
      {opts.textarea ? (
        <textarea
          rows={2}
          value={form[key]}
          onChange={e => set(key, e.target.value)}
          disabled={!puedeEditar}
          className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition resize-none disabled:opacity-60"
        />
      ) : (
        <input
          type={opts.type ?? 'text'}
          value={form[key]}
          onChange={e => set(key, e.target.value)}
          disabled={!puedeEditar}
          placeholder={opts.placeholder}
          className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition disabled:opacity-60"
        />
      )}
    </div>
  );

  return (
    <div className="space-y-4">

      <SettingsSection titulo="Identidad" descripcion="Logo que aparece en tickets, PDF y en la barra lateral">
        <div className="flex items-start gap-4">
          {form.logo ? (
            <div className="relative shrink-0">
              <img
                src={logoSrc(form.logo)}
                alt="Logo"
                className="w-24 h-24 object-contain rounded-xl border border-border bg-card p-1"
              />
              {puedeEditar && (
                <button
                  onClick={() => set('logo', '')}
                  className="absolute -top-2 -right-2 w-5 h-5 bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-full flex items-center justify-center"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          ) : (
            <div className="w-24 h-24 rounded-xl border-2 border-dashed border-input flex items-center justify-center text-muted-foreground shrink-0">
              {subiendoLogo ? <RefreshCw className="w-6 h-6 animate-spin" /> : <Store className="w-8 h-8" />}
            </div>
          )}
          {puedeEditar && (
            <div className="space-y-1.5">
              <button
                onClick={() => logoRef.current?.click()}
                disabled={subiendoLogo}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-60"
              >
                <Upload className="w-4 h-4" />
                {subiendoLogo ? 'Subiendo...' : form.logo ? 'Cambiar logo' : 'Subir logo'}
              </button>
              <p className="text-xs text-muted-foreground">PNG, JPG o WebP · máx. 5MB · se usa en tickets y PDF.</p>
              {errorLogo && <p className="text-xs text-destructive">{errorLogo}</p>}
              <input ref={logoRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleLogo} />
            </div>
          )}
        </div>
      </SettingsSection>

      <SettingsSection titulo="Datos del negocio" descripcion="Información general que aparece en tickets y reportes">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {campo('Nombre del negocio', 'nombre_negocio', { placeholder: 'Mi Restaurante' })}
            {campo('Teléfono', 'telefono', { placeholder: '+591 7X XXX XXX', type: 'tel' })}
          </div>

          {campo('Dirección', 'direccion', { placeholder: 'Calle, Nro., Ciudad' })}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {campo('Moneda', 'moneda', { placeholder: 'Bolivianos' })}
            {campo('Símbolo', 'simbolo_moneda', { placeholder: 'Bs.' })}
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              Zona horaria
            </label>
            <select
              value={form.zona_horaria}
              onChange={e => set('zona_horaria', e.target.value)}
              disabled={!puedeEditar}
              className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
            >
              {ZONAS_HORARIAS.map(z => <option key={z} value={z}>{z}</option>)}
            </select>
          </div>

          {campo('Pie de ticket', 'pie_ticket', { textarea: true, placeholder: '¡Gracias por su preferencia!' })}
        </div>
      </SettingsSection>

      <SettingsSection titulo="Colores de marca" descripcion="Se aplican en toda la interfaz del sistema">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              Color primario
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={form.color_primario || '#245b62'}
                onChange={e => set('color_primario', e.target.value)}
                disabled={!puedeEditar}
                className="w-10 h-10 rounded-lg border border-input bg-transparent disabled:opacity-60"
              />
              <input
                type="text"
                value={form.color_primario}
                onChange={e => set('color_primario', e.target.value)}
                disabled={!puedeEditar}
                placeholder="#245b62"
                className="flex-1 bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              Color secundario
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={form.color_secundario || '#d97706'}
                onChange={e => set('color_secundario', e.target.value)}
                disabled={!puedeEditar}
                className="w-10 h-10 rounded-lg border border-input bg-transparent disabled:opacity-60"
              />
              <input
                type="text"
                value={form.color_secundario}
                onChange={e => set('color_secundario', e.target.value)}
                disabled={!puedeEditar}
                placeholder="#d97706"
                className="flex-1 bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
              />
            </div>
          </div>
        </div>
      </SettingsSection>

      {puedeEditar ? (
        <div className="flex items-center gap-4 pt-1">
          <button
            onClick={guardarNegocio}
            disabled={guardar.isPending}
            className="px-6 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-sm font-semibold transition-colors disabled:opacity-60"
          >
            {guardar.isPending ? 'Guardando...' : 'Guardar cambios'}
          </button>
          {guardado && (
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-sm font-medium">
              <CheckCircle2 className="w-4 h-4" /> Guardado correctamente
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No tienes permiso para editar la configuración.</p>
      )}
    </div>
  );
}

/* ─── Tab Flujo Cocina ───────────────────────────────────────────────────── */

function TabFlujo({ puedeEditar }) {
  const qc = useQueryClient();
  const [guardado, setGuardado] = useState(false);

  const { data: config = {}, isLoading } = useQuery({
    queryKey: ['configuracion'],
    queryFn: getConfiguracion,
  });

  const flujoActual = config.flujo_cocina ?? 'digital';

  const guardar = useMutation({
    mutationFn: (flujo) => actualizarConfiguracion({ flujo_cocina: flujo }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['configuracion'] });
      setGuardado(true);
      setTimeout(() => setGuardado(false), 2500);
    },
  });

  const opciones = [
    {
      id: 'digital',
      titulo: 'Vista digital de cocina',
      descripcion: 'Los pedidos aparecen en la pantalla /cocina. La cocina marca "listo" desde la pantalla y el mesero ve la notificación en el pedido.',
      icono: '🖥️',
    },
    {
      id: 'fisico',
      titulo: 'Ticket físico impreso',
      descripcion: 'Al guardar el pedido aparece un botón para imprimir el ticket de cocina. El flujo es el mismo que antes: papel → cocina → servir.',
      icono: '🖨️',
    },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-8">
        <RefreshCw className="w-4 h-4 animate-spin" /><span className="text-sm">Cargando...</span>
      </div>
    );
  }

  return (
    <SettingsCard>
      <div className="space-y-4">
        <div className="space-y-3">
          {opciones.map(op => (
            <button
              key={op.id}
              onClick={() => puedeEditar && guardar.mutate(op.id)}
              disabled={!puedeEditar || guardar.isPending}
              className={`w-full text-left p-4 rounded-2xl border-2 transition-all ${
                flujoActual === op.id
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-card hover:border-muted-foreground'
              } ${!puedeEditar ? 'cursor-default' : 'cursor-pointer'}`}
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl">{op.icono}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-foreground text-sm">{op.titulo}</p>
                    {flujoActual === op.id && (
                      <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full font-medium">Activo</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{op.descripcion}</p>
                </div>
              </div>
            </button>
          ))}
        </div>

        {guardado && (
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-sm font-medium">
            <CheckCircle2 className="w-4 h-4" /> Configuración guardada
          </div>
        )}

        {!puedeEditar && (
          <p className="text-xs text-muted-foreground">No tienes permiso para cambiar esta configuración.</p>
        )}
      </div>
    </SettingsCard>
  );
}

/* ─── Tab Fidelidad ──────────────────────────────────────────────────────── */

function TabFidelidad({ puedeEditar }) {
  const qc = useQueryClient();
  const [guardado, setGuardado] = useState(false);

  const { data: config = {}, isLoading } = useQuery({
    queryKey: ['configuracion'],
    queryFn: getConfiguracion,
  });

  const [form, setForm] = useState(null);

  if (!isLoading && form === null) {
    setForm({
      fidelidad_activa: config.fidelidad_activa === 'true',
      puntos_por_bs:    config.puntos_por_bs    ?? '1',
      valor_punto_bs:   config.valor_punto_bs   ?? '0.10',
      fidelidad_canje_efectivo: config.fidelidad_canje_efectivo !== 'false',
      fidelidad_canje_qr:       config.fidelidad_canje_qr === 'true',
    });
  }

  const guardar = useMutation({
    mutationFn: (datos) => actualizarConfiguracion(datos),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['configuracion'] });
      setGuardado(true);
      setTimeout(() => setGuardado(false), 2500);
    },
  });

  function set(k, v) {
    setForm(f => ({ ...f, [k]: v }));
  }

  function guardarFidelidad() {
    guardar.mutate({
      fidelidad_activa: form.fidelidad_activa ? 'true' : 'false',
      puntos_por_bs: form.puntos_por_bs,
      valor_punto_bs: form.valor_punto_bs,
      fidelidad_canje_efectivo: form.fidelidad_canje_efectivo ? 'true' : 'false',
      fidelidad_canje_qr: form.fidelidad_canje_qr ? 'true' : 'false',
    });
  }

  if (isLoading || form === null) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-8">
        <RefreshCw className="w-4 h-4 animate-spin" /><span className="text-sm">Cargando...</span>
      </div>
    );
  }

  const puntosPorBs  = parseFloat(form.puntos_por_bs)  || 0;
  const valorPunto   = parseFloat(form.valor_punto_bs) || 0;

  return (
    <SettingsCard>
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => puedeEditar && set('fidelidad_activa', !form.fidelidad_activa)}
            disabled={!puedeEditar}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-60 ${form.fidelidad_activa ? 'bg-emerald-500' : 'bg-muted'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${form.fidelidad_activa ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
          <div>
            <p className="text-sm font-semibold text-foreground">Programa de puntos activo</p>
            <p className="text-xs text-muted-foreground">Si está apagado, no se otorgan ni se pueden canjear puntos en ninguna venta.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              Puntos ganados por cada Bs gastado
            </label>
            <input
              type="number" step="0.01" min="0"
              value={form.puntos_por_bs}
              onChange={e => set('puntos_por_bs', e.target.value)}
              disabled={!puedeEditar}
              className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition disabled:opacity-60"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              Valor de 1 punto al canjear (Bs)
            </label>
            <input
              type="number" step="0.01" min="0"
              value={form.valor_punto_bs}
              onChange={e => set('valor_punto_bs', e.target.value)}
              disabled={!puedeEditar}
              className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition disabled:opacity-60"
            />
          </div>
        </div>

        <div className="bg-muted rounded-xl px-4 py-3 text-xs text-muted-foreground">
          Ejemplo: una compra de <strong className="text-foreground">Bs 100</strong> otorga{' '}
          <strong className="text-foreground">{Math.floor(100 * puntosPorBs)} puntos</strong>. Esos puntos, canjeados
          en una compra futura, valen <strong className="text-foreground">Bs {(Math.floor(100 * puntosPorBs) * valorPunto).toFixed(2)}</strong> de descuento.
        </div>

        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">¿En qué métodos de pago se puede canjear?</p>
          {[
            { key: 'fidelidad_canje_efectivo', label: 'Efectivo', desc: 'Permitir canjear puntos cuando se cobra en efectivo.' },
            { key: 'fidelidad_canje_qr', label: 'QR / Transferencia', desc: 'Permitir canjear puntos cuando se cobra por QR (los puntos se reservan al generar el QR y se devuelven si el pago falla o expira).' },
          ].map(({ key, label, desc }) => (
            <div key={key} className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => puedeEditar && set(key, !form[key])}
                disabled={!puedeEditar}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${form[key] ? 'bg-emerald-500' : 'bg-muted'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${form[key] ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
              <div>
                <p className="text-sm font-semibold text-foreground">{label}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
            </div>
          ))}
        </div>

        {puedeEditar ? (
          <div className="flex items-center gap-4 pt-1">
            <button
              onClick={guardarFidelidad}
              disabled={guardar.isPending}
              className="px-6 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-sm font-semibold transition-colors disabled:opacity-60"
            >
              {guardar.isPending ? 'Guardando...' : 'Guardar cambios'}
            </button>
            {guardado && (
              <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-sm font-medium">
                <CheckCircle2 className="w-4 h-4" /> Guardado correctamente
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No tienes permiso para editar la configuración.</p>
        )}
      </div>
    </SettingsCard>
  );
}

/* ─── Tab Cumpleaños ─────────────────────────────────────────────────────── */

function TabCumpleanos({ puedeEditar }) {
  const qc = useQueryClient();
  const [guardado, setGuardado] = useState(false);

  const { data: config = {}, isLoading } = useQuery({
    queryKey: ['configuracion'],
    queryFn: getConfiguracion,
  });

  const [form, setForm] = useState(null);

  if (!isLoading && form === null) {
    setForm({
      cumple_activo:            config.cumple_activo === 'true',
      cumple_dias_anticipacion: config.cumple_dias_anticipacion ?? '5',
      cumple_tipo:              config.cumple_tipo ?? 'porcentaje',
      cumple_valor:             config.cumple_valor ?? '10',
      cumple_vigencia_dias:     config.cumple_vigencia_dias ?? '10',
    });
  }

  const guardar = useMutation({
    mutationFn: (datos) => actualizarConfiguracion(datos),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['configuracion'] });
      setGuardado(true);
      setTimeout(() => setGuardado(false), 2500);
    },
  });

  function set(k, v) {
    setForm(f => ({ ...f, [k]: v }));
  }

  function guardarCumpleanos() {
    guardar.mutate({
      cumple_activo: form.cumple_activo ? 'true' : 'false',
      cumple_dias_anticipacion: form.cumple_dias_anticipacion,
      cumple_tipo: form.cumple_tipo,
      cumple_valor: form.cumple_valor,
      cumple_vigencia_dias: form.cumple_vigencia_dias,
    });
  }

  if (isLoading || form === null) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-8">
        <RefreshCw className="w-4 h-4 animate-spin" /><span className="text-sm">Cargando...</span>
      </div>
    );
  }

  const dias = parseInt(form.cumple_dias_anticipacion, 10) || 0;
  const vigencia = parseInt(form.cumple_vigencia_dias, 10) || 0;
  const valor = parseFloat(form.cumple_valor) || 0;

  return (
    <SettingsCard>
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => puedeEditar && set('cumple_activo', !form.cumple_activo)}
            disabled={!puedeEditar}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-60 ${form.cumple_activo ? 'bg-emerald-500' : 'bg-muted'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${form.cumple_activo ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
          <div>
            <p className="text-sm font-semibold text-foreground">Promo cumpleañero activa</p>
            <p className="text-xs text-muted-foreground">
              Genera automáticamente, todos los días, un cupón personal para cada cliente que tenga fecha de nacimiento cargada y esté por cumplir años.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              Días de anticipación
            </label>
            <input
              type="number" min="0" step="1"
              value={form.cumple_dias_anticipacion}
              onChange={e => set('cumple_dias_anticipacion', e.target.value)}
              disabled={!puedeEditar}
              className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition disabled:opacity-60"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              Vigencia del cupón (días)
            </label>
            <input
              type="number" min="1" step="1"
              value={form.cumple_vigencia_dias}
              onChange={e => set('cumple_vigencia_dias', e.target.value)}
              disabled={!puedeEditar}
              className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition disabled:opacity-60"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Tipo de descuento</label>
            <div className="grid grid-cols-2 gap-2">
              {[{ id: 'fijo', label: 'Bs' }, { id: 'porcentaje', label: '%' }].map((t) => (
                <button
                  key={t.id} type="button"
                  onClick={() => puedeEditar && set('cumple_tipo', t.id)}
                  disabled={!puedeEditar}
                  className={`py-2.5 rounded-xl text-sm font-medium border transition-colors disabled:opacity-60 ${
                    form.cumple_tipo === t.id ? 'bg-primary border-primary text-primary-foreground' : 'border-input text-muted-foreground hover:border-primary/50'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Valor</label>
            <input
              type="number" step="0.01" min="0" max={form.cumple_tipo === 'porcentaje' ? 100 : undefined}
              value={form.cumple_valor}
              onChange={e => set('cumple_valor', e.target.value)}
              disabled={!puedeEditar}
              className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition disabled:opacity-60"
            />
          </div>
        </div>

        <div className="bg-muted rounded-xl px-4 py-3 text-xs text-muted-foreground">
          Ejemplo: a un cliente le generamos el cupón <strong className="text-foreground">{dias} día{dias === 1 ? '' : 's'}</strong> antes
          de su cumpleaños, con <strong className="text-foreground">{form.cumple_tipo === 'porcentaje' ? `${valor}%` : `Bs ${valor.toFixed(2)}`}</strong> de
          descuento, y le queda válido durante <strong className="text-foreground">{vigencia} día{vigencia === 1 ? '' : 's'}</strong> desde que se genera.
        </div>

        <p className="text-xs text-muted-foreground">
          El cliente necesita tener su fecha de nacimiento cargada en <span className="font-medium text-foreground">Clientes</span> para poder recibir el cupón.
        </p>

        {puedeEditar ? (
          <div className="flex items-center gap-4 pt-1">
            <button
              onClick={guardarCumpleanos}
              disabled={guardar.isPending}
              className="px-6 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-sm font-semibold transition-colors disabled:opacity-60"
            >
              {guardar.isPending ? 'Guardando...' : 'Guardar cambios'}
            </button>
            {guardado && (
              <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-sm font-medium">
                <CheckCircle2 className="w-4 h-4" /> Guardado correctamente
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No tienes permiso para editar la configuración.</p>
        )}
      </div>
    </SettingsCard>
  );
}

/* ─── Tab Ruleta ─────────────────────────────────────────────────────────── */

function TabRuleta({ puedeEditar }) {
  const qc = useQueryClient();
  const [guardado, setGuardado] = useState(false);

  const { data: config = {}, isLoading } = useQuery({
    queryKey: ['configuracion'],
    queryFn: getConfiguracion,
  });

  const [form, setForm] = useState(null);

  if (!isLoading && form === null) {
    setForm({
      ruleta_activa:               config.ruleta_activa === 'true',
      ruleta_costo_puntos:         config.ruleta_costo_puntos ?? '10',
      ruleta_max_giros_periodo:    config.ruleta_max_giros_periodo ?? '1',
      ruleta_periodo:              config.ruleta_periodo ?? 'dia',
      ruleta_vigencia_dias_premio: config.ruleta_vigencia_dias_premio ?? '7',
    });
  }

  const guardar = useMutation({
    mutationFn: (datos) => actualizarConfiguracion(datos),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['configuracion'] });
      setGuardado(true);
      setTimeout(() => setGuardado(false), 2500);
    },
  });

  function set(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function guardarRuleta() {
    guardar.mutate({
      ruleta_activa: form.ruleta_activa ? 'true' : 'false',
      ruleta_costo_puntos: form.ruleta_costo_puntos,
      ruleta_max_giros_periodo: form.ruleta_max_giros_periodo,
      ruleta_periodo: form.ruleta_periodo,
      ruleta_vigencia_dias_premio: form.ruleta_vigencia_dias_premio,
    });
  }

  if (isLoading || form === null) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-8">
        <RefreshCw className="w-4 h-4 animate-spin" /><span className="text-sm">Cargando...</span>
      </div>
    );
  }

  const costo = parseInt(form.ruleta_costo_puntos, 10) || 0;
  const maxGiros = parseInt(form.ruleta_max_giros_periodo, 10) || 0;

  return (
    <SettingsCard>
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => puedeEditar && set('ruleta_activa', !form.ruleta_activa)}
            disabled={!puedeEditar}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-60 ${form.ruleta_activa ? 'bg-emerald-500' : 'bg-muted'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${form.ruleta_activa ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
          <div>
            <p className="text-sm font-semibold text-foreground">Ruleta de premios activa</p>
            <p className="text-xs text-muted-foreground">
              Permite a los clientes canjear puntos de fidelidad por un giro, desde Ruleta → Girar en el menú.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              Costo por giro (puntos)
            </label>
            <input
              type="number" min="1" step="1"
              value={form.ruleta_costo_puntos}
              onChange={(e) => set('ruleta_costo_puntos', e.target.value)}
              disabled={!puedeEditar}
              className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition disabled:opacity-60"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              Vigencia del cupón ganado (días)
            </label>
            <input
              type="number" min="1" step="1"
              value={form.ruleta_vigencia_dias_premio}
              onChange={(e) => set('ruleta_vigencia_dias_premio', e.target.value)}
              disabled={!puedeEditar}
              className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition disabled:opacity-60"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Máx. giros por</label>
            <div className="grid grid-cols-2 gap-2">
              {[{ id: 'dia', label: 'Día' }, { id: 'semana', label: 'Semana' }].map((p) => (
                <button
                  key={p.id} type="button"
                  onClick={() => puedeEditar && set('ruleta_periodo', p.id)}
                  disabled={!puedeEditar}
                  className={`py-2.5 rounded-xl text-sm font-medium border transition-colors disabled:opacity-60 ${
                    form.ruleta_periodo === p.id ? 'bg-primary border-primary text-primary-foreground' : 'border-input text-muted-foreground hover:border-primary/50'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Giros máximos</label>
            <input
              type="number" min="1" step="1"
              value={form.ruleta_max_giros_periodo}
              onChange={(e) => set('ruleta_max_giros_periodo', e.target.value)}
              disabled={!puedeEditar}
              className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition disabled:opacity-60"
            />
          </div>
        </div>

        <div className="bg-muted rounded-xl px-4 py-3 text-xs text-muted-foreground">
          Ejemplo: cada giro cuesta <strong className="text-foreground">{costo} punto{costo === 1 ? '' : 's'}</strong>, un
          mismo cliente puede girar hasta <strong className="text-foreground">{maxGiros} {maxGiros === 1 ? 'vez' : 'veces'}</strong> por {form.ruleta_periodo === 'semana' ? 'semana' : 'día'},
          y el cupón que gane queda válido <strong className="text-foreground">{parseInt(form.ruleta_vigencia_dias_premio, 10) || 0} días</strong>.
        </div>

        <p className="text-xs text-muted-foreground">
          Los premios de la ruleta (qué se puede ganar y con qué probabilidad) se configuran en <span className="font-medium text-foreground">Ruleta → Premios</span>, en el menú.
        </p>

        {puedeEditar ? (
          <div className="flex items-center gap-4 pt-1">
            <button
              onClick={guardarRuleta}
              disabled={guardar.isPending}
              className="px-6 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-sm font-semibold transition-colors disabled:opacity-60"
            >
              {guardar.isPending ? 'Guardando...' : 'Guardar cambios'}
            </button>
            {guardado && (
              <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-sm font-medium">
                <CheckCircle2 className="w-4 h-4" /> Guardado correctamente
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No tienes permiso para editar la configuración.</p>
        )}
      </div>
    </SettingsCard>
  );
}

/* ─── Tab Áreas ─────────────────────────────────────────────────────────── */

function TabAreas({ puedeEditar }) {
  const qc = useQueryClient();
  const [modal, setModal] = useState(null); // null | { modo: 'crear'|'editar', area? }
  const [confirmEliminar, setConfirmEliminar] = useState(null);

  const { data: areas = [], isLoading } = useQuery({ queryKey: ['areas'], queryFn: getAreas });

  const guardar = useMutation({
    mutationFn: ({ area, datos }) =>
      area ? actualizarArea(area.id, datos) : crearArea(datos),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['areas'] }); setModal(null); },
  });

  const eliminar = useMutation({
    mutationFn: (id) => eliminarArea(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['areas'] }); setConfirmEliminar(null); },
  });

  return (
    <SettingsCard
      toolbar={
        <>
          <p className="text-sm text-muted-foreground">{areas.length} área(s) registrada(s)</p>
          {puedeEditar && (
            <button
              onClick={() => setModal({ modo: 'crear' })}
              className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-sm font-medium transition-colors"
            >
              <Plus className="w-4 h-4" /> Nueva Área
            </button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <RefreshCw className="w-4 h-4 animate-spin" /><span className="text-sm">Cargando...</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {areas.map(area => (
            <div
              key={area.id}
              className="bg-background border border-border rounded-xl p-4 flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 bg-primary/10 rounded-lg flex items-center justify-center shrink-0">
                  <Building2 className="w-4 h-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-foreground truncate">{area.nombre}</p>
                  <p className="text-xs text-muted-foreground">{area.mesas?.length ?? 0} mesa(s)</p>
                </div>
              </div>
              {puedeEditar && (
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => setModal({ modo: 'editar', area })}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setConfirmEliminar(area)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {!isLoading && areas.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40 gap-2 text-muted-foreground">
            <Building2 className="w-8 h-8" />
            <p className="text-sm">No hay áreas. Crea la primera.</p>
          </div>
        )}
      </div>

      {/* Modal crear/editar */}
      {modal && (
        <FormAreaModal
          area={modal.area}
          onClose={() => setModal(null)}
          onGuardar={(datos) => guardar.mutate({ area: modal.area, datos })}
          guardando={guardar.isPending}
          error={guardar.error?.response?.data?.mensaje}
        />
      )}

      {/* Confirmar eliminar */}
      {confirmEliminar && (
        <Modal titulo="Eliminar Área" onClose={() => setConfirmEliminar(null)}>
          <p className="text-sm text-muted-foreground mb-4">
            ¿Eliminar el área <strong>{confirmEliminar.nombre}</strong>? Solo se puede si no tiene mesas asignadas.
          </p>
          {eliminar.error && (
            <p className="text-sm text-destructive mb-3">{eliminar.error?.response?.data?.mensaje ?? 'Error al eliminar'}</p>
          )}
          <div className="flex justify-end gap-3">
            <button onClick={() => setConfirmEliminar(null)} className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors">
              Cancelar
            </button>
            <button
              onClick={() => eliminar.mutate(confirmEliminar.id)}
              disabled={eliminar.isPending}
              className="px-4 py-2 rounded-xl text-sm bg-destructive hover:bg-destructive/90 text-destructive-foreground transition-colors disabled:opacity-60"
            >
              {eliminar.isPending ? 'Eliminando...' : 'Eliminar'}
            </button>
          </div>
        </Modal>
      )}
    </SettingsCard>
  );
}

function FormAreaModal({ area, onClose, onGuardar, guardando, error }) {
  const [nombre, setNombre] = useState(area?.nombre ?? '');
  return (
    <Modal titulo={area ? 'Editar Área' : 'Nueva Área'} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
            Nombre del área
          </label>
          <input
            autoFocus
            value={nombre}
            onChange={e => setNombre(e.target.value)}
            placeholder="Ej: Salón Principal, Terraza, Bar"
            className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors">
            Cancelar
          </button>
          <button
            onClick={() => onGuardar({ nombre })}
            disabled={guardando || !nombre.trim()}
            className="px-4 py-2 rounded-xl text-sm bg-primary hover:bg-primary/90 text-primary-foreground transition-colors disabled:opacity-60"
          >
            {guardando ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ─── Tab Mesas ──────────────────────────────────────────────────────────── */

const ESTADOS_MESA = ['disponible', 'reservada'];

function TabMesas({ puedeEditar }) {
  const qc = useQueryClient();
  const [modal, setModal] = useState(null);
  const [confirmEliminar, setConfirmEliminar] = useState(null);
  const [filtroArea, setFiltroArea] = useState('');

  const { data: areas = [] } = useQuery({ queryKey: ['areas'], queryFn: getAreas });
  const { data: mesas = [], isLoading } = useQuery({ queryKey: ['mesas'], queryFn: () => getMesas() });

  const mesasFiltradas = filtroArea
    ? mesas.filter(m => String(m.area_id) === filtroArea)
    : mesas;

  const guardar = useMutation({
    mutationFn: ({ mesa, datos }) =>
      mesa ? actualizarMesa(mesa.id, datos) : crearMesa(datos),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['mesas'] }); setModal(null); },
  });

  const eliminar = useMutation({
    mutationFn: (id) => eliminarMesa(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['mesas'] }); setConfirmEliminar(null); },
  });

  // Agrupar por área si no hay filtro
  const porArea = mesasFiltradas.reduce((acc, m) => {
    const key = m.area?.nombre ?? 'Sin área';
    if (!acc[key]) acc[key] = [];
    acc[key].push(m);
    return acc;
  }, {});

  return (
    <SettingsCard
      toolbar={
        <>
          <p className="text-sm text-muted-foreground">{mesasFiltradas.length} mesa(s)</p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={filtroArea}
              onChange={e => setFiltroArea(e.target.value)}
              className="bg-background border border-input rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Todas las áreas</option>
              {areas.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </select>
            {puedeEditar && (
              <button
                onClick={() => setModal({ modo: 'crear' })}
                disabled={areas.length === 0}
                className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground rounded-xl text-sm font-medium transition-colors"
                title={areas.length === 0 ? 'Primero crea un área' : ''}
              >
                <Plus className="w-4 h-4" /> Nueva Mesa
              </button>
            )}
          </div>
        </>
      }
    >
      <div className="space-y-4">
        {isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <RefreshCw className="w-4 h-4 animate-spin" /><span className="text-sm">Cargando...</span>
          </div>
        )}

        {!isLoading && mesasFiltradas.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40 gap-2 text-muted-foreground">
            <Grid3x3 className="w-8 h-8" />
            <p className="text-sm">
              {areas.length === 0 ? 'Primero crea un área en la pestaña Áreas.' : 'No hay mesas. Crea la primera.'}
            </p>
          </div>
        )}

        {Object.entries(porArea).map(([areaNombre, mesasGrupo]) => (
          <section key={areaNombre}>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{areaNombre}</h3>
            <div className="bg-background border border-border rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Nombre</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Asientos</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Estado</th>
                      {puedeEditar && <th className="px-4 py-3 w-20" />}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {mesasGrupo.map(mesa => (
                      <tr key={mesa.id} className="hover:bg-muted/50 transition-colors">
                        <td className="px-4 py-3 font-medium text-foreground">{mesa.nombre}</td>
                        <td className="px-4 py-3 text-muted-foreground">
                          <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{mesa.asientos}</span>
                        </td>
                        <td className="px-4 py-3">
                          <EstadoBadge estado={mesa.estado} />
                        </td>
                        {puedeEditar && (
                          <td className="px-4 py-3">
                            <div className="flex gap-1 justify-end">
                              <button
                                onClick={() => setModal({ modo: 'editar', mesa })}
                                className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setConfirmEliminar(mesa)}
                                disabled={mesa.estado === 'ocupada'}
                                className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        ))}
      </div>

      {/* Modal crear/editar mesa */}
      {modal && (
        <FormMesaModal
          mesa={modal.mesa}
          areas={areas}
          onClose={() => setModal(null)}
          onGuardar={(datos) => guardar.mutate({ mesa: modal.mesa, datos })}
          guardando={guardar.isPending}
          error={guardar.error?.response?.data?.mensaje}
        />
      )}

      {/* Confirmar eliminar */}
      {confirmEliminar && (
        <Modal titulo="Eliminar Mesa" onClose={() => setConfirmEliminar(null)}>
          <p className="text-sm text-muted-foreground mb-4">
            ¿Eliminar la mesa <strong>{confirmEliminar.nombre}</strong>?
          </p>
          {eliminar.error && (
            <p className="text-sm text-destructive mb-3">{eliminar.error?.response?.data?.mensaje ?? 'Error al eliminar'}</p>
          )}
          <div className="flex justify-end gap-3">
            <button onClick={() => setConfirmEliminar(null)} className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors">
              Cancelar
            </button>
            <button
              onClick={() => eliminar.mutate(confirmEliminar.id)}
              disabled={eliminar.isPending}
              className="px-4 py-2 rounded-xl text-sm bg-destructive hover:bg-destructive/90 text-destructive-foreground transition-colors disabled:opacity-60"
            >
              {eliminar.isPending ? 'Eliminando...' : 'Eliminar'}
            </button>
          </div>
        </Modal>
      )}
    </SettingsCard>
  );
}

function FormMesaModal({ mesa, areas, onClose, onGuardar, guardando, error }) {
  const [form, setForm] = useState({
    area_id: mesa?.area_id ?? (areas[0]?.id ?? ''),
    nombre: mesa?.nombre ?? '',
    asientos: mesa?.asientos ?? 4,
    estado: mesa?.estado ?? 'disponible',
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <Modal titulo={mesa ? 'Editar Mesa' : 'Nueva Mesa'} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Área</label>
          <select
            value={form.area_id}
            onChange={e => set('area_id', e.target.value)}
            className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {areas.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Nombre</label>
          <input
            autoFocus
            value={form.nombre}
            onChange={e => set('nombre', e.target.value)}
            placeholder="Ej: Mesa 1, Barra 2, VIP"
            className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Asientos</label>
          <input
            type="number"
            min={1}
            max={20}
            value={form.asientos}
            onChange={e => set('asientos', parseInt(e.target.value) || 1)}
            className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
          />
        </div>
        {mesa && (
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Estado</label>
            <select
              value={form.estado}
              onChange={e => set('estado', e.target.value)}
              className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {ESTADOS_MESA.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors">
            Cancelar
          </button>
          <button
            onClick={() => onGuardar(form)}
            disabled={guardando || !form.nombre.trim() || !form.area_id}
            className="px-4 py-2 rounded-xl text-sm bg-primary hover:bg-primary/90 text-primary-foreground transition-colors disabled:opacity-60"
          >
            {guardando ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function EstadoBadge({ estado }) {
  const cfg = {
    disponible: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    ocupada:    'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
    reservada:  'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  }[estado] ?? 'bg-muted text-muted-foreground';
  return (
    <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full ${cfg}`}>
      {estado}
    </span>
  );
}
