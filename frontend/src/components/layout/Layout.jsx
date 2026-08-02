import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import ForzarCambioContrasena from './ForzarCambioContrasena';
import { useAuthStore } from '../../store/authStore';

export default function Layout() {
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const debeCambiarContrasena = useAuthStore((s) => s.usuario?.debe_cambiar_contrasena);

  return (
    <div className="flex h-screen bg-background overflow-hidden transition-colors">
      {debeCambiarContrasena && <ForzarCambioContrasena />}
      <Sidebar
        visible={sidebarVisible}
        onCerrar={() => setSidebarVisible(false)}
      />
      <div
        className={`flex-1 flex flex-col min-w-0 transition-[margin] duration-300 ease-in-out ${
          sidebarVisible ? 'md:ml-64' : 'md:ml-0'
        }`}
      >
        <Topbar onToggleSidebar={() => setSidebarVisible(v => !v)} />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>

      </div>
    </div>
  );
}
