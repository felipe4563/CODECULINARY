import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Sesión del cliente en autoservicio (CI + PIN) — separada de todo lo
// demás: no es el login del staff, y no se comparte con el store de tema.
// Guarda solo el token; el nombre/puntos se piden en caliente vía
// /cliente/perfil cuando hace falta mostrarlos, para no cachear datos que
// puedan quedar viejos.
export const useClienteAutoservicioStore = create(
  persist(
    (set) => ({
      token: null,
      setToken: (token) => set({ token }),
      logout: () => set({ token: null }),
    }),
    { name: 'cliente-autoservicio' }
  )
);
