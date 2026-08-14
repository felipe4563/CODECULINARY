import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, CheckCircle2 } from 'lucide-react';
import { getConfiguracion, actualizarConfiguracion } from '../../../api/configuracion';
import { SettingsCard } from '../shared';

export default function TabCumpleanos({ puedeEditar }) {
  const qc = useQueryClient();
  const [guardado, setGuardado] = useState(false);

  const { data: config = {}, isLoading } = useQuery({
    queryKey: ['configuracion'],
    queryFn: getConfiguracion,
  });

  const [form, setForm] = useState(null);

  if (!isLoading && form === null) {
    setForm({
      cumple_activo:            config.cumple_activo === 'true',
      cumple_dias_anticipacion: config.cumple_dias_anticipacion ?? '5',
      cumple_tipo:              config.cumple_tipo ?? 'porcentaje',
      cumple_valor:             config.cumple_valor ?? '10',
      cumple_vigencia_dias:     config.cumple_vigencia_dias ?? '10',
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

  function guardarCumpleanos() {
    guardar.mutate({
      cumple_activo: form.cumple_activo ? 'true' : 'false',
      cumple_dias_anticipacion: form.cumple_dias_anticipacion,
      cumple_tipo: form.cumple_tipo,
      cumple_valor: form.cumple_valor,
      cumple_vigencia_dias: form.cumple_vigencia_dias,
    });
  }

  if (isLoading || form === null) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-8">
        <RefreshCw className="w-4 h-4 animate-spin" /><span className="text-sm">Cargando...</span>
      </div>
    );
  }

  const dias = parseInt(form.cumple_dias_anticipacion, 10) || 0;
  const vigencia = parseInt(form.cumple_vigencia_dias, 10) || 0;
  const valor = parseFloat(form.cumple_valor) || 0;

  return (
    <SettingsCard>
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => puedeEditar && set('cumple_activo', !form.cumple_activo)}
            disabled={!puedeEditar}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-60 ${form.cumple_activo ? 'bg-emerald-500' : 'bg-muted'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${form.cumple_activo ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
          <div>
            <p className="text-sm font-semibold text-foreground">Promo cumpleañero activa</p>
            <p className="text-xs text-muted-foreground">
              Genera automáticamente, todos los días, un cupón personal para cada cliente que tenga fecha de nacimiento cargada y esté por cumplir años.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              Días de anticipación
            </label>
            <input
              type="number" min="0" step="1"
              value={form.cumple_dias_anticipacion}
              onChange={e => set('cumple_dias_anticipacion', e.target.value)}
              disabled={!puedeEditar}
              className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition disabled:opacity-60"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              Vigencia del cupón (días)
            </label>
            <input
              type="number" min="1" step="1"
              value={form.cumple_vigencia_dias}
              onChange={e => set('cumple_vigencia_dias', e.target.value)}
              disabled={!puedeEditar}
              className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition disabled:opacity-60"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Tipo de descuento</label>
            <div className="grid grid-cols-2 gap-2">
              {[{ id: 'fijo', label: 'Bs' }, { id: 'porcentaje', label: '%' }].map((t) => (
                <button
                  key={t.id} type="button"
                  onClick={() => puedeEditar && set('cumple_tipo', t.id)}
                  disabled={!puedeEditar}
                  className={`py-2.5 rounded-xl text-sm font-medium border transition-colors disabled:opacity-60 ${
                    form.cumple_tipo === t.id ? 'bg-primary border-primary text-primary-foreground' : 'border-input text-muted-foreground hover:border-primary/50'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Valor</label>
            <input
              type="number" step="0.01" min="0" max={form.cumple_tipo === 'porcentaje' ? 100 : undefined}
              value={form.cumple_valor}
              onChange={e => set('cumple_valor', e.target.value)}
              disabled={!puedeEditar}
              className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition disabled:opacity-60"
            />
          </div>
        </div>

        <div className="bg-muted rounded-xl px-4 py-3 text-xs text-muted-foreground">
          Ejemplo: a un cliente le generamos el cupón <strong className="text-foreground">{dias} día{dias === 1 ? '' : 's'}</strong> antes
          de su cumpleaños, con <strong className="text-foreground">{form.cumple_tipo === 'porcentaje' ? `${valor}%` : `Bs ${valor.toFixed(2)}`}</strong> de
          descuento, y le queda válido durante <strong className="text-foreground">{vigencia} día{vigencia === 1 ? '' : 's'}</strong> desde que se genera.
        </div>

        <p className="text-xs text-muted-foreground">
          El cliente necesita tener su fecha de nacimiento cargada en <span className="font-medium text-foreground">Clientes</span> para poder recibir el cupón.
        </p>

        {puedeEditar ? (
          <div className="flex items-center gap-4 pt-1">
            <button
              onClick={guardarCumpleanos}
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
