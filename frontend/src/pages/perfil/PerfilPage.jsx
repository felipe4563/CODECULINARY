import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { User, Lock, CheckCircle2, Eye, EyeOff, AlertCircle, Camera, X, RefreshCw } from 'lucide-react';
import { getPerfil, actualizarPerfil, cambiarContrasena, subirAvatar, avatarSrc } from '../../api/perfil';
import { useAuthStore } from '../../store/authStore';

function Alert({ tipo, mensaje }) {
  if (!mensaje) return null;
  const esError = tipo === 'error';
  return (
    <div className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm ${
      esError
        ? 'bg-destructive/10 border border-destructive/30 text-destructive'
        : 'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/40 text-emerald-700 dark:text-emerald-400'
    }`}>
      {esError
        ? <AlertCircle className="w-4 h-4 shrink-0" />
        : <CheckCircle2 className="w-4 h-4 shrink-0" />
      }
      {mensaje}
    </div>
  );
}

function PasswordInput({ label, value, onChange, name, placeholder }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-muted-foreground">{label}</label>
      <div className="relative">
        <input
          type={visible ? 'text' : 'password'}
          name={name}
          value={value}
          onChange={onChange}
          placeholder={placeholder ?? '••••••••'}
          autoComplete="new-password"
          className="w-full bg-background border border-input rounded-xl px-4 py-2.5 pr-11 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setVisible((v) => !v)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        >
          {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

function SettingsSection({ titulo, descripcion, Icono, children }) {
  return (
    <div className="bg-card border border-border rounded-2xl shadow-sm p-5 sm:p-6 space-y-4">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <Icono className="w-4 h-4 text-primary" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-foreground">{titulo}</h2>
          {descripcion && <p className="text-xs text-muted-foreground">{descripcion}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

function Iniciales(nombre) {
  return (nombre || '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('') || '?';
}

export default function PerfilPage() {
  const updateUsuario = useAuthStore((s) => s.updateUsuario);
  const qc = useQueryClient();
  const avatarRef = useRef(null);

  const { data: perfil, isLoading } = useQuery({
    queryKey: ['perfil'],
    queryFn: getPerfil,
    staleTime: 60_000,
  });

  // --- Foto de perfil ---
  const [subiendoAvatar, setSubiendoAvatar] = useState(false);
  const [errorAvatar, setErrorAvatar] = useState('');

  const mutAvatar = useMutation({
    mutationFn: (avatar) => actualizarPerfil({ avatar }),
    onSuccess: (actualizado) => {
      updateUsuario({ avatar: actualizado.avatar });
      qc.setQueryData(['perfil'], actualizado);
    },
    onError: () => setErrorAvatar('No se pudo guardar la foto. Intenta de nuevo.'),
  });

  async function handleAvatar(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorAvatar('');
    setSubiendoAvatar(true);
    try {
      const url = await subirAvatar(file);
      mutAvatar.mutate(url);
    } catch {
      setErrorAvatar('Error al subir la imagen. Intenta de nuevo.');
    } finally {
      setSubiendoAvatar(false);
      e.target.value = '';
    }
  }

  function quitarAvatar() {
    mutAvatar.mutate('');
  }

  // --- Sección datos personales ---
  const [form, setForm] = useState(null);
  const [alerta, setAlerta] = useState({ tipo: '', msg: '' });

  if (!isLoading && form === null && perfil) {
    setForm({ nombre: perfil.nombre ?? '', email: perfil.email ?? '' });
  }

  const mutDatos = useMutation({
    mutationFn: actualizarPerfil,
    onSuccess: (actualizado) => {
      updateUsuario({ nombre: actualizado.nombre, email: actualizado.email });
      qc.setQueryData(['perfil'], actualizado);
      setAlerta({ tipo: 'ok', msg: 'Datos actualizados correctamente' });
      setTimeout(() => setAlerta({ tipo: '', msg: '' }), 3000);
    },
    onError: (err) => {
      setAlerta({ tipo: 'error', msg: err.response?.data?.mensaje ?? 'Error al actualizar' });
    },
  });

  function handleDatos(e) {
    e.preventDefault();
    setAlerta({ tipo: '', msg: '' });
    mutDatos.mutate({ nombre: form.nombre, email: form.email });
  }

  // --- Sección cambio de contraseña ---
  const [pwd, setPwd] = useState({ contrasena_actual: '', nueva_contrasena: '', confirmar: '' });
  const [alertaPwd, setAlertaPwd] = useState({ tipo: '', msg: '' });

  const mutPwd = useMutation({
    mutationFn: cambiarContrasena,
    onSuccess: () => {
      setPwd({ contrasena_actual: '', nueva_contrasena: '', confirmar: '' });
      setAlertaPwd({ tipo: 'ok', msg: 'Contraseña cambiada correctamente' });
      setTimeout(() => setAlertaPwd({ tipo: '', msg: '' }), 3000);
    },
    onError: (err) => {
      setAlertaPwd({ tipo: 'error', msg: err.response?.data?.mensaje ?? 'Error al cambiar contraseña' });
    },
  });

  function handlePwd(e) {
    e.preventDefault();
    setAlertaPwd({ tipo: '', msg: '' });
    if (pwd.nueva_contrasena !== pwd.confirmar) {
      setAlertaPwd({ tipo: 'error', msg: 'Las contraseñas nuevas no coinciden' });
      return;
    }
    if (pwd.nueva_contrasena.length < 6) {
      setAlertaPwd({ tipo: 'error', msg: 'La nueva contraseña debe tener al menos 6 caracteres' });
      return;
    }
    mutPwd.mutate({ contrasena_actual: pwd.contrasena_actual, nueva_contrasena: pwd.nueva_contrasena });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto space-y-4">
      {/* Header con foto de perfil */}
      <div className="bg-card border border-border rounded-2xl shadow-sm p-5 sm:p-6 flex items-center gap-4">
        <div className="relative shrink-0">
          {perfil?.avatar ? (
            <img
              src={avatarSrc(perfil.avatar)}
              alt={perfil.nombre}
              className="w-20 h-20 rounded-full object-cover border border-border"
            />
          ) : (
            <div className="w-20 h-20 rounded-full bg-primary/10 border border-border flex items-center justify-center text-xl font-bold text-primary">
              {subiendoAvatar ? <RefreshCw className="w-6 h-6 animate-spin" /> : Iniciales(perfil?.nombre)}
            </div>
          )}

          <button
            onClick={() => avatarRef.current?.click()}
            disabled={subiendoAvatar}
            title="Cambiar foto"
            className="absolute -bottom-1 -right-1 w-7 h-7 bg-primary hover:bg-primary/90 text-primary-foreground rounded-full flex items-center justify-center shadow-sm disabled:opacity-60"
          >
            <Camera className="w-3.5 h-3.5" />
          </button>

          {perfil?.avatar && (
            <button
              onClick={quitarAvatar}
              disabled={subiendoAvatar}
              title="Quitar foto"
              className="absolute -top-1 -right-1 w-5 h-5 bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-full flex items-center justify-center disabled:opacity-60"
            >
              <X className="w-3 h-3" />
            </button>
          )}

          <input ref={avatarRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleAvatar} />
        </div>

        <div className="min-w-0">
          <h1 className="text-lg font-bold text-foreground truncate">{perfil?.nombre}</h1>
          <p className="text-sm text-muted-foreground truncate">{perfil?.email}</p>
          <span className="inline-block mt-1.5 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium">
            {perfil?.rol?.nombre ?? '—'}
          </span>
          {errorAvatar && <p className="text-xs text-destructive mt-1">{errorAvatar}</p>}
        </div>
      </div>

      {/* Datos personales */}
      <SettingsSection titulo="Datos personales" Icono={User}>
        <form onSubmit={handleDatos} className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-muted-foreground">Nombre</label>
            <input
              type="text"
              value={form?.nombre ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
              required
              placeholder="Tu nombre completo"
              className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-muted-foreground">Correo electrónico</label>
            <input
              type="email"
              value={form?.email ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              required
              placeholder="correo@ejemplo.com"
              className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
            />
          </div>

          <Alert tipo={alerta.tipo} mensaje={alerta.msg} />

          <div className="flex justify-end pt-1">
            <button
              type="submit"
              disabled={mutDatos.isPending}
              className="bg-primary hover:bg-primary/90 disabled:opacity-60 text-primary-foreground text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors"
            >
              {mutDatos.isPending ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </SettingsSection>

      {/* Cambiar contraseña */}
      <SettingsSection titulo="Seguridad" descripcion="Cambia tu contraseña de acceso" Icono={Lock}>
        <form onSubmit={handlePwd} className="space-y-4">
          <PasswordInput
            label="Contraseña actual"
            name="contrasena_actual"
            value={pwd.contrasena_actual}
            onChange={(e) => setPwd((p) => ({ ...p, contrasena_actual: e.target.value }))}
          />
          <PasswordInput
            label="Nueva contraseña"
            name="nueva_contrasena"
            value={pwd.nueva_contrasena}
            onChange={(e) => setPwd((p) => ({ ...p, nueva_contrasena: e.target.value }))}
            placeholder="Mínimo 6 caracteres"
          />
          <PasswordInput
            label="Confirmar nueva contraseña"
            name="confirmar"
            value={pwd.confirmar}
            onChange={(e) => setPwd((p) => ({ ...p, confirmar: e.target.value }))}
          />

          <Alert tipo={alertaPwd.tipo} mensaje={alertaPwd.msg} />

          <div className="flex justify-end pt-1">
            <button
              type="submit"
              disabled={mutPwd.isPending || !pwd.contrasena_actual || !pwd.nueva_contrasena || !pwd.confirmar}
              className="bg-primary hover:bg-primary/90 disabled:opacity-60 text-primary-foreground text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors"
            >
              {mutPwd.isPending ? 'Cambiando...' : 'Cambiar contraseña'}
            </button>
          </div>
        </form>
      </SettingsSection>
    </div>
  );
}
