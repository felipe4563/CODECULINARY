// Impresión Bluetooth vía RawBT (app de Android que ya sabe emparejarse y
// hablarle a impresoras térmicas por Bluetooth). No hace falta Web Bluetooth
// ni ninguna app propia: se arman los bytes ESC/POS acá mismo (ver escpos.js)
// y se disparan como una URL con esquema `rawbt:`, que Android le pasa
// automáticamente a RawBT si está instalado — mismo mecanismo que "compartir"
// a otra app.
import { buildCaja, buildCocina } from './escpos';
import { logoAEscPos } from './logoEscPos';
import { logoSrc } from '../api/configuracion';

// El logo no cambia entre tickets — se cachea por URL para no re-rasterizarlo
// (leer imagen + canvas + recorrer píxeles) en cada venta.
let _logoCache = null; // { url, promise }

function obtenerLogoRasterizado(cfg) {
  const url = logoSrc(cfg?.logo);
  if (!url) return Promise.resolve(null);
  if (_logoCache?.url === url) return _logoCache.promise;
  // Si falla (imagen corrupta, CORS, etc.) el ticket igual sale, solo sin logo.
  const promise = logoAEscPos(url).catch(() => null);
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

export async function imprimirBluetoothCocina(datosCocina) {
  dispararRawBT(buildCocina(datosCocina));
}
