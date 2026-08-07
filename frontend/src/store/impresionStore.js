import { create } from 'zustand';

// Cuando una venta genera ticket de caja Y de cocina por Bluetooth, caja se
// imprime automático y cocina queda "pendiente" acá hasta que alguien
// aprieta el botón (ver components/layout/BotonCocinaPendiente.jsx) — no se
// dispara solo, para que la persona tenga tiempo de cortar el papel del
// primer ticket sin ningún límite de tiempo ni depender de detectar que
// "volvió a la app" (poco confiable en algunos navegadores/dispositivos).
export const useImpresionStore = create((set) => ({
  cocinaPendiente: null, // datosCocina | null
  marcarCocinaPendiente: (datosCocina) => set({ cocinaPendiente: datosCocina }),
  limpiarCocinaPendiente: () => set({ cocinaPendiente: null }),
}));
