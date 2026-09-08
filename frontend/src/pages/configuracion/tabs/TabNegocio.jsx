import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, CheckCircle2, Store, Upload, X } from 'lucide-react';
import { getConfiguracion, actualizarConfiguracion, subirLogo, logoSrc } from '../../../api/configuracion';
import { SettingsSection } from '../shared';

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

export default function TabNegocio({ puedeEditar }) {
  const qc = useQueryClient();
  const logoRef = useRef(null);
  const portadaRef = useRef(null);
  const [guardado, setGuardado] = useState(false);
  const [subiendoLogo, setSubiendoLogo] = useState(false);
  const [errorLogo, setErrorLogo] = useState('');
  const [subiendoPortada, setSubiendoPortada] = useState(false);
  const [errorPortada, setErrorPortada] = useState('');

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
      portada:        config.portada        ?? '',
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

  async function handlePortada(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorPortada('');
    setSubiendoPortada(true);
    try {
      const url = await subirLogo(file);
      set('portada', url);
    } catch {
      setErrorPortada('Error al subir la imagen. Intenta de nuevo.');
    } finally {
      setSubiendoPortada(false);
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

      <SettingsSection titulo="Portada" descripcion="Banner del negocio que se muestra en la app de pedidos externa">
        <div className="space-y-3">
          {form.portada ? (
            <div className="relative">
              <img
                src={logoSrc(form.portada)}
                alt="Portada"
                className="w-full max-w-md h-32 object-cover rounded-xl border border-border"
              />
              {puedeEditar && (
                <button
                  onClick={() => set('portada', '')}
                  className="absolute -top-2 -right-2 w-5 h-5 bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-full flex items-center justify-center"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          ) : (
            <div className="w-full max-w-md h-32 rounded-xl border-2 border-dashed border-input flex items-center justify-center text-muted-foreground">
              {subiendoPortada ? <RefreshCw className="w-6 h-6 animate-spin" /> : <Store className="w-8 h-8" />}
            </div>
          )}
          {puedeEditar && (
            <div className="space-y-1.5">
              <button
                onClick={() => portadaRef.current?.click()}
                disabled={subiendoPortada}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-60"
              >
                <Upload className="w-4 h-4" />
                {subiendoPortada ? 'Subiendo...' : form.portada ? 'Cambiar portada' : 'Subir portada'}
              </button>
              <p className="text-xs text-muted-foreground">PNG, JPG o WebP · máx. 5MB · ideal formato horizontal (ej. 1200x400).</p>
              {errorPortada && <p className="text-xs text-destructive">{errorPortada}</p>}
              <input ref={portadaRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handlePortada} />
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
