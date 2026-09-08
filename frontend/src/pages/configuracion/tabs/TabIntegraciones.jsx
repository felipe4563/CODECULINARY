import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Ban, RefreshCw, Plug, Copy } from 'lucide-react';
import { getApiKeys, crearApiKey, desactivarApiKey, regenerarApiKey } from '../../../api/integraciones';
import { getSucursales } from '../../../api/sucursales';
import Modal from '../../../components/ui/Modal';
import { SettingsCard } from '../shared';

export default function TabIntegraciones({ puedeEditar }) {
  const qc = useQueryClient();
  const [modalCrear, setModalCrear] = useState(false);
  const [keyGenerada, setKeyGenerada] = useState(null); // { api_key, nombre_app }

  const { data: keys = [], isLoading } = useQuery({ queryKey: ['integraciones-api-keys'], queryFn: getApiKeys });
  const { data: sucursales = [] } = useQuery({ queryKey: ['sucursales'], queryFn: getSucursales });

  const crear = useMutation({
    mutationFn: crearApiKey,
    onSuccess: (datos) => {
      qc.invalidateQueries({ queryKey: ['integraciones-api-keys'] });
      setModalCrear(false);
      setKeyGenerada(datos);
    },
  });

  const desactivar = useMutation({
    mutationFn: desactivarApiKey,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integraciones-api-keys'] }),
  });

  const regenerar = useMutation({
    mutationFn: regenerarApiKey,
    onSuccess: (datos) => {
      qc.invalidateQueries({ queryKey: ['integraciones-api-keys'] });
      setKeyGenerada(datos);
    },
  });

  return (
    <SettingsCard
      toolbar={
        <>
          <p className="text-sm text-muted-foreground">{keys.length} integración(es)</p>
          {puedeEditar && (
            <button
              onClick={() => setModalCrear(true)}
              className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-sm font-medium transition-colors"
            >
              <Plus className="w-4 h-4" /> Nueva API key
            </button>
          )}
        </>
      }
    >
      <div className="space-y-3">
        {isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <RefreshCw className="w-4 h-4 animate-spin" /><span className="text-sm">Cargando...</span>
          </div>
        )}

        {keys.map((k) => (
          <div key={k.id} className="bg-background border border-border rounded-xl p-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 bg-primary/10 rounded-lg flex items-center justify-center shrink-0">
                <Plug className="w-4 h-4 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-foreground truncate">{k.nombre_app}</p>
                <p className="text-xs text-muted-foreground">
                  {k.sucursal?.nombre} · {k.activo ? 'Activa' : 'Desactivada'}
                </p>
              </div>
            </div>
            {puedeEditar && (
              <div className="flex gap-1 shrink-0">
                <button
                  onClick={() => regenerar.mutate(k.id)}
                  title="Regenerar key"
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
                {k.activo && (
                  <button
                    onClick={() => desactivar.mutate(k.id)}
                    title="Desactivar"
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <Ban className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>
        ))}

        {!isLoading && keys.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40 gap-2 text-muted-foreground">
            <Plug className="w-8 h-8" />
            <p className="text-sm">No hay integraciones. Crea la primera.</p>
          </div>
        )}
      </div>

      {modalCrear && (
        <FormCrearModal
          sucursales={sucursales}
          onClose={() => setModalCrear(false)}
          onGuardar={(datos) => crear.mutate(datos)}
          guardando={crear.isPending}
          error={crear.error?.response?.data?.mensaje}
        />
      )}

      {keyGenerada && (
        <Modal titulo="API key generada" onClose={() => setKeyGenerada(null)}>
          <p className="text-sm text-muted-foreground mb-3">
            Copiá esta key ahora — no se puede volver a ver después. Configurala en <strong>{keyGenerada.nombre_app}</strong>.
          </p>
          <div className="flex items-center gap-2 bg-muted rounded-xl p-3">
            <code className="text-sm flex-1 break-all">{keyGenerada.api_key}</code>
            <button
              onClick={() => navigator.clipboard.writeText(keyGenerada.api_key)}
              className="p-1.5 rounded-lg hover:bg-accent transition-colors shrink-0"
            >
              <Copy className="w-4 h-4" />
            </button>
          </div>
        </Modal>
      )}
    </SettingsCard>
  );
}

function FormCrearModal({ sucursales, onClose, onGuardar, guardando, error }) {
  const [nombre_app, setNombreApp] = useState('');
  const [sucursal_id, setSucursalId] = useState(sucursales[0]?.id ?? '');

  return (
    <Modal titulo="Nueva API key" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
            Nombre de la app
          </label>
          <input
            autoFocus
            value={nombre_app}
            onChange={(e) => setNombreApp(e.target.value)}
            placeholder="Ej: PedidosYa"
            className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
            Sucursal
          </label>
          <select
            value={sucursal_id}
            onChange={(e) => setSucursalId(Number(e.target.value))}
            className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
          >
            {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors">
            Cancelar
          </button>
          <button
            onClick={() => onGuardar({ nombre_app, sucursal_id })}
            disabled={guardando || !nombre_app.trim() || !sucursal_id}
            className="px-4 py-2 rounded-xl text-sm bg-primary hover:bg-primary/90 text-primary-foreground transition-colors disabled:opacity-60"
          >
            {guardando ? 'Generando...' : 'Generar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
