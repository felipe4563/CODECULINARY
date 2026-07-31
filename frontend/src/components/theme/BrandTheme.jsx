import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getConfiguracionPublica } from '../../api/configuracion';
import { hexToHslTriplet } from '../../lib/color';

// Sobreescribe --primary/--secondary en :root con el color de marca del
// restaurante (si lo configuró en Configuración > Negocio). Si no hay
// nada configurado, no toca nada y queda la paleta neutra por defecto
// definida en src/index.css.
export default function BrandTheme() {
  const { data } = useQuery({
    queryKey: ['configuracion-publica'],
    queryFn: getConfiguracionPublica,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    const root = document.documentElement;
    if (data?.color_primario) {
      root.style.setProperty('--primary', hexToHslTriplet(data.color_primario));
    }
    if (data?.color_secundario) {
      root.style.setProperty('--secondary', hexToHslTriplet(data.color_secundario));
    }
  }, [data]);

  return null;
}
