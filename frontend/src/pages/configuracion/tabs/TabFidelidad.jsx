import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, CheckCircle2 } from 'lucide-react';
import { getConfiguracion, actualizarConfiguracion } from '../../../api/configuracion';
import { SettingsCard } from '../shared';

export default function TabFidelidad({ puedeEditar }) {
  const qc = useQueryClient();
  const [guardado, setGuardado] = useState(false);

  const { data: config = {}, isLoading } = useQuery({
    queryKey: ['configuracion'],
    queryFn: getConfiguracion,
  });

  const [form, setForm] = useState(null);

  if (!isLoading && form === null) {
    setForm({
      fidelidad_activa: config.fidelidad_activa === 'true',
      puntos_por_bs:    config.puntos_por_bs    ?? '1',
      valor_punto_bs:   config.valor_punto_bs   ?? '0.10',
      fidelidad_canje_efectivo: config.fidelidad_canje_efectivo !== 'false',
      fidelidad_canje_qr:       config.fidelidad_canje_qr === 'true',
    });
  }

  const guardar = useMutation({
    mutationFn: (datos) => actualizarConfiguracion(datos),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['configuracion'] });
      setGuardado(true);
      setTimeout(() => setGuardado(false), 2500);
    },
  });

  function set(k, v) {
    setForm(f => ({ ...f, [k]: v }));
  }

  function guardarFidelidad() {
    guardar.mutate({
      fidelidad_activa: form.fidelidad_activa ? 'true' : 'false',
      puntos_por_bs: form.puntos_por_bs,
      valor_punto_bs: form.valor_punto_bs,
      fidelidad_canje_efectivo: form.fidelidad_canje_efectivo ? 'true' : 'false',
      fidelidad_canje_qr: form.fidelidad_canje_qr ? 'true' : 'false',
    });
  }

  if (isLoading || form === null) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-8">
        <RefreshCw className="w-4 h-4 animate-spin" /><span className="text-sm">Cargando...</span>
      </div>
    );
  }

  const puntosPorBs  = parseFloat(form.puntos_por_bs)  || 0;
  const valorPunto   = parseFloat(form.valor_punto_bs) || 0;

  return (
    <SettingsCard>
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => puedeEditar && set('fidelidad_activa', !form.fidelidad_activa)}
            disabled={!puedeEditar}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-60 ${form.fidelidad_activa ? 'bg-emerald-500' : 'bg-muted'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${form.fidelidad_activa ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
          <div>
            <p className="text-sm font-semibold text-foreground">Programa de puntos activo</p>
            <p className="text-xs text-muted-foreground">Si está apagado, no se otorgan ni se pueden canjear puntos en ninguna venta.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              Puntos ganados por cada Bs gastado
            </label>
            <input
              type="number" step="0.01" min="0"
              value={form.puntos_por_bs}
              onChange={e => set('puntos_por_bs', e.target.value)}
              disabled={!puedeEditar}
              className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition disabled:opacity-60"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              Valor de 1 punto al canjear (Bs)
            </label>
            <input
              type="number" step="0.01" min="0"
              value={form.valor_punto_bs}
              onChange={e => set('valor_punto_bs', e.target.value)}
              disabled={!puedeEditar}
              className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition disabled:opacity-60"
            />
          </div>
        </div>

        <div className="bg-muted rounded-xl px-4 py-3 text-xs text-muted-foreground">
          Ejemplo: una compra de <strong className="text-foreground">Bs 100</strong> otorga{' '}
          <strong className="text-foreground">{Math.floor(100 * puntosPorBs)} puntos</strong>. Esos puntos, canjeados
          en una compra futura, valen <strong className="text-foreground">Bs {(Math.floor(100 * puntosPorBs) * valorPunto).toFixed(2)}</strong> de descuento.
        </div>

        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">¿En qué métodos de pago se puede canjear?</p>
          {[
            { key: 'fidelidad_canje_efectivo', label: 'Efectivo', desc: 'Permitir canjear puntos cuando se cobra en efectivo.' },
            { key: 'fidelidad_canje_qr', label: 'QR / Transferencia', desc: 'Permitir canjear puntos cuando se cobra por QR (los puntos se reservan al generar el QR y se devuelven si el pago falla o expira).' },
          ].map(({ key, label, desc }) => (
            <div key={key} className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => puedeEditar && set(key, !form[key])}
                disabled={!puedeEditar}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${form[key] ? 'bg-emerald-500' : 'bg-muted'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${form[key] ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
              <div>
                <p className="text-sm font-semibold text-foreground">{label}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
            </div>
          ))}
        </div>

        {puedeEditar ? (
          <div className="flex items-center gap-4 pt-1">
            <button
              onClick={guardarFidelidad}
              disabled={guardar.isPending}
              className="px-6 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-sm font-semibold transition-colors disabled:opacity-60"
            >
              {guardar.isPending ? 'Guardando...' : 'Guardar cambios'}
            </button>
            {guardado && (
              <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-sm font-medium">
                <CheckCircle2 className="w-4 h-4" /> Guardado correctamente
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No tienes permiso para editar la configuración.</p>
        )}
      </div>
    </SettingsCard>
  );
}
