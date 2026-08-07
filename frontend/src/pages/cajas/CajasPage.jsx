import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Landmark, Plus, Pencil, Trash2, AlertCircle, RefreshCw, Printer, Bluetooth } from 'lucide-react';
import { getCajas, crearCaja, actualizarCaja, eliminarCaja } from '../../api/cajas';
import { getSucursales } from '../../api/sucursales';
import { usePermisos } from '../../hooks/usePermisos';
import Modal from '../../components/ui/Modal';

function BadgeEstado({ activo }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${activo ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'}`}>
      {activo ? 'Activa' : 'Inactiva'}
    </span>
  );
}

function BadgeModoImpresion({ modo, anchoPapel }) {
  const esBluetooth = modo === 'bluetooth';
  const Icono = esBluetooth ? Bluetooth : Printer;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${esBluetooth ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' : 'bg-muted text-muted-foreground'}`}>
      <Icono className="w-3 h-3" /> {esBluetooth ? `Bluetooth ${anchoPapel || '80mm'}` : 'Física'}
    </span>
  );
}

export default function CajasPage() {
  const { tienePermiso } = usePermisos();
  const qc = useQueryClient();

  const puedeVer      = tienePermiso('cajas', 'ver');
  const puedeCrear    = tienePermiso('cajas', 'crear');
  const puedeEditar   = tienePermiso('cajas', 'editar');
  const puedeEliminar = tienePermiso('cajas', 'eliminar');

  const [modalForm, setModalForm] = useState(null); // null | 'nuevo' | caja-object
  const [confirmar, setConfirmar] = useState(null); // null | caja-object

  const { data: cajas = [], isLoading } = useQuery({
    queryKey: ['cajas'],
    queryFn: () => getCajas(),
    enabled: puedeVer,
  });

  const { data: sucursales = [] } = useQuery({
    queryKey: ['sucursales'],
    queryFn: getSucursales,
    enabled: puedeVer,
  });

  const eliminar = useMutation({
    mutationFn: (id) => eliminarCaja(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cajas'] });
      setConfirmar(null);
    },
    onError: (err) => alert(err?.response?.data?.mensaje ?? 'Error al eliminar la caja'),
  });

  if (!puedeVer) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
        <AlertCircle className="w-10 h-10" />
        <p className="font-medium">No tienes permiso para ver las cajas</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 gap-3 text-muted-foreground">
        <RefreshCw className="w-5 h-5 animate-spin" /><span>Cargando...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Cajas</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{cajas.length} cajas registradas</p>
        </div>
        {puedeCrear && (
          <button
            onClick={() => setModalForm('nuevo')}
            disabled={sucursales.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground rounded-xl text-sm font-semibold transition-colors"
            title={sucursales.length === 0 ? 'Primero crea una sucursal' : ''}
          >
            <Plus className="w-4 h-4" /> Nueva Caja
          </button>
        )}
      </div>

      {cajas.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
          <Landmark className="w-10 h-10" />
          <p className="text-sm">No hay cajas registradas</p>
        </div>
      ) : (
        <>
          {/* mobile: tarjetas */}
          <div className="sm:hidden space-y-2">
            {cajas.map(c => (
              <div key={c.id} className="bg-card border border-border rounded-xl p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Landmark className="w-4 h-4 text-primary" />
                    </div>
                    <span className="font-semibold text-foreground truncate">{c.nombre}</span>
                  </div>
                  {(puedeEditar || puedeEliminar) && (
                    <div className="flex items-center gap-1 shrink-0">
                      {puedeEditar && (
                        <button
                          onClick={() => setModalForm(c)}
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {puedeEliminar && (
                        <button
                          onClick={() => setConfirmar(c)}
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground truncate">{c.sucursal?.nombre ?? '—'}</p>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <BadgeModoImpresion modo={c.modo_impresion} anchoPapel={c.ancho_papel_bluetooth} />
                    <BadgeEstado activo={c.activo} />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* desktop: tabla */}
          <div className="hidden sm:block bg-card border border-border rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted border-b border-border">
                    <th className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Caja</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Sucursal</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Impresión</th>
                    <th className="px-5 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Estado</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {cajas.map(c => (
                    <tr key={c.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                            <Landmark className="w-4 h-4 text-primary" />
                          </div>
                          <span className="font-semibold text-foreground">{c.nombre}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-muted-foreground">
                        {c.sucursal?.nombre ?? '—'}
                      </td>
                      <td className="px-5 py-3.5">
                        <BadgeModoImpresion modo={c.modo_impresion} anchoPapel={c.ancho_papel_bluetooth} />
                      </td>
                      <td className="px-5 py-3.5 text-center">
                        <BadgeEstado activo={c.activo} />
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-end gap-1">
                          {puedeEditar && (
                            <button
                              onClick={() => setModalForm(c)}
                              className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                              title="Editar"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                          )}
                          {puedeEliminar && (
                            <button
                              onClick={() => setConfirmar(c)}
                              className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                              title="Eliminar"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {modalForm !== null && (
        <ModalCaja
          caja={modalForm === 'nuevo' ? null : modalForm}
          sucursales={sucursales}
          onClose={() => setModalForm(null)}
          onExito={() => {
            setModalForm(null);
            qc.invalidateQueries({ queryKey: ['cajas'] });
          }}
        />
      )}

      {confirmar && (
        <Modal titulo="Eliminar caja" onClose={() => setConfirmar(null)} ancho="max-w-sm">
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              ¿Eliminar la caja <span className="font-semibold text-foreground">"{confirmar.nombre}"</span>?
              Esta acción no se puede deshacer.
            </p>
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3 text-xs text-amber-700 dark:text-amber-400">
              Solo se puede eliminar si no tiene sesiones asociadas.
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmar(null)}
                className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => eliminar.mutate(confirmar.id)}
                disabled={eliminar.isPending}
                className="px-5 py-2 rounded-xl text-sm bg-destructive hover:bg-destructive/90 text-destructive-foreground font-semibold transition-colors disabled:opacity-60"
              >
                {eliminar.isPending ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ModalCaja({ caja, sucursales, onClose, onExito }) {
  const esNuevo = !caja;
  const [sucursalId, setSucursalId]       = useState(caja?.sucursal_id ?? (sucursales[0]?.id ?? ''));
  const [nombre, setNombre]               = useState(caja?.nombre ?? '');
  const [modoImpresion, setModoImpresion] = useState(caja?.modo_impresion ?? 'fisica');
  const [anchoPapel, setAnchoPapel]       = useState(caja?.ancho_papel_bluetooth ?? '80mm');
  const [activo, setActivo]               = useState(caja?.activo ?? 1);
  const [error, setError]                 = useState(null);

  const guardar = useMutation({
    mutationFn: () => {
      const datos = esNuevo
        ? { sucursal_id: parseInt(sucursalId), nombre: nombre.trim(), modo_impresion: modoImpresion, ancho_papel_bluetooth: anchoPapel }
        : { nombre: nombre.trim(), modo_impresion: modoImpresion, ancho_papel_bluetooth: anchoPapel, activo };
      return esNuevo ? crearCaja(datos) : actualizarCaja(caja.id, datos);
    },
    onSuccess: onExito,
    onError: (err) => setError(err?.response?.data?.mensaje ?? 'Error al guardar la caja'),
  });

  return (
    <Modal titulo={esNuevo ? 'Nueva Caja' : `Editar: ${caja.nombre}`} onClose={onClose} ancho="max-w-md">
      <div className="space-y-4">
        {esNuevo && (
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              Sucursal <span className="text-destructive">*</span>
            </label>
            <select
              value={sucursalId}
              onChange={e => setSucursalId(e.target.value)}
              className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
            Nombre <span className="text-destructive">*</span>
          </label>
          <input
            autoFocus
            value={nombre}
            onChange={e => { setNombre(e.target.value); setError(null); }}
            placeholder="Ej: Caja 1, Caja Mostrador"
            className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Modo de impresión</label>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button" onClick={() => setModoImpresion('fisica')}
              className={`flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium border transition-colors ${
                modoImpresion === 'fisica' ? 'bg-primary border-primary text-primary-foreground' : 'border-input text-muted-foreground hover:border-primary/50'
              }`}
            >
              <Printer className="w-3.5 h-3.5" /> Física
            </button>
            <button
              type="button" onClick={() => setModoImpresion('bluetooth')}
              className={`flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium border transition-colors ${
                modoImpresion === 'bluetooth' ? 'bg-primary border-primary text-primary-foreground' : 'border-input text-muted-foreground hover:border-primary/50'
              }`}
            >
              <Bluetooth className="w-3.5 h-3.5" /> Bluetooth (celular)
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">
            {modoImpresion === 'fisica'
              ? 'Impresora fija conectada a una PC con el agente de impresión instalado.'
              : 'Impresora térmica portátil emparejada por Bluetooth con la app RawBT en el celular que usa esta caja.'}
          </p>
        </div>
        {modoImpresion === 'bluetooth' && (
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Ancho de papel</label>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button" onClick={() => setAnchoPapel('58mm')}
                className={`py-2 rounded-xl text-xs font-medium border transition-colors ${
                  anchoPapel === '58mm' ? 'bg-primary border-primary text-primary-foreground' : 'border-input text-muted-foreground hover:border-primary/50'
                }`}
              >
                58mm
              </button>
              <button
                type="button" onClick={() => setAnchoPapel('80mm')}
                className={`py-2 rounded-xl text-xs font-medium border transition-colors ${
                  anchoPapel === '80mm' ? 'bg-primary border-primary text-primary-foreground' : 'border-input text-muted-foreground hover:border-primary/50'
                }`}
              >
                80mm
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              Ancho real de la impresora portátil — si el ticket sale angosto con espacio de sobra, probablemente está en 58mm pero la impresora es de 80mm (o viceversa).
            </p>
          </div>
        )}
        {!esNuevo && (
          <div className="flex items-center gap-3">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Estado</label>
            <button
              type="button"
              onClick={() => setActivo(a => a ? 0 : 1)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${activo ? 'bg-emerald-500' : 'bg-muted'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${activo ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
            <span className="text-xs text-muted-foreground">{activo ? 'Activa' : 'Inactiva'}</span>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-3 pt-1 border-t border-border">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors">
            Cancelar
          </button>
          <button
            onClick={() => guardar.mutate()}
            disabled={guardar.isPending || !nombre.trim() || (esNuevo && !sucursalId)}
            className="px-5 py-2 rounded-xl text-sm bg-primary hover:bg-primary/90 text-primary-foreground font-semibold transition-colors disabled:opacity-60"
          >
            {guardar.isPending ? 'Guardando...' : esNuevo ? 'Crear Caja' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
