import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Grid3x3, Users, RefreshCw, QrCode, Printer } from 'lucide-react';
import QRCode from 'qrcode';
import { getAreas } from '../../../api/areas';
import { getMesas, crearMesa, actualizarMesa, eliminarMesa } from '../../../api/mesas';
import Modal from '../../../components/ui/Modal';
import { SettingsCard } from '../shared';

const ESTADOS_MESA = ['disponible', 'reservada'];

export default function TabMesas({ puedeEditar }) {
  const qc = useQueryClient();
  const [modal, setModal] = useState(null);
  const [confirmEliminar, setConfirmEliminar] = useState(null);
  const [filtroArea, setFiltroArea] = useState('');
  const [modalQr, setModalQr] = useState(null);

  const { data: areas = [] } = useQuery({ queryKey: ['areas'], queryFn: getAreas });
  const { data: mesas = [], isLoading } = useQuery({ queryKey: ['mesas'], queryFn: () => getMesas() });

  const mesasFiltradas = filtroArea
    ? mesas.filter(m => String(m.area_id) === filtroArea)
    : mesas;

  const guardar = useMutation({
    mutationFn: ({ mesa, datos }) =>
      mesa ? actualizarMesa(mesa.id, datos) : crearMesa(datos),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['mesas'] }); setModal(null); },
  });

  const eliminar = useMutation({
    mutationFn: (id) => eliminarMesa(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['mesas'] }); setConfirmEliminar(null); },
  });

  // Agrupar por área si no hay filtro
  const porArea = mesasFiltradas.reduce((acc, m) => {
    const key = m.area?.nombre ?? 'Sin área';
    if (!acc[key]) acc[key] = [];
    acc[key].push(m);
    return acc;
  }, {});

  return (
    <SettingsCard
      toolbar={
        <>
          <p className="text-sm text-muted-foreground">{mesasFiltradas.length} mesa(s)</p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={filtroArea}
              onChange={e => setFiltroArea(e.target.value)}
              className="bg-background border border-input rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Todas las áreas</option>
              {areas.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </select>
            {puedeEditar && (
              <button
                onClick={() => setModal({ modo: 'crear' })}
                disabled={areas.length === 0}
                className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground rounded-xl text-sm font-medium transition-colors"
                title={areas.length === 0 ? 'Primero crea un área' : ''}
              >
                <Plus className="w-4 h-4" /> Nueva Mesa
              </button>
            )}
          </div>
        </>
      }
    >
      <div className="space-y-4">
        {isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <RefreshCw className="w-4 h-4 animate-spin" /><span className="text-sm">Cargando...</span>
          </div>
        )}

        {!isLoading && mesasFiltradas.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40 gap-2 text-muted-foreground">
            <Grid3x3 className="w-8 h-8" />
            <p className="text-sm">
              {areas.length === 0 ? 'Primero crea un área en la pestaña Áreas.' : 'No hay mesas. Crea la primera.'}
            </p>
          </div>
        )}

        {Object.entries(porArea).map(([areaNombre, mesasGrupo]) => (
          <section key={areaNombre}>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{areaNombre}</h3>

            {/* Móvil y tablet: tarjetas */}
            <div className="lg:hidden space-y-2">
              {mesasGrupo.map(mesa => (
                <div key={mesa.id} className="bg-background border border-border rounded-xl p-3.5 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground truncate">{mesa.nombre}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="flex items-center gap-1 text-xs text-muted-foreground"><Users className="w-3.5 h-3.5" />{mesa.asientos}</span>
                      <EstadoBadge estado={mesa.estado} />
                    </div>
                  </div>
                  {puedeEditar && (
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={() => setModalQr(mesa)}
                        title="Ver código QR"
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                      >
                        <QrCode className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setModal({ modo: 'editar', mesa })}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setConfirmEliminar(mesa)}
                        disabled={mesa.estado === 'ocupada'}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Escritorio: tabla */}
            <div className="hidden lg:block bg-background border border-border rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Nombre</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Asientos</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Estado</th>
                      {puedeEditar && <th className="px-4 py-3 w-20" />}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {mesasGrupo.map(mesa => (
                      <tr key={mesa.id} className="hover:bg-muted/50 transition-colors">
                        <td className="px-4 py-3 font-medium text-foreground">{mesa.nombre}</td>
                        <td className="px-4 py-3 text-muted-foreground">
                          <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{mesa.asientos}</span>
                        </td>
                        <td className="px-4 py-3">
                          <EstadoBadge estado={mesa.estado} />
                        </td>
                        {puedeEditar && (
                          <td className="px-4 py-3">
                            <div className="flex gap-1 justify-end">
                              <button
                                onClick={() => setModalQr(mesa)}
                                title="Ver código QR"
                                className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                              >
                                <QrCode className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setModal({ modo: 'editar', mesa })}
                                className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setConfirmEliminar(mesa)}
                                disabled={mesa.estado === 'ocupada'}
                                className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        ))}
      </div>

      {/* Modal crear/editar mesa */}
      {modal && (
        <FormMesaModal
          mesa={modal.mesa}
          areas={areas}
          onClose={() => setModal(null)}
          onGuardar={(datos) => guardar.mutate({ mesa: modal.mesa, datos })}
          guardando={guardar.isPending}
          error={guardar.error?.response?.data?.mensaje}
        />
      )}

      {/* Confirmar eliminar */}
      {confirmEliminar && (
        <Modal titulo="Eliminar Mesa" onClose={() => setConfirmEliminar(null)}>
          <p className="text-sm text-muted-foreground mb-4">
            ¿Eliminar la mesa <strong>{confirmEliminar.nombre}</strong>?
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

      {/* Modal QR */}
      {modalQr && <ModalCodigoQr mesa={modalQr} onClose={() => setModalQr(null)} />}
    </SettingsCard>
  );
}

function FormMesaModal({ mesa, areas, onClose, onGuardar, guardando, error }) {
  const [form, setForm] = useState({
    area_id: mesa?.area_id ?? (areas[0]?.id ?? ''),
    nombre: mesa?.nombre ?? '',
    asientos: mesa?.asientos ?? 4,
    estado: mesa?.estado ?? 'disponible',
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <Modal titulo={mesa ? 'Editar Mesa' : 'Nueva Mesa'} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Área</label>
          <select
            value={form.area_id}
            onChange={e => set('area_id', e.target.value)}
            className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {areas.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Nombre</label>
          <input
            autoFocus
            value={form.nombre}
            onChange={e => set('nombre', e.target.value)}
            placeholder="Ej: Mesa 1, Barra 2, VIP"
            className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Asientos</label>
          <input
            type="number"
            min={1}
            max={20}
            value={form.asientos}
            onChange={e => set('asientos', parseInt(e.target.value) || 1)}
            className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
          />
        </div>
        {mesa && (
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Estado</label>
            <select
              value={form.estado}
              onChange={e => set('estado', e.target.value)}
              className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {ESTADOS_MESA.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors">
            Cancelar
          </button>
          <button
            onClick={() => onGuardar(form)}
            disabled={guardando || !form.nombre.trim() || !form.area_id}
            className="px-4 py-2 rounded-xl text-sm bg-primary hover:bg-primary/90 text-primary-foreground transition-colors disabled:opacity-60"
          >
            {guardando ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function EstadoBadge({ estado }) {
  const cfg = {
    disponible: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    ocupada:    'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
    reservada:  'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  }[estado] ?? 'bg-muted text-muted-foreground';
  return (
    <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full ${cfg}`}>
      {estado}
    </span>
  );
}

function ModalCodigoQr({ mesa, onClose }) {
  const [dataUrl, setDataUrl] = useState(null);
  const url = `${window.location.origin}/m/${mesa.codigo_qr}`;

  useEffect(() => {
    QRCode.toDataURL(url, { width: 320, margin: 1 }).then(setDataUrl);
  }, [url]);

  return (
    <Modal titulo={`QR — ${mesa.nombre}`} onClose={onClose}>
      <div className="flex flex-col items-center gap-4">
        {dataUrl ? (
          <img src={dataUrl} alt={`QR de ${mesa.nombre}`} className="w-64 h-64" id="qr-imprimir" />
        ) : (
          <div className="w-64 h-64 flex items-center justify-center text-muted-foreground">Generando...</div>
        )}
        <p className="text-xs text-muted-foreground break-all text-center">{url}</p>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium"
        >
          <Printer className="w-4 h-4" /> Imprimir
        </button>
      </div>
    </Modal>
  );
}
