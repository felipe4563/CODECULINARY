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

export async function imprimirBluetoothCocina(datosCocina) {
  dispararRawBT(buildCocina(datosCocina));
}

// Espera a que la pestaña recupere el foco (el usuario corta el ticket a
// mano y vuelve a la app) antes de seguir. A diferencia de un `setTimeout`
// fijo, esto no se pierde si Android pausa la pestaña en segundo plano
// mientras está abierta la app RawBT — el evento `visibilitychange` sí se
// dispara de forma confiable cuando el usuario vuelve, sea que haya tardado
// 2 segundos o 20 cortando el papel. `timeoutMaxMs` es una red de seguridad
// por si el evento nunca llega (navegador raro, no vuelve a la app): no se
// queda esperando para siempre, dispara igual pasado ese tiempo.
function esperarVolverALaApp(timeoutMaxMs = 60_000) {
  return new Promise((resolve) => {
    let seOcultoAlMenosUnaVez = document.hidden;
    let timer;
    const limpiar = () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      clearTimeout(timer);
    };
    const onVisibilityChange = () => {
      if (document.hidden) {
        seOcultoAlMenosUnaVez = true;
        return;
      }
      if (seOcultoAlMenosUnaVez) { limpiar(); resolve(); }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    timer = setTimeout(() => { limpiar(); resolve(); }, timeoutMaxMs);
  });
}

// Cuando una venta genera AMBOS tickets (caja y cocina) por Bluetooth: se
// imprime caja, se espera a que la persona corte el papel y vuelva a la
// app (ver esperarVolverALaApp), y recién ahí se imprime cocina — separados
// de verdad, con el tiempo que haga falta, en vez de una tira continua.
export async function imprimirBluetoothTickets(datosCaja, datosCocina) {
  if (datosCaja) await imprimirBluetoothCaja(datosCaja);
  if (datosCaja && datosCocina) await esperarVolverALaApp();
  if (datosCocina) await imprimirBluetoothCocina(datosCocina);
}
