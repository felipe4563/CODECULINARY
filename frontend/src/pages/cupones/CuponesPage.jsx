import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ticket, Plus, Pencil, Trash2, AlertCircle, RefreshCw, Shuffle, Search, X, User } from 'lucide-react';
import { getCupones, crearCupon, actualizarCupon, eliminarCupon } from '../../api/cupones';
import { getClientes } from '../../api/clientes';
import { usePermisos } from '../../hooks/usePermisos';
import Modal from '../../components/ui/Modal';

function BadgeEstado({ cupon }) {
  const agotado = cupon.usos_actuales >= cupon.usos_maximos;
  if (agotado) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-700/40 dark:text-gray-300">
        Agotado
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cupon.activo ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'}`}>
      {cupon.activo ? 'Activo' : 'Inactivo'}
    </span>
  );
}

function etiquetaUsos(cupon) {
  return `${cupon.usos_actuales}/${cupon.usos_maximos} usos`;
}

function etiquetaValor(cupon) {
  return cupon.tipo === 'porcentaje' ? `-${parseFloat(cupon.valor)}%` : `-Bs ${parseFloat(cupon.valor).toFixed(2)}`;
}

function generarCodigo() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let codigo = '';
  for (let i = 0; i < 8; i++) codigo += chars[Math.floor(Math.random() * chars.length)];
  return codigo;
}

