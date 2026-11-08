// Lógica base de la auto-actualización del agente de impresión.
// Módulo sin efectos al cargarse: NO requiere agent.js (que arranca el agente
// al importarlo). Solo usa módulos nativos de Node.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

// Compara versiones "x.y.z" numéricamente (1.10.0 > 1.2.0). Devuelve -1, 0 o 1.
function compararVersiones(a, b) {
  const pa = String(a).split('.').map(function(n) { return parseInt(n, 10) || 0; });
  const pb = String(b).split('.').map(function(n) { return parseInt(n, 10) || 0; });
  const largo = Math.max(pa.length, pb.length);
  for (let i = 0; i < largo; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

// ¿La PC recién prendió? (menos de 15 min encendida)
function esArranqueDePC(uptimeSegundos) {
  return uptimeSegundos < 900;
}

// ¿El salto de reloj entre dos latidos indica que la PC estuvo dormida/hibernada? (>= 2 h)
function esVueltaDeHibernacion(saltoMs) {
  return saltoMs >= 2 * 3600 * 1000;
}

// Solo se descarga de HTTPS, o de HTTP únicamente si es la propia máquina (desarrollo).
function urlPermitida(servidor) {
  let u;
  try { u = new URL(servidor); } catch { return false; }
  if (u.protocol === 'https:') return true;
  return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
}

// Rutas absolutas de todos los archivos que intervienen en la actualización.
function rutas(dirBase) {
  const base = path.resolve(dirBase);
  const carpeta = path.join(base, 'actualizacion');
  return {
    exe:           path.join(base, 'agente-impresion.exe'),
    anterior:      path.join(base, 'agente-impresion.anterior.exe'),
    carpeta:       carpeta,
    pendienteExe:  path.join(carpeta, 'agente-impresion.pendiente.exe'),
    pendienteJson: path.join(carpeta, 'pendiente.json'),
    fallidasJson:  path.join(carpeta, 'fallidas.json'),
    aplicandoLock: path.join(carpeta, 'aplicando.lock'),
  };
}

// SHA-256 (hex) de un archivo, leído en streaming.
function sha256Archivo(ruta) {
  return new Promise(function(resolve, reject) {
    const hash = crypto.createHash('sha256');
    const s = fs.createReadStream(ruta);
    s.on('error', reject);
    s.on('data', function(d) { hash.update(d); });
    s.on('end', function() { resolve(hash.digest('hex')); });
  });
}

// ¿El archivo existe, pesa lo esperado y su hash coincide? Cualquier error => false.
async function verificarArchivo(ruta, sha256, tamano) {
  try {
    if (fs.statSync(ruta).size !== tamano) return false;
    const real = await sha256Archivo(ruta);
    return real.toLowerCase() === String(sha256).toLowerCase();
  } catch { return false; }
}

// Versiones que fallaron al aplicarse y no deben reintentarse.
function leerFallidas(dirBase) {
  try {
    const lista = JSON.parse(fs.readFileSync(rutas(dirBase).fallidasJson, 'utf8'));
    return Array.isArray(lista) ? lista : [];
  } catch { return []; }
}

function marcarFallida(dirBase, version) {
  const r = rutas(dirBase);
  const lista = leerFallidas(dirBase);
  if (lista.indexOf(version) !== -1) return;
  lista.push(version);
  fs.mkdirSync(r.carpeta, { recursive: true });
  fs.writeFileSync(r.fallidasJson, JSON.stringify(lista), 'utf8');
}

// Datos de la actualización ya descargada y esperando ser aplicada, o null.
function leerPendiente(dirBase) {
  try {
    const p = JSON.parse(fs.readFileSync(rutas(dirBase).pendienteJson, 'utf8'));
    if (p && typeof p.version === 'string' && typeof p.sha256 === 'string' && typeof p.tamano === 'number') {
      return { version: p.version, sha256: p.sha256, tamano: p.tamano };
    }
    return null;
  } catch { return null; }
}

// ¿El PID es un agente vivo? No alcanza con que el PID exista:
// si la PC se apagó de golpe (corte de luz, apagado forzado) el lock queda
// con el PID de ayer, y al prender Windows REUTILIZA esos números — el PID
// viejo suele pertenecer ahora a otro programa (un servicio, el antivirus).
// Antes eso bastaba para que el agente creyera que ya había otro corriendo y
// se cerrara, y la vigía repetía lo mismo cada 2 min todo el día ("ayer
// funcionaba, hoy no"). Por eso se compara también el nombre del ejecutable
// con el propio (agente-impresion.exe en producción, node.exe en dev).
function esAgenteVivo(pid) {
  try {
    const out = execSync('tasklist /FI "PID eq ' + pid + '" /FO CSV /NH', { encoding: 'utf8' });
    const propio = path.basename(process.execPath).toLowerCase();
    return out.split(/\r?\n/).some(function(linea) {
      const campos = linea.split('","').map(function(c) { return c.replace(/^"|"$/g, '').trim(); });
      return campos.length > 1 && campos[1] === String(pid) && campos[0].toLowerCase() === propio;
    });
  } catch { return false; }
}

function borrarSilencioso(ruta) { try { fs.unlinkSync(ruta); } catch {} }

// Descarga `url` a `destino` en streaming. Sin tope total: solo corta si pasan
// `inactividadMs` sin recibir datos.
async function descargarAArchivo(fetchImpl, url, destino, inactividadMs) {
  const ctrl = new AbortController();
  let timer = setTimeout(function() { ctrl.abort(); }, inactividadMs);
  const reiniciar = function() { clearTimeout(timer); timer = setTimeout(function() { ctrl.abort(); }, inactividadMs); };
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    if (!res.body) throw new Error('respuesta sin cuerpo');
    const salida = fs.createWriteStream(destino);
    // El 'error' se escucha desde el inicio: un fallo de escritura (disco lleno,
    // archivo bloqueado) no debe quedar sin manejar ni dejar la espera colgada.
    let falloEscritura = null;
    let avisarFallo;
    const fallo = new Promise(function(_, reject) { avisarFallo = reject; });
    fallo.catch(function() {});
    salida.on('error', function(e) { falloEscritura = e; avisarFallo(e); });
    const lector = res.body.getReader();
    try {
      for (;;) {
        if (falloEscritura) throw falloEscritura;
        const { done, value } = await Promise.race([lector.read(), fallo]);
        if (done) break;
        reiniciar();
        if (!salida.write(value)) {
          await Promise.race([new Promise(function(r) { salida.once('drain', r); }), fallo]);
        }
      }
      if (falloEscritura) throw falloEscritura;
      await Promise.race([new Promise(function(resolve) { salida.end(resolve); }), fallo]);
    } catch (e) {
      salida.destroy();
      lector.cancel().catch(function() {});
      throw e;
    }
  } finally { clearTimeout(timer); }
}

// Consulta al servidor si hay una versión más nueva y, de haberla, la deja
// descargada y verificada como pendiente. NUNCA reemplaza el exe en uso.
async function revisarYDescargar(opts) {
  const servidor = opts.servidor, dirBase = opts.dirBase, versionActual = opts.versionActual;
  const log = opts.log || function() {};
  const fetchImpl = opts.fetchImpl || fetch;
  if (!urlPermitida(servidor)) return { estado: 'sin_https' };
  const r = rutas(dirBase);
  const base = String(servidor).replace(/\/+$/, '');
  try {
    // Un pendiente que ya no sirve (versión <= la actual) se descarta.
    let pend = leerPendiente(dirBase);
    if (pend && compararVersiones(pend.version, versionActual) <= 0) {
      borrarSilencioso(r.pendienteExe);
      borrarSilencioso(r.pendienteJson);
      pend = null;
    }

    const ctrl = new AbortController();
    const t = setTimeout(function() { ctrl.abort(); }, 10000);
    let info;
    try {
      const res = await fetchImpl(base + '/api/v1/agente/version', { signal: ctrl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      info = await res.json();
    } finally { clearTimeout(t); }
    if (!info || typeof info.version !== 'string' || typeof info.sha256 !== 'string' || typeof info.tamano !== 'number') {
      throw new Error('respuesta de versión inválida');
    }

    if (compararVersiones(info.version, versionActual) <= 0) return { estado: 'al_dia', version: info.version };
    if (leerFallidas(dirBase).indexOf(info.version) !== -1) return { estado: 'fallida', version: info.version };

    if (pend && pend.version === info.version && await verificarArchivo(r.pendienteExe, pend.sha256, pend.tamano)) {
      return { estado: 'ya_pendiente', version: info.version };
    }

    log('Descargando actualización ' + info.version + '...');
    fs.mkdirSync(r.carpeta, { recursive: true });
    const tmp = r.pendienteExe + '.tmp';
    borrarSilencioso(tmp);
    try {
      await descargarAArchivo(fetchImpl, base + '/api/v1/agente/descargar', tmp, 30000);
      if (!(await verificarArchivo(tmp, info.sha256, info.tamano))) throw new Error('la descarga no coincide con el hash/tamaño esperado');
      borrarSilencioso(r.pendienteJson);
      fs.renameSync(tmp, r.pendienteExe);
      fs.writeFileSync(r.pendienteJson, JSON.stringify({ version: info.version, sha256: info.sha256, tamano: info.tamano }), 'utf8');
    } catch (e) {
      borrarSilencioso(tmp);
      throw e;
    }
    log('Actualización ' + info.version + ' descargada; se aplicará al prender la PC');
    return { estado: 'descargado', version: info.version };
  } catch (e) {
    const causa = (e && e.cause && e.cause.code) ? ' (' + e.cause.code + ')' : '';
    return { estado: 'error', error: ((e && e.message) || String(e)) + causa };
  }
}

module.exports = {
  compararVersiones, esArranqueDePC, esVueltaDeHibernacion, urlPermitida,
  rutas, sha256Archivo, verificarArchivo, leerFallidas, marcarFallida,
  leerPendiente, esAgenteVivo, revisarYDescargar,
};
