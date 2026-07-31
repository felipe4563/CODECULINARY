import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getConfiguracionPublica } from '../../api/configuracion';
import { hexToHslTriplet } from '../../lib/color';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const STYLE_ID = 'brand-theme-vars';

// Sobreescribe --primary/--accent con el color de marca del restaurante (si
// lo configuró en Configuración > Negocio), inyectando un <style> con reglas
// separadas para modo claro y oscuro (para no pisar la paleta oscura de
// src/index.css con un valor pensado para modo claro). Si no hay nada
// configurado, no toca nada y queda la paleta neutra por defecto.
export default function BrandTheme() {
  const { data } = useQuery({
    queryKey: ['configuracion-publica'],
    queryFn: getConfiguracionPublica,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    const rules = [];

    if (HEX_RE.test(data?.color_primario ?? '')) {
      rules.push(buildRule('--primary', data.color_primario));
    }
    if (HEX_RE.test(data?.color_secundario ?? '')) {
      rules.push(buildRule('--accent', data.color_secundario));
    }

    let styleEl = document.getElementById(STYLE_ID);

    if (rules.length === 0) {
      styleEl?.remove();
      return;
    }

    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = STYLE_ID;
      document.head.appendChild(styleEl);
    }

    const lightVars = rules.map(r => `${r.varName}: ${r.lightTriplet}; ${r.varName}-foreground: ${r.lightForeground};`).join(' ');
    const darkVars = rules.map(r => `${r.varName}: ${r.darkTriplet}; ${r.varName}-foreground: ${r.darkForeground};`).join(' ');

    styleEl.textContent = `:root:not(.dark) { ${lightVars} } .dark { ${darkVars} }`;
  }, [data]);

  return null;
}

function buildRule(varName, hex) {
  const lightTriplet = hexToHslTriplet(hex);
  const darkTriplet = withBoostedLightness(lightTriplet);
  return {
    varName,
    lightTriplet,
    darkTriplet,
    lightForeground: foregroundFor(lightTriplet),
    darkForeground: foregroundFor(darkTriplet),
  };
}

function withBoostedLightness(triplet, delta = 20, cap = 65) {
  const [h, s, l] = triplet.split(' ');
  const lightness = parseInt(l, 10);
  const boosted = Math.min(lightness + delta, cap);
  return `${h} ${s} ${boosted}%`;
}

function foregroundFor(triplet) {
  const l = parseInt(triplet.split(' ')[2], 10);
  return l > 60 ? '240 10% 12%' : '0 0% 100%';
}
