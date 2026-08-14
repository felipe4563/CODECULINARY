import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Building2, RefreshCw } from 'lucide-react';
import { getAreas, crearArea, actualizarArea, eliminarArea } from '../../../api/areas';
import Modal from '../../../components/ui/Modal';
import { SettingsCard } from '../shared';

export default function TabAreas({ puedeEditar }) {
  const qc = useQueryClient();
  const [modal, setModal] = useState(null); // null | { modo: 'crear'|'editar', area? }
  const [confirmEliminar, setConfirmEliminar] = useState(null);

  const { data: areas = [], isLoading } = useQuery({ queryKey: ['areas'], queryFn: getAreas });

  const guardar = useMutation({
    mutationFn: ({ area, datos }) =>
      area ? actualizarArea(area.id, datos) : crearArea(datos),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['areas'] }); setModal(null); },
  });

  const eliminar = useMutation({
    mutationFn: (id) => eliminarArea(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['areas'] }); setConfirmEliminar(null); },
  });

  return (
    <SettingsCard
      toolbar={
        <>
          <p className="text-sm text-muted-foreground">{areas.length} área(s) registrada(s)</p>
          {puedeEditar && (
            <button
              onClick={() => setModal({ modo: 'crear' })}
              className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-sm font-medium transition-colors"
            >
              <Plus className="w-4 h-4" /> Nueva Área
            </button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <RefreshCw className="w-4 h-4 animate-spin" /><span className="text-sm">Cargando...</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {areas.map(area => (
            <div
              key={area.id}
              className="bg-background border border-border rounded-xl p-4 flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 bg-primary/10 rounded-lg flex items-center justify-center shrink-0">
                  <Building2 className="w-4 h-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-foreground truncate">{area.nombre}</p>
                  <p className="text-xs text-muted-foreground">{area.mesas?.length ?? 0} mesa(s)</p>
                </div>
              </div>
              {puedeEditar && (
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => setModal({ modo: 'editar', area })}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setConfirmEliminar(area)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {!isLoading && areas.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40 gap-2 text-muted-foreground">
            <Building2 className="w-8 h-8" />
            <p className="text-sm">No hay áreas. Crea la primera.</p>
          </div>
        )}
      </div>

      {/* Modal crear/editar */}
      {modal && (
        <FormAreaModal
          area={modal.area}
          onClose={() => setModal(null)}
          onGuardar={(datos) => guardar.mutate({ area: modal.area, datos })}
          guardando={guardar.isPending}
          error={guardar.error?.response?.data?.mensaje}
        />
      )}

      {/* Confirmar eliminar */}
      {confirmEliminar && (
        <Modal titulo="Eliminar Área" onClose={() => setConfirmEliminar(null)}>
          <p className="text-sm text-muted-foreground mb-4">
            ¿Eliminar el área <strong>{confirmEliminar.nombre}</strong>? Solo se puede si no tiene mesas asignadas.
          </p>
          {eliminar.error && (
            <p className="text-sm text-destructive mb-3">{eliminar.error?.response?.data?.mensaje ?? 'Error al eliminar'}</p>
          )}
          <div className="flex justify-end gap-3">
            <button onClick={() => setConfirmEliminar(null)} className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors">
              Cancelar
            </button>
            <button
              onClick={() => eliminar.mutate(confirmEliminar.id)}
              disabled={eliminar.isPending}
              className="px-4 py-2 rounded-xl text-sm bg-destructive hover:bg-destructive/90 text-destructive-foreground transition-colors disabled:opacity-60"
            >
              {eliminar.isPending ? 'Eliminando...' : 'Eliminar'}
            </button>
          </div>
        </Modal>
      )}
    </SettingsCard>
  );
}

function FormAreaModal({ area, onClose, onGuardar, guardando, error }) {
  const [nombre, setNombre] = useState(area?.nombre ?? '');
  return (
    <Modal titulo={area ? 'Editar Área' : 'Nueva Área'} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
            Nombre del área
          </label>
          <input
            autoFocus
            value={nombre}
            onChange={e => setNombre(e.target.value)}
            placeholder="Ej: Salón Principal, Terraza, Bar"
            className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors">
            Cancelar
          </button>
          <button
            onClick={() => onGuardar({ nombre })}
            disabled={guardando || !nombre.trim()}
            className="px-4 py-2 rounded-xl text-sm bg-primary hover:bg-primary/90 text-primary-foreground transition-colors disabled:opacity-60"
          >
            {guardando ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
