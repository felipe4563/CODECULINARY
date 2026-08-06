import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Sparkles, RefreshCw, AlertCircle, PartyPopper, Gift, Package } from 'lucide-react';
import { getPremiosRuleta, getEstadoRuleta, girarRuleta } from '../../api/ruleta';
import Modal from '../../components/ui/Modal';
import { Rueda, Confetti, LeyendaPremios } from './Rueda';
import { calcularSegmentos, DURACION_GIRO_MS } from './ruedaUtils';

// Panel de "girar la ruleta" para un cliente ya elegido — sin buscador de
// cliente propio, para poder reutilizarse tanto en la página Ruleta (donde
// el buscador vive en el tab) como en un modal dentro del cobro del POS
// (donde el cliente es el que ya está seleccionado en la venta).
// `onGanoPremio` se dispara al terminar un giro que generó cupón, para que
// quien use el panel pueda refrescar listas relacionadas (ej. cupones
// disponibles del cliente en el checkout).
export default function GirarRuletaPanel({ cliente, onGanoPremio, layout = 'grid' }) {
  const qc = useQueryClient();
  const [rotacion, setRotacion] = useState(0);
  const [girando, setGirando] = useState(false);
  const [resultado, setResultado] = useState(null); // { premio, cupon } | null

  const { data: premios = [] } = useQuery({
    queryKey: ['ruleta-premios-todos'],
    queryFn: getPremiosRuleta,
  });
  const premiosActivos = premios.filter((p) => p.activo);
  const segmentos = calcularSegmentos(premiosActivos);

  const { data: estado, isFetching: cargandoEstado } = useQuery({
    queryKey: ['ruleta-estado', cliente?.id],
    queryFn: () => getEstadoRuleta(cliente.id),
    enabled: !!cliente,
  });

  const girar = useMutation({
    mutationFn: () => girarRuleta(cliente.id),
    onSuccess: (datos) => {
      const seg = segmentos.find((s) => s.id === datos.premio.id);
      const centro = seg ? seg.anguloInicio + seg.anguloTam / 2 : 0;
      setGirando(true);
      setRotacion((prev) => {
        const base = Math.ceil((prev + 1) / 360) * 360;
        return base + 360 * 5 + (360 - centro);
      });
      setTimeout(() => {
        setGirando(false);
        setResultado(datos);
        qc.invalidateQueries({ queryKey: ['ruleta-estado', cliente.id] });
        if (datos.cupon) onGanoPremio?.(datos);
      }, DURACION_GIRO_MS);
    },
  });

  const contenedor = layout === 'grid' ? 'grid grid-cols-1 lg:grid-cols-2 gap-6' : 'space-y-5';

  return (
    <div className={contenedor}>
      <div className="space-y-4">
        <div className="bg-muted/50 border border-border rounded-xl p-4 space-y-3">
          {cargandoEstado ? (
            <div className="flex items-center gap-2 text-muted-foreground text-xs">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Consultando...
            </div>
          ) : estado && (
            <div className="text-xs text-muted-foreground space-y-1">
              <p>Costo por giro: <span className="font-semibold text-foreground">{estado.costo_puntos} puntos</span></p>
              <p>Giros usados {estado.periodo === 'semana' ? 'esta semana' : 'hoy'}: <span className="font-semibold text-foreground">{estado.giros_usados}/{estado.max_giros_periodo}</span></p>
              {!estado.puede_girar && (
                <p className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-medium">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {estado.motivo_bloqueo}
                </p>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => { setResultado(null); girar.mutate(); }}
            disabled={!estado?.puede_girar || girando || girar.isPending}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-primary hover:bg-primary/90 active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100 text-primary-foreground font-bold text-sm transition-all"
          >
            <Sparkles className="w-4 h-4" />
            {girando ? 'Girando...' : `Girar (${estado?.costo_puntos ?? '...'} puntos)`}
          </button>
        </div>

        {segmentos.length === 0 && (
          <p className="text-xs text-muted-foreground bg-muted rounded-xl p-3">
            No hay premios activos configurados en la ruleta.
          </p>
        )}
      </div>

      <div className={`flex items-center gap-5 ${layout === 'grid' ? 'flex-col sm:flex-row' : 'flex-col'}`}>
        <Rueda segmentos={segmentos} rotacion={rotacion} girando={girando} compacto={layout === 'stack'} />
        <LeyendaPremios segmentos={segmentos} />
      </div>

      {resultado && (
        <Modal titulo="¡Resultado del giro!" onClose={() => setResultado(null)} ancho="max-w-sm">
          <div className="text-center space-y-3 py-2 relative overflow-hidden">
            <style>{`
              @keyframes ruleta-resultado-pop {
                0% { transform: scale(0.4); opacity: 0; }
                60% { transform: scale(1.15); opacity: 1; }
                100% { transform: scale(1); opacity: 1; }
              }
            `}</style>
            {resultado.cupon && <Confetti />}
            <div style={{ animation: 'ruleta-resultado-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
              <PartyPopper className="w-10 h-10 text-primary mx-auto" />
              <p className="text-lg font-bold text-foreground mt-1">{resultado.premio.nombre}</p>
            </div>
            {resultado.cupon ? (
              <div className="bg-muted rounded-xl p-3 space-y-1">
                <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                  {resultado.premio.tipo === 'producto_gratis' || resultado.premio.tipo === 'combo_gratis'
                    ? <><Package className="w-3.5 h-3.5" /> Cupón generado (ítem gratis)</>
                    : <><Gift className="w-3.5 h-3.5" /> Cupón generado</>}
                </p>
                <p className="font-mono font-bold text-foreground text-base">{resultado.cupon.codigo}</p>
                <p className="text-xs text-muted-foreground">
                  {resultado.cupon.tipo === 'porcentaje' ? `${resultado.cupon.valor}% de descuento` : `Bs ${resultado.cupon.valor.toFixed(2)} de descuento`}
                </p>
                <p className="text-xs text-muted-foreground">Vence {resultado.cupon.fecha_expiracion}</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Sin premio esta vez — ¡suerte para la próxima!</p>
            )}
            <button
              onClick={() => setResultado(null)}
              className="mt-2 px-5 py-2 rounded-xl text-sm bg-primary hover:bg-primary/90 text-primary-foreground font-semibold transition-colors"
            >
              Listo
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
