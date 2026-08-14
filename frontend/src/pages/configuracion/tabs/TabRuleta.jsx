import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, CheckCircle2 } from 'lucide-react';
import { getConfiguracion, actualizarConfiguracion } from '../../../api/configuracion';
import { SettingsCard } from '../shared';

export default function TabRuleta({ puedeEditar }) {
  const qc = useQueryClient();
  const [guardado, setGuardado] = useState(false);

  const { data: config = {}, isLoading } = useQuery({
    queryKey: ['configuracion'],
    queryFn: getConfiguracion,
  });

  const [form, setForm] = useState(null);

  if (!isLoading && form === null) {
    setForm({
      ruleta_activa:               config.ruleta_activa === 'true',
      ruleta_costo_puntos:         config.ruleta_costo_puntos ?? '10',
      ruleta_max_giros_periodo:    config.ruleta_max_giros_periodo ?? '1',
      ruleta_periodo:              config.ruleta_periodo ?? 'dia',
      ruleta_vigencia_dias_premio: config.ruleta_vigencia_dias_premio ?? '7',
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
    setForm((f) => ({ ...f, [k]: v }));
  }

  function guardarRuleta() {
    guardar.mutate({
      ruleta_activa: form.ruleta_activa ? 'true' : 'false',
      ruleta_costo_puntos: form.ruleta_costo_puntos,
      ruleta_max_giros_periodo: form.ruleta_max_giros_periodo,
      ruleta_periodo: form.ruleta_periodo,
      ruleta_vigencia_dias_premio: form.ruleta_vigencia_dias_premio,
    });
  }

  if (isLoading || form === null) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-8">
        <RefreshCw className="w-4 h-4 animate-spin" /><span className="text-sm">Cargando...</span>
      </div>
    );
  }

  const costo = parseInt(form.ruleta_costo_puntos, 10) || 0;
  const maxGiros = parseInt(form.ruleta_max_giros_periodo, 10) || 0;

  return (
    <SettingsCard>
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => puedeEditar && set('ruleta_activa', !form.ruleta_activa)}
            disabled={!puedeEditar}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-60 ${form.ruleta_activa ? 'bg-emerald-500' : 'bg-muted'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${form.ruleta_activa ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
          <div>
            <p className="text-sm font-semibold text-foreground">Ruleta de premios activa</p>
            <p className="text-xs text-muted-foreground">
              Permite a los clientes canjear puntos de fidelidad por un giro, desde Ruleta → Girar en el menú.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              Costo por giro (puntos)
            </label>
            <input
              type="number" min="1" step="1"
              value={form.ruleta_costo_puntos}
              onChange={(e) => set('ruleta_costo_puntos', e.target.value)}
              disabled={!puedeEditar}
              className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition disabled:opacity-60"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              Vigencia del cupón ganado (días)
            </label>
            <input
              type="number" min="1" step="1"
              value={form.ruleta_vigencia_dias_premio}
              onChange={(e) => set('ruleta_vigencia_dias_premio', e.target.value)}
              disabled={!puedeEditar}
              className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition disabled:opacity-60"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Máx. giros por</label>
            <div className="grid grid-cols-2 gap-2">
              {[{ id: 'dia', label: 'Día' }, { id: 'semana', label: 'Semana' }].map((p) => (
                <button
                  key={p.id} type="button"
                  onClick={() => puedeEditar && set('ruleta_periodo', p.id)}
                  disabled={!puedeEditar}
                  className={`py-2.5 rounded-xl text-sm font-medium border transition-colors disabled:opacity-60 ${
                    form.ruleta_periodo === p.id ? 'bg-primary border-primary text-primary-foreground' : 'border-input text-muted-foreground hover:border-primary/50'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Giros máximos</label>
            <input
              type="number" min="1" step="1"
              value={form.ruleta_max_giros_periodo}
              onChange={(e) => set('ruleta_max_giros_periodo', e.target.value)}
              disabled={!puedeEditar}
              className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition disabled:opacity-60"
            />
          </div>
        </div>

        <div className="bg-muted rounded-xl px-4 py-3 text-xs text-muted-foreground">
          Ejemplo: cada giro cuesta <strong className="text-foreground">{costo} punto{costo === 1 ? '' : 's'}</strong>, un
          mismo cliente puede girar hasta <strong className="text-foreground">{maxGiros} {maxGiros === 1 ? 'vez' : 'veces'}</strong> por {form.ruleta_periodo === 'semana' ? 'semana' : 'día'},
          y el cupón que gane queda válido <strong className="text-foreground">{parseInt(form.ruleta_vigencia_dias_premio, 10) || 0} días</strong>.
        </div>

        <p className="text-xs text-muted-foreground">
          Los premios de la ruleta (qué se puede ganar y con qué probabilidad) se configuran en <span className="font-medium text-foreground">Ruleta → Premios</span>, en el menú.
        </p>

        {puedeEditar ? (
          <div className="flex items-center gap-4 pt-1">
            <button
              onClick={guardarRuleta}
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
