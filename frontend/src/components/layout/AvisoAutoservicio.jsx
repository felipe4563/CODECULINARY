import { useEffect, useState } from 'react';
import { ShoppingBag } from 'lucide-react';
import socket from '../../socket';

export default function AvisoAutoservicio() {
  const [aviso, setAviso] = useState(null);

  useEffect(() => {
    function onConfirmado(datos) {
      setAviso(datos);
      setTimeout(() => setAviso(null), 6000);
    }
    socket.on('restaurante:autoservicio_confirmado', onConfirmado);
    return () => socket.off('restaurante:autoservicio_confirmado', onConfirmado);
  }, []);

  if (!aviso) return null;

  return (
    <div
      className="fixed top-5 right-5 z-[100] px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white bg-violet-600 flex items-center gap-2"
      style={{ animation: 'toastIn .25s ease both' }}
    >
      <style>{`@keyframes toastIn { from { opacity:0; transform:translateX(20px); } to { opacity:1; transform:translateX(0); } }`}</style>
      <ShoppingBag className="w-4 h-4" />
      Autoservicio — {aviso.mesa ?? 'Mesa'}: Bs {parseFloat(aviso.monto || 0).toFixed(2)}
    </div>
  );
}