export default function CuponesPage() {
  const { tienePermiso } = usePermisos();
  const qc = useQueryClient();

  const puedeVer      = tienePermiso('cupones', 'ver');
  const puedeCrear    = tienePermiso('cupones', 'crear');
  const puedeEditar   = tienePermiso('cupones', 'editar');
  const puedeEliminar = tienePermiso('cupones', 'eliminar');

  const [modalForm, setModalForm] = useState(null); // null | 'nuevo' | cupon-object
  const [confirmar, setConfirmar] = useState(null);

  const { data: cupones = [], isLoading } = useQuery({
    queryKey: ['cupones'],
    queryFn: getCupones,
    enabled: puedeVer,
  });

  const eliminar = useMutation({
    mutationFn: (id) => eliminarCupon(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cupones'] });
      setConfirmar(null);
    },
    onError: (err) => alert(err?.response?.data?.mensaje ?? 'Error al eliminar el cupón'),
  });

  if (!puedeVer) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
        <AlertCircle className="w-10 h-10" />
        <p className="font-medium">No tienes permiso para ver los cupones</p>
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
          <h1 className="text-xl font-bold text-foreground">Cupones</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{cupones.length} cupones registrados</p>
        </div>
        {puedeCrear && (
          <button
            onClick={() => setModalForm('nuevo')}
            className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-sm font-semibold transition-colors"
          >
            <Plus className="w-4 h-4" /> Nuevo Cupón
          </button>
        )}
      </div>

      {cupones.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
          <Ticket className="w-10 h-10" />
          <p className="text-sm">No hay cupones registrados</p>
        </div>
      ) : (
        <>
          {/* mobile: tarjetas */}
          <div className="sm:hidden space-y-2">
            {cupones.map((c) => (
              <div key={c.id} className="bg-card border border-border rounded-xl p-3.5 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Ticket className="w-4 h-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground truncate font-mono">{c.codigo}</p>
                      <p className="text-xs text-muted-foreground">{c.fecha_expiracion ? `Vence ${c.fecha_expiracion}` : 'Sin vencimiento'}</p>
                    </div>
                  </div>
                  {(puedeEditar || puedeEliminar) && (
                    <div className="flex items-center gap-1 shrink-0">
                      {puedeEditar && (
                        <button onClick={() => setModalForm(c)} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {puedeEliminar && (
                        <button onClick={() => setConfirmar(c)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{etiquetaValor(c)}</span>
                  <BadgeEstado cupon={c} />
                </div>
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{etiquetaUsos(c)}</span>
                  {c.cliente && <span className="flex items-center gap-1"><User className="w-3 h-3" /> {c.cliente.nombre}</span>}
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
                    <th className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Código</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Descuento</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Usos</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Cliente</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Vencimiento</th>
                    <th className="px-5 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Estado</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {cupones.map((c) => (
                    <tr key={c.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-5 py-3.5 font-semibold text-foreground font-mono">{c.codigo}</td>
                      <td className="px-5 py-3.5 font-semibold text-emerald-600 dark:text-emerald-400">{etiquetaValor(c)}</td>
                      <td className="px-5 py-3.5 text-muted-foreground">
                        {etiquetaUsos(c)}
                        {c.limite_por_cliente ? <span className="block text-xs">(máx. {c.limite_por_cliente}/cliente)</span> : null}
                      </td>
                      <td className="px-5 py-3.5 text-muted-foreground">{c.cliente?.nombre ?? '—'}</td>
                      <td className="px-5 py-3.5 text-muted-foreground">{c.fecha_expiracion || 'Sin vencimiento'}</td>
                      <td className="px-5 py-3.5 text-center"><BadgeEstado cupon={c} /></td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-end gap-1">
                          {puedeEditar && (
                            <button onClick={() => setModalForm(c)} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors" title="Editar">
                              <Pencil className="w-4 h-4" />
                            </button>
                          )}
                          {puedeEliminar && (
                            <button onClick={() => setConfirmar(c)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors" title="Eliminar">
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
        <ModalCupon
          cupon={modalForm === 'nuevo' ? null : modalForm}
          onClose={() => setModalForm(null)}
          onExito={() => { setModalForm(null); qc.invalidateQueries({ queryKey: ['cupones'] }); }}
        />
      )}

      {confirmar && (
        <Modal titulo="Eliminar cupón" onClose={() => setConfirmar(null)} ancho="max-w-sm">
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              ¿Eliminar el cupón <span className="font-semibold text-foreground font-mono">"{confirmar.codigo}"</span>?
              {confirmar.usos_actuales > 0 && ' Ya fue usado en una venta, así que solo se desactivará.'}
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmar(null)} className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors">
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

function ModalCupon({ cupon, onClose, onExito }) {
  const esNuevo = !cupon;
  const [codigo, setCodigo]           = useState(cupon?.codigo ?? generarCodigo());
  const [tipo, setTipo]               = useState(cupon?.tipo ?? 'fijo');
  const [valor, setValor]             = useState(cupon?.valor ?? '');
  const [activo, setActivo]           = useState(cupon?.activo ?? 1);
  const [fechaExpiracion, setFechaExpiracion] = useState(cupon?.fecha_expiracion ?? '');
  const [usosMaximos, setUsosMaximos] = useState(cupon?.usos_maximos ?? 1);
  const [limitePorCliente, setLimitePorCliente] = useState(cupon?.limite_por_cliente ?? '');
  const [clienteExclusivo, setClienteExclusivo] = useState(cupon?.cliente ?? null);
  const [buscarCliente, setBuscarCliente] = useState('');
  const [buscandoCliente, setBuscandoCliente] = useState(false);
  const [error, setError] = useState(null);

  const { data: resultadosCliente = [] } = useQuery({
    queryKey: ['clientes-buscar-cupon', buscarCliente],
    queryFn: () => getClientes({ buscar: buscarCliente }),
    enabled: buscandoCliente && buscarCliente.trim().length >= 2,
  });

  const guardar = useMutation({
    mutationFn: () => {
      const comun = {
        tipo, valor: parseFloat(valor), activo, fecha_expiracion: fechaExpiracion || null,
        usos_maximos: parseInt(usosMaximos, 10) || 1,
        limite_por_cliente: limitePorCliente === '' ? null : parseInt(limitePorCliente, 10),
        cliente_id: clienteExclusivo?.id ?? null,
      };
      if (esNuevo) return crearCupon({ codigo, ...comun });
      return actualizarCupon(cupon.id, comun);
    },
    onSuccess: onExito,
    onError: (err) => setError(err?.response?.data?.mensaje ?? 'Error al guardar el cupón'),
  });

  const valido = codigo.trim().length >= 3 && parseFloat(valor) > 0 && (tipo !== 'porcentaje' || parseFloat(valor) <= 100)
    && parseInt(usosMaximos, 10) >= 1
    && (limitePorCliente === '' || parseInt(limitePorCliente, 10) >= 1);

  return (
    <Modal titulo={esNuevo ? 'Nuevo Cupón' : 'Editar Cupón'} onClose={onClose} ancho="max-w-md">
      <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
            Código <span className="text-destructive">*</span>
          </label>
          {esNuevo ? (
            <div className="flex gap-2">
              <input
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                placeholder="PROMO10"
                className="flex-1 bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground font-mono uppercase focus:outline-none focus:ring-2 focus:ring-ring transition"
              />
              <button
                type="button"
                onClick={() => setCodigo(generarCodigo())}
                title="Generar código aleatorio"
                className="shrink-0 px-3 rounded-xl border border-input text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                <Shuffle className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <p className="w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-sm text-foreground font-mono">{codigo}</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Tipo de descuento</label>
            <div className="grid grid-cols-2 gap-2">
              {[{ id: 'fijo', label: 'Bs' }, { id: 'porcentaje', label: '%' }].map((t) => (
                <button
                  key={t.id} type="button" onClick={() => setTipo(t.id)}
                  className={`py-2.5 rounded-xl text-sm font-medium border transition-colors ${
                    tipo === t.id ? 'bg-primary border-primary text-primary-foreground' : 'border-input text-muted-foreground hover:border-primary/50'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              Valor <span className="text-destructive">*</span>
            </label>
            <input
              type="number" step="0.01" min="0" max={tipo === 'porcentaje' ? 100 : undefined}
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              placeholder={tipo === 'porcentaje' ? '10' : '10.00'}
              className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
            Vencimiento <span className="font-normal normal-case">(opcional)</span>
          </label>
          <input
            type="date" value={fechaExpiracion} onChange={(e) => setFechaExpiracion(e.target.value)}
            className="w-full bg-background border border-input rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              Límite total de usos <span className="text-destructive">*</span>
            </label>
            <input
              type="number" min="1" step="1"
              value={usosMaximos}
              onChange={(e) => setUsosMaximos(e.target.value)}
              className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
            />
            {!esNuevo && <p className="text-xs text-muted-foreground mt-1">Ya usado {cupon.usos_actuales} {cupon.usos_actuales === 1 ? 'vez' : 'veces'}.</p>}
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              Límite por cliente <span className="font-normal normal-case">(opcional)</span>
            </label>
            <input
              type="number" min="1" step="1"
              value={limitePorCliente}
              onChange={(e) => setLimitePorCliente(e.target.value)}
              placeholder="Sin límite"
              className="w-full bg-background border border-input rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Exclusivo de un cliente <span className="font-normal normal-case">(opcional, ej. promo de cumpleaños)</span>
          </label>
          {clienteExclusivo ? (
            <div className="flex items-center justify-between gap-2 bg-muted/50 border border-border rounded-xl p-2.5">
              <span className="flex items-center gap-2 text-sm text-foreground truncate">
                <User className="w-4 h-4 text-primary shrink-0" /> {clienteExclusivo.nombre}
              </span>
              <button type="button" onClick={() => setClienteExclusivo(null)} className="p-1 rounded-lg text-muted-foreground hover:text-destructive transition-colors shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="relative">
              <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={buscarCliente}
                onChange={(e) => { setBuscarCliente(e.target.value); setBuscandoCliente(true); }}
                onFocus={() => setBuscandoCliente(true)}
                placeholder="Buscar por nombre o documento..."
                className="w-full bg-background border border-input rounded-xl pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition"
              />
              {buscandoCliente && buscarCliente.trim().length >= 2 && (
                <div className="mt-1 border border-border rounded-xl overflow-hidden max-h-36 overflow-y-auto">
                  {resultadosCliente.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-muted-foreground">Sin resultados</p>
                  ) : resultadosCliente.map((cl) => (
                    <button
                      key={cl.id} type="button"
                      onClick={() => { setClienteExclusivo(cl); setBuscandoCliente(false); setBuscarCliente(''); }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors text-foreground truncate"
                    >
                      {cl.nombre}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Estado</label>
          <button
            type="button"
            onClick={() => setActivo((a) => a ? 0 : 1)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${activo ? 'bg-emerald-500' : 'bg-muted'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${activo ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
          <span className="text-xs text-muted-foreground">{activo ? 'Activo' : 'Inactivo'}</span>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end gap-3 pt-1 border-t border-border">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors">
            Cancelar
          </button>
          <button
            onClick={() => guardar.mutate()}
            disabled={guardar.isPending || !valido}
            className="px-5 py-2 rounded-xl text-sm bg-primary hover:bg-primary/90 text-primary-foreground font-semibold transition-colors disabled:opacity-60"
          >
            {guardar.isPending ? 'Guardando...' : esNuevo ? 'Crear Cupón' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
