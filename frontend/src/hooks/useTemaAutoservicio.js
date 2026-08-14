import { useEffect } from 'react';
import { useTemaAutoservicioStore } from '../store/temaAutoservicioStore';
import { useThemeStore } from '../store/themeStore';

// A diferencia de useTheme() (que sincroniza <html> con el store global del
// staff durante toda la sesión de la app), esta versión solo toma el control
// de <html> mientras la página pública de autoservicio está montada, y lo
// devuelve a la preferencia del staff al desmontarse — así, si el mismo
// navegador se usa para probar ambas pantallas, ninguna pisa a la otra.
export function useTemaAutoservicio() {
  const { modo, toggleModo } = useTemaAutoservicioStore();

  useEffect(() => {
    const root = document.documentElement;
    if (modo === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');

    return () => {
      const modoStaff = useThemeStore.getState().modo;
      if (modoStaff === 'dark') root.classList.add('dark');
      else root.classList.remove('dark');
    };
  }, [modo]);

  return { modo, toggleModo };
}
