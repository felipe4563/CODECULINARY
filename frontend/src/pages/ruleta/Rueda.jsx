import { Disc3 } from 'lucide-react';
import { etiquetaValor, DURACION_GIRO_MS } from './ruedaUtils';

const LUCES = Array.from({ length: 16 }, (_, i) => i * (360 / 16));
const DURACION_GIRO_S = DURACION_GIRO_MS / 1000;

export function Rueda({ segmentos, rotacion, girando, compacto = false }) {
  const gradiente = segmentos.length === 0
    ? '#e5e7eb'
    : `conic-gradient(${segmentos.map((s) => `${s.color} ${s.anguloInicio}deg ${s.anguloInicio + s.anguloTam}deg`).join(', ')})`;

  return (
    <div className={`relative mx-auto shrink-0 ${compacto ? 'w-64 h-64 sm:w-80 sm:h-80' : 'w-72 h-72 sm:w-96 sm:h-96'}`}>
      <style>{`
        @keyframes ruleta-twinkle { 0%, 100% { opacity: .35; transform: scale(0.85); } 50% { opacity: 1; transform: scale(1.15); } }
        @keyframes ruleta-puntero { 0%, 100% { transform: translateX(-50%) rotate(0deg); } 50% { transform: translateX(-50%) rotate(-14deg); } }
        @keyframes ruleta-glow {
          0%, 100% { box-shadow: 0 0 0px 0px rgba(245,158,11,0.0); }
          50% { box-shadow: 0 0 28px 6px rgba(245,158,11,0.55); }
        }
      `}</style>

      {/* Aro decorativo con "focos" tipo feria, dan sensación de premio real */}
      <div
        className="absolute inset-0 rounded-full bg-gradient-to-br from-amber-300 via-yellow-400 to-amber-500 dark:from-amber-500 dark:via-yellow-500 dark:to-amber-700 shadow-2xl"
        style={{ animation: girando ? 'ruleta-glow 0.9s ease-in-out infinite' : 'none' }}
      >
        {LUCES.map((deg, i) => (
          <div
            key={deg}
            className="absolute left-1/2 top-1/2 w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-white shadow-[0_0_6px_2px_rgba(255,255,255,0.8)]"
            style={{
              transform: `rotate(${deg}deg) translate(0, -47%) translateX(-50%)`,
              transformOrigin: '0 0',
              animation: `ruleta-twinkle 1.6s ease-in-out ${(i % 4) * 0.2}s infinite`,
            }}
          />
        ))}
      </div>

      {/* puntero fijo, no gira — se sacude un poco mientras la ruleta gira */}
      <div
        className="absolute -top-1 left-1/2 z-20 origin-top"
        style={{ animation: girando ? 'ruleta-puntero 0.5s ease-in-out infinite' : 'none', transform: 'translateX(-50%)' }}
      >
        <div className="w-0 h-0 border-l-[11px] border-l-transparent border-r-[11px] border-r-transparent border-t-[20px] border-t-primary drop-shadow-lg" />
        <div className="w-3 h-3 rounded-full bg-primary mx-auto -mt-1 border-2 border-card shadow" />
      </div>

      <div className="absolute inset-[10px] sm:inset-3 rounded-full overflow-hidden">
        <div
          className="w-full h-full rounded-full border-4 border-card shadow-inner relative"
          style={{
            background: gradiente,
            transform: `rotate(${rotacion}deg)`,
            // Frenado puro por fricción (sin rebote): arranca rápido y va
            // perdiendo velocidad gradualmente hasta parar limpio, como una
            // ruleta física — sin "pasarse" del punto final.
            transition: girando ? `transform ${DURACION_GIRO_S}s cubic-bezier(0.16, 1, 0.3, 1)` : 'none',
          }}
        >
          {/* líneas divisoras entre segmentos — los nombres ya no van acá
              adentro (se cortaban / eran ilegibles), están en la leyenda */}
          {segmentos.map((s) => (
            <div
              key={`div-${s.id}`}
              className="absolute left-1/2 top-1/2 h-1/2 w-px bg-white/40"
              style={{ transform: `rotate(${s.anguloInicio}deg)`, transformOrigin: 'top' }}
            />
          ))}
        </div>
      </div>

      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        {!girando && (
          <div className="absolute w-11 h-11 rounded-full bg-primary/40 animate-ping" />
        )}
        <div className="relative w-11 h-11 rounded-full bg-card border-4 border-primary flex items-center justify-center shadow-lg">
          <Disc3 className={`w-4 h-4 text-primary ${girando ? 'animate-spin' : ''}`} />
        </div>
      </div>
    </div>
  );
}

// Leyenda de premios con su color — el nombre curvado sobre la rueda es
// difícil de leer cuando son largos, así que esto es la referencia clara.
export function LeyendaPremios({ segmentos }) {
  if (segmentos.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 w-full max-w-full">
      {segmentos.map((s) => (
        <div key={s.id} className="flex items-start gap-2 text-sm w-full">
          <span className="w-3.5 h-3.5 mt-0.5 rounded-full shrink-0 ring-2 ring-card shadow" style={{ backgroundColor: s.color }} />
          <span className="text-foreground font-medium break-words">
            {s.nombre}
            {s.tipo !== 'nada' && <span className="text-muted-foreground font-normal"> — {etiquetaValor(s)}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

const CONFETTI_COLORES = ['#ef4444', '#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899'];
const CONFETTI_PIEZAS = Array.from({ length: 20 }, (_, i) => ({
  id: i,
  left: Math.random() * 100,
  color: CONFETTI_COLORES[i % CONFETTI_COLORES.length],
  duracion: 1.4 + Math.random() * 1.2,
  retraso: Math.random() * 0.3,
  giro: Math.random() > 0.5 ? 360 : -360,
}));

// Confetti CSS puro, sin librerías — se dispara una sola vez al mostrar el
// resultado del giro cuando el cliente ganó un premio real (con cupón).
export function Confetti() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden z-10">
      <style>{`
        @keyframes ruleta-confetti-caer {
          0% { transform: translateY(-20px) rotate(0deg); opacity: 1; }
          100% { transform: translateY(220px) rotate(var(--giro)); opacity: 0; }
        }
        @keyframes ruleta-resultado-pop {
          0% { transform: scale(0.5); opacity: 0; }
          60% { transform: scale(1.1); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
      {CONFETTI_PIEZAS.map((p) => (
        <span
          key={p.id}
          className="absolute top-0 w-1.5 h-2.5 rounded-sm"
          style={{
            left: `${p.left}%`,
            backgroundColor: p.color,
            '--giro': `${p.giro}deg`,
            animation: `ruleta-confetti-caer ${p.duracion}s ease-in ${p.retraso}s forwards`,
          }}
        />
      ))}
    </div>
  );
}
