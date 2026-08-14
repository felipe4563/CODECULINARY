import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, CheckCircle2 } from 'lucide-react';
import { getConfiguracion, actualizarConfiguracion } from '../../../api/configuracion';
import { SettingsCard } from '../shared';

export default function TabFlujo({ puedeEditar }) {
  const qc = useQueryClient();
  const [guardado, setGuardado] = useState(false);

  const { data: config = {}, isLoading } = useQuery({
    queryKey: ['configuracion'],
    queryFn: getConfiguracion,
  });

  const flujoActual   = config.flujo_cocina ?? 'digital';
  const destinoActual = config.cocina_destino ?? 'centralizada';

  const guardar = useMutation({
    mutationFn: (flujo) => actualizarConfiguracion({ flujo_cocina: flujo }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['configuracion'] });
      setGuardado(true);
      setTimeout(() => setGuardado(false), 2500);
    },
  });

  const guardarDestino = useMutation({
    mutationFn: (destino) => actualizarConfiguracion({ cocina_destino: destino }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['configuracion'] });
      setGuardado(true);
      setTimeout(() => setGuardado(false), 2500);
    },
  });

  const opcionesDestino = [
    {
      id: 'centralizada',
      titulo: 'Cocina centralizada',
      descripcion: 'Todos los pedidos, de cualquier caja, imprimen en un solo destino de cocina compartido. Ideal si hay una cocina física fija.',
      icono: '🏠',
    },
    {
      id: 'por_caja',
      titulo: 'Cocina por caja',
      descripcion: 'Cada caja imprime su propio ticket de cocina junto con el de venta, sin depender de un destino central. Ideal con un solo mesero-cajero (ej. celular).',
      icono: '📱',
    },
  ];

  const opciones = [
    {
      id: 'digital',
      titulo: 'Vista digital de cocina',
      descripcion: 'Los pedidos aparecen en la pantalla /cocina. La cocina marca "listo" desde la pantalla y el mesero ve la notificación en el pedido.',
      icono: '🖥️',
    },
    {
      id: 'fisico',
      titulo: 'Ticket físico impreso',
      descripcion: 'Al guardar el pedido aparece un botón para imprimir el ticket de cocina. El flujo es el mismo que antes: papel → cocina → servir.',
      icono: '🖨️',
    },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-8">
        <RefreshCw className="w-4 h-4 animate-spin" /><span className="text-sm">Cargando...</span>
      </div>
    );
  }

  return (
    <SettingsCard>
      <div className="space-y-4">
        <div className="space-y-3">
          {opciones.map(op => (
            <button
              key={op.id}
              onClick={() => puedeEditar && guardar.mutate(op.id)}
              disabled={!puedeEditar || guardar.isPending}
              className={`w-full text-left p-4 rounded-2xl border-2 transition-all ${
                flujoActual === op.id
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-card hover:border-muted-foreground'
              } ${!puedeEditar ? 'cursor-default' : 'cursor-pointer'}`}
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl">{op.icono}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-foreground text-sm">{op.titulo}</p>
                    {flujoActual === op.id && (
                      <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full font-medium">Activo</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{op.descripcion}</p>
                </div>
              </div>
            </button>
          ))}
        </div>

        {flujoActual === 'fisico' && (
          <div className="pt-2 border-t border-border space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Destino del ticket de cocina</p>
            {opcionesDestino.map(op => (
              <button
                key={op.id}
                onClick={() => puedeEditar && guardarDestino.mutate(op.id)}
                disabled={!puedeEditar || guardarDestino.isPending}
                className={`w-full text-left p-4 rounded-2xl border-2 transition-all ${
                  destinoActual === op.id
                    ? 'border-primary bg-primary/10'
                    : 'border-border bg-card hover:border-muted-foreground'
                } ${!puedeEditar ? 'cursor-default' : 'cursor-pointer'}`}
              >
                <div className="flex items-start gap-3">
                  <span className="text-2xl">{op.icono}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-foreground text-sm">{op.titulo}</p>
                      {destinoActual === op.id && (
                        <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full font-medium">Activo</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{op.descripcion}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {guardado && (
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-sm font-medium">
            <CheckCircle2 className="w-4 h-4" /> Configuración guardada
          </div>
        )}

        {!puedeEditar && (
          <p className="text-xs text-muted-foreground">No tienes permiso para cambiar esta configuración.</p>
        )}
      </div>
    </SettingsCard>
  );
}
