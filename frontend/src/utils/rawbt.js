// Impresión Bluetooth vía RawBT (app de Android que ya sabe emparejarse y
// hablarle a impresoras térmicas por Bluetooth). No hace falta Web Bluetooth
// ni ninguna app propia: se arman los bytes ESC/POS acá mismo (ver escpos.js)
// y se disparan como una URL con esquema `rawbt:`, que Android le pasa
// automáticamente a RawBT si está instalado — mismo mecanismo que "compartir"
// a otra app.
import { buildCaja, buildCocina, LOGO_MAX_PX } from './escpos';
import { logoAEscPos } from './logoEscPos';
import { logoSrc } from '../api/configuracion';

// El logo no cambia entre tickets — se cachea por URL para no re-rasterizarlo
// (leer imagen + canvas + recorrer píxeles) en cada venta. El tamaño del
// logo (~30x30mm, ver LOGO_MAX_PX) es el mismo sin importar el ancho de
// papel de la caja, así que no hace falta separar la caché por ancho.
let _logoCache = null; // { url, promise }

function obtenerLogoRasterizado(cfg) {
  const url = logoSrc(cfg?.logo);
  if (!url) return Promise.resolve(null);
  if (_logoCache?.url === url) return _logoCache.promise;
  // Si falla (imagen corrupta, CORS, etc.) el ticket igual sale, solo sin logo.
  const promise = logoAEscPos(url, LOGO_MAX_PX, LOGO_MAX_PX).catch(() => null);
  _logoCache = { url, promise };
  return promise;
}

function bytesABase64(bytes) {
  let binario = '';
  for (let i = 0; i < bytes.length; i++) binario += String.fromCharCode(bytes[i]);
  return btoa(binario);
}

// Un <a> invisible en vez de `window.location.href`: si RawBT no está
// instalado, Android/Chrome se limitan a no hacer nada — no navega la SPA
// a una página de error ni pierde el estado de la pantalla actual.
function dispararRawBT(bytes) {
  const a = document.createElement('a');
  a.href = 'rawbt:base64,' + bytesABase64(bytes);
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 1000);
}

export async function imprimirBluetoothCaja(datosCaja) {
  const logo = await obtenerLogoRasterizado(datosCaja.config);
  dispararRawBT(buildCaja(datosCaja, logo));
}

// Cuando hay que imprimir también el de cocina, este NO se dispara solo
// (ver por qué en store/impresionStore.js: un segundo `rawbt:` automático
// —por tiempo fijo o esperando que la pestaña recupere el foco— no salía
// confiable). En su lugar, quien maneje la impresora aprieta el botón
// "Imprimir cocina" (BotonCocinaPendiente.jsx) cuando ya cortó el ticket de
// caja y está lista/o — este export es lo que ese botón termina llamando.
export async function imprimirBluetoothCocina(datosCocina) {
  dispararRawBT(buildCocina(datosCocina));
}
