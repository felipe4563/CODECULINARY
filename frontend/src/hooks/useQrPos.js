import { useQuery } from '@tanstack/react-query';
import { getConfiguracionPublica } from '../api/configuracion';

// Config del cobro QR del POS. Se lee de la config pública porque el cajero
// puede no tener permiso de ver Configuración (ver migración 052).
export function useQrPos() {
  const { data: config = {} } = useQuery({
    queryKey: ['configuracion-publica'],
    queryFn: getConfiguracionPublica,
    staleTime: 60_000,
  });
  return {
    manual: config.qr_pos_modo === 'manual',
    imagen: config.qr_pago_imagen,
    texto: config.qr_pago_texto,
  };
}
