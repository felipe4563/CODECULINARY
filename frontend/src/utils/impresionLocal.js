import { imprimirTicketVenta } from './ticketVenta';
import { imprimirTicketCocina } from './ticketCocina';

// Manda el ticket directo al agente de impresión instalado en ESTA PC
// (http://127.0.0.1, nunca sale a Internet). Es el camino principal de
// impresión: no depende de que el agente tenga el socket.io conectado al
// servidor. El backend igual emite el mismo evento por socket como respaldo
// (por si el agente está en otra PC, o si esta falla), y el propio agente
// deduplica para no imprimir el mismo pedido dos veces.
const PUERTO_AGENTE_LOCAL = 4321;
const TIMEOUT_MS = 1500;

function postConTimeout(url, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: controller.signal,
  }).finally(() => clearTimeout(timer));
}

// `forzar` salta la deduplicación de 5 minutos del agente (pensada para no
// imprimir dos veces el mismo pedido cuando llega por socket y local casi
// al mismo tiempo). Úsalo solo para una reimpresión explícita pedida por el
// usuario (botón "Imprimir de nuevo"), nunca para el auto-print inicial.
export function imprimirLocal(datosImpresion, { forzar = false } = {}) {
  if (!datosImpresion) return;
  const base = `http://127.0.0.1:${PUERTO_AGENTE_LOCAL}`;
  const qs = forzar ? '?forzar=1' : '';
  if (datosImpresion.caja) {
    postConTimeout(`${base}/imprimir/caja${qs}`, datosImpresion.caja).catch(() => {
      // Sin agente local en esta PC: no pasa nada, el socket.io del backend
      // ya mandó el mismo ticket como respaldo.
    });
  }
  if (datosImpresion.cocina) {
    postConTimeout(`${base}/imprimir/cocina${qs}`, datosImpresion.cocina).catch(() => {});
  }
}

// Para el botón "Imprimir de nuevo": intenta el agente local primero (con
// forzar=1, saltando la deduplicación) y, si el agente no responde (apagado,
// CORS, timeout), cae automáticamente al diálogo de impresión del navegador
// con el mismo ticket, para que el usuario elija una impresora de Windows.
// Solo se usa para la reimpresión manual — el auto-print inicial no tiene
// fallback (ver imprimirLocal arriba).
export function reimprimirConFallback(datosImpresion) {
  if (!datosImpresion) return;
  const base = `http://127.0.0.1:${PUERTO_AGENTE_LOCAL}`;

  if (datosImpresion.caja) {
    postConTimeout(`${base}/imprimir/caja?forzar=1`, datosImpresion.caja).catch(() => {
      const { pedido, metodo_pago, config, numero_orden_diario } = datosImpresion.caja;
      imprimirTicketVenta(pedido, { total: pedido.total, metodo_pago }, config, numero_orden_diario);
    });
  }
  if (datosImpresion.cocina) {
    postConTimeout(`${base}/imprimir/cocina?forzar=1`, datosImpresion.cocina).catch(() => {
      const { pedido, config, numero_orden_diario } = datosImpresion.cocina;
      imprimirTicketCocina(pedido, config, numero_orden_diario);
    });
  }
}
