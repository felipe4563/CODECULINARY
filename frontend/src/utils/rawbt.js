// Impresión Bluetooth vía RawBT (app de Android que ya sabe emparejarse y
// hablarle a impresoras térmicas por Bluetooth). No hace falta Web Bluetooth
// ni ninguna app propia: se arman los bytes ESC/POS acá mismo (ver escpos.js)
// y se disparan como una URL con esquema `rawbt:`, que Android le pasa
// automáticamente a RawBT si está instalado — mismo mecanismo que "compartir"
// a otra app.
import { buildCaja, buildCocina, ANCHO_LOGO_POR_PAPEL } from './escpos';
import { logoAEscPos } from './logoEscPos';
import { logoSrc } from '../api/configuracion';

// El logo no cambia entre tickets — se cachea por URL+ancho para no
// re-rasterizarlo (leer imagen + canvas + recorrer píxeles) en cada venta.
// El ancho entra en la clave porque la misma caja siempre imprime al mismo
// ancho, pero dos cajas Bluetooth con papel distinto (58mm/80mm) no pueden
// compartir el raster de un logo ya escalado para el otro ancho.
let _logoCache = null; // { key, promise }

function obtenerLogoRasterizado(cfg, anchoPapel) {
  const url = logoSrc(cfg?.logo);
  if (!url) return Promise.resolve(null);
  const key = url + '|' + anchoPapel;
  if (_logoCache?.key === key) return _logoCache.promise;
  const maxAnchoPx = ANCHO_LOGO_POR_PAPEL[anchoPapel] || ANCHO_LOGO_POR_PAPEL['80mm'];
  // Si falla (imagen corrupta, CORS, etc.) el ticket igual sale, solo sin logo.
  const promise = logoAEscPos(url, maxAnchoPx).catch(() => null);
  _logoCache = { key, promise };
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
  const logo = await obtenerLogoRasterizado(datosCaja.config, datosCaja.ancho_papel_bluetooth);
  dispararRawBT(buildCaja(datosCaja, logo));
}

export async function imprimirBluetoothCocina(datosCocina) {
  dispararRawBT(buildCocina(datosCocina));
}
