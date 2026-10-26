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
// la elegida (o la primera sucursal si no hay una válida guardada).
export function useSucursalCatalogo() {
  const sucursalActivaId = useAuthStore((s) => s.usuario?.sucursal_activa?.id ?? null);
  const esGlobal = sucursalActivaId == null;
  const guardado = useCatalogoSucursalStore((s) => s.sucursalId);
  const setSucursalId = useCatalogoSucursalStore((s) => s.setSucursalId);

  const { data: sucursales = [] } = useQuery({
    queryKey: ['sucursales'],
    queryFn: getSucursales,
    enabled: esGlobal,
  });

  if (!esGlobal) return { sucursalId: sucursalActivaId, esGlobal, setSucursalId };

  const valido = sucursales.some((s) => s.id === guardado);
  const sucursalId = valido ? guardado : (sucursales[0]?.id ?? null);
  return { sucursalId, esGlobal, setSucursalId };
}
