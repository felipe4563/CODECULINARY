import { logoSrc } from '../../../api/configuracion';
import Modal from '../../../components/ui/Modal';

// QR propio del negocio: el cliente paga escaneándolo y el cajero confirma
// viendo el comprobante en el celular del cliente. Nada se registra hasta
// que toca "Confirmar pago recibido"; "Volver" no crea ni cobra nada.
export default function ModalQrPropio({ monto, imagen, texto, confirmando, error, onConfirmar, onVolver }) {
  return (
    <Modal titulo="Cobro por QR" onClose={confirmando ? () => {} : onVolver} ancho="max-w-sm">
      <div className="space-y-4 text-center">
        {imagen ? (
          <img
            src={logoSrc(imagen)}
            alt="QR de pago del negocio"
            className="mx-auto w-56 h-56 sm:w-64 sm:h-64 rounded-xl border border-border object-contain bg-white"
          />
        ) : (
          <p className="text-sm text-destructive">No hay imagen de QR configurada.</p>
        )}
        {texto && <p className="text-sm text-muted-foreground">{texto}</p>}

        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Monto a pagar</p>
          <p className="text-4xl font-bold text-foreground">Bs {Number(monto).toFixed(2)}</p>
        </div>

        <p className="text-xs text-muted-foreground">
          Revisá en el comprobante del cliente el <b>monto</b>, la <b>fecha y hora</b> y el <b>destinatario</b> antes de confirmar.
        </p>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex flex-col gap-2">
          <button
            onClick={onConfirmar}
            disabled={confirmando || !imagen}
            className="w-full py-3 rounded-xl text-sm bg-green-600 hover:bg-green-700 text-white font-semibold transition-colors disabled:opacity-60"
          >
            {confirmando ? 'Registrando...' : 'Confirmar pago recibido'}
          </button>
          <button
            onClick={onVolver}
            disabled={confirmando}
            className="w-full py-2 rounded-xl text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-60"
          >
            Volver
          </button>
        </div>
      </div>
    </Modal>
  );
}
