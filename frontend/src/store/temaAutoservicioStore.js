import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Store de tema separado del staff (themeStore.js): la mesa del cliente y el
// POS del mozo/cajero pueden compartir el mismo navegador durante pruebas,
// pero son audiencias distintas — cambiar el tema en uno no debe cambiar el
// otro. Clave de localStorage propia ('tema-autoservicio') para no pisar
// la preferencia guardada del staff.
export const useTemaAutoservicioStore = create(
  persist(
    (set) => ({
      modo: 'light',
      toggleModo: () =>
        set((s) => ({ modo: s.modo === 'light' ? 'dark' : 'light' })),
    }),
    { name: 'tema-autoservicio' }
  )
);
