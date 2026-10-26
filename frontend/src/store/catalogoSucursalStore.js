import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from './authStore';
import { getSucursales } from '../api/sucursales';

// Sucursal elegida por un usuario global para ver/editar el catálogo.
export const useCatalogoSucursalStore = create(
  persist(
    (set) => ({
      sucursalId: null,
      setSucursalId: (sucursalId) => set({ sucursalId }),
    }),
    { name: 'catalogo-sucursal' }
  )
);

// Sucursal del catálogo: la propia para un usuario de sucursal; para un global,
// la elegida entre las activas (o la principal —la activa de menor id— si no
// hay una válida guardada). `sucursales` son las activas, para el selector.
export function useSucursalCatalogo() {
  const sucursalActivaId = useAuthStore((s) => s.usuario?.sucursal_activa?.id ?? null);
  const esGlobal = sucursalActivaId == null;
  const guardado = useCatalogoSucursalStore((s) => s.sucursalId);
  const setSucursalId = useCatalogoSucursalStore((s) => s.setSucursalId);

  const { data: todas = [] } = useQuery({
    queryKey: ['sucursales'],
    queryFn: getSucursales,
    enabled: esGlobal,
  });

  if (!esGlobal) return { sucursalId: sucursalActivaId, esGlobal, setSucursalId, sucursales: [] };

  const sucursales = todas.filter((s) => s.activo);
  const valido = sucursales.some((s) => s.id === guardado);
  const principal = sucursales.reduce((min, s) => (min == null || s.id < min ? s.id : min), null);
  const sucursalId = valido ? guardado : principal;
  return { sucursalId, esGlobal, setSucursalId, sucursales };
}
