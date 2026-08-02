import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../hooks/useTheme';
import { useNavigate, Link } from 'react-router-dom';
import { Menu, LogOut, Sun, Moon } from 'lucide-react';
import api from '../../api/cliente';
import { avatarSrc } from '../../api/perfil';

function Iniciales(nombre) {
  return (nombre || '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('') || '?';
}

export default function Topbar({ onToggleSidebar }) {
  const { usuario, logout } = useAuth();
  const { modo, toggleModo } = useTheme();
  const navigate = useNavigate();

  async function handleLogout() {
    try {
      await api.post('/auth/logout');
    } catch {
      // ignorar errores de red al cerrar sesión
    }
    logout();
    navigate('/login');
  }

  return (
    <header className="h-14 bg-card border-b border-border flex items-center justify-between px-4 shrink-0 transition-colors">
      {/* Botón hamburguesa — todos los tamaños */}
      <button
        onClick={onToggleSidebar}
        title="Menú"
        className="p-2 rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Controles derecha */}
      <div className="flex items-center gap-2">
        <button
          onClick={toggleModo}
          title={modo === 'dark' ? 'Modo claro' : 'Modo oscuro'}
          className="p-2 rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          {modo === 'dark'
            ? <Sun className="w-4 h-4" />
            : <Moon className="w-4 h-4" />
          }
        </button>

        <div className="w-px h-5 bg-border" />

        <Link
          to="/perfil"
          className="flex items-center gap-2.5 px-1 group cursor-pointer"
          title="Ver mi perfil"
        >
          <div className="text-right">
            <p className="text-sm font-semibold text-foreground group-hover:text-primary leading-tight transition-colors">{usuario?.nombre}</p>
            <p className="text-xs text-muted-foreground leading-tight">
              {usuario?.rol}
              {usuario?.rol && usuario?.sucursal_activa && ' · '}
              {usuario?.sucursal_activa?.nombre}
            </p>
          </div>
          {usuario?.avatar ? (
            <img
              src={avatarSrc(usuario.avatar)}
              alt={usuario.nombre}
              className="w-8 h-8 rounded-full object-cover border border-border shrink-0"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-primary/10 border border-border flex items-center justify-center text-xs font-bold text-primary shrink-0">
              {Iniciales(usuario?.nombre)}
            </div>
          )}
        </Link>

        <button
          onClick={handleLogout}
          title="Cerrar sesión"
          className="p-2 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
