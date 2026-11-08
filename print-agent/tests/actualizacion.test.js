const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const act = require('../actualizacion');

function dirTemp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'act-test-')); }

test('compararVersiones compara numéricamente', () => {
  assert.equal(act.compararVersiones('1.2.0', '1.10.0'), -1);
  assert.equal(act.compararVersiones('1.1.0', '1.1.0'), 0);
  assert.equal(act.compararVersiones('2.0.0', '1.9.9'), 1);
});

test('esArranqueDePC', () => {
  assert.equal(act.esArranqueDePC(899), true);
  assert.equal(act.esArranqueDePC(900), false);
});

test('esVueltaDeHibernacion', () => {
  assert.equal(act.esVueltaDeHibernacion(2 * 3600 * 1000), true);
  assert.equal(act.esVueltaDeHibernacion(2 * 3600 * 1000 - 1), false);
});

test('urlPermitida', () => {
  assert.equal(act.urlPermitida('https://salybrasas.codewave.com.bo'), true);
  assert.equal(act.urlPermitida('http://localhost:3002'), true);
  assert.equal(act.urlPermitida('http://127.0.0.1:3001'), true);
  assert.equal(act.urlPermitida('http://192.168.1.10:3001'), false);
  assert.equal(act.urlPermitida('http://ejemplo.com'), false);
  assert.equal(act.urlPermitida('no-url'), false);
});

test('rutas', () => {
  const d = path.resolve(os.tmpdir(), 'base');
  const r = act.rutas(d);
  assert.equal(r.exe, path.join(d, 'agente-impresion.exe'));
  assert.equal(r.anterior, path.join(d, 'agente-impresion.anterior.exe'));
  assert.equal(r.carpeta, path.join(d, 'actualizacion'));
  assert.equal(r.pendienteExe, path.join(d, 'actualizacion', 'agente-impresion.pendiente.exe'));
  assert.equal(r.pendienteJson, path.join(d, 'actualizacion', 'pendiente.json'));
  assert.equal(r.fallidasJson, path.join(d, 'actualizacion', 'fallidas.json'));
  assert.equal(r.aplicandoLock, path.join(d, 'actualizacion', 'aplicando.lock'));
});

test('verificarArchivo', async () => {
  const f = path.join(dirTemp(), 'a.bin');
  fs.writeFileSync(f, 'hola');
  const h = crypto.createHash('sha256').update('hola').digest('hex');
  assert.equal(await act.sha256Archivo(f), h);
  assert.equal(await act.verificarArchivo(f, h, 4), true);
  assert.equal(await act.verificarArchivo(f, 'x'.repeat(64), 4), false);
  assert.equal(await act.verificarArchivo(f, h, 5), false);
  assert.equal(await act.verificarArchivo(f + '.no', h, 4), false);
});

test('marcarFallida es idempotente y crea la carpeta', () => {
  const d = dirTemp();
  assert.deepEqual(act.leerFallidas(d), []);
  act.marcarFallida(d, '1.2.0');
  act.marcarFallida(d, '1.2.0');
  assert.deepEqual(act.leerFallidas(d), ['1.2.0']);
});

test('leerPendiente', () => {
  const d = dirTemp();
  assert.equal(act.leerPendiente(d), null);
  fs.mkdirSync(act.rutas(d).carpeta);
  fs.writeFileSync(act.rutas(d).pendienteJson, '{no json');
  assert.equal(act.leerPendiente(d), null);
  fs.writeFileSync(act.rutas(d).pendienteJson, JSON.stringify({ version: '1.2.0', sha256: 'ab', tamano: 3 }));
  assert.deepEqual(act.leerPendiente(d), { version: '1.2.0', sha256: 'ab', tamano: 3 });
});

test('esAgenteVivo', () => {
  assert.equal(act.esAgenteVivo(process.pid), true);
  assert.equal(act.esAgenteVivo(999999), false);
});

// ---- revisarYDescargar ----
const http = require('http');

// Servidor local que imita /api/v1/agente/version y /descargar.
function servidorAgente(opciones) {
  const o = Object.assign({ version: '1.2.0', contenido: Buffer.from('EXE-FALSO-' + 'x'.repeat(5000)), shaMal: false, version404: false }, opciones);
  const sha = crypto.createHash('sha256').update(o.contenido).digest('hex');
  const stats = { descargas: 0, versiones: 0 };
  const srv = http.createServer((req, res) => {
    if (req.url === '/api/v1/agente/version') {
      stats.versiones++;
      if (o.version404) { res.statusCode = 404; return res.end('{}'); }
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({
        version: o.version, sha256: o.shaMal ? 'a'.repeat(64) : sha,
        tamano: o.contenido.length, generado_en: new Date().toISOString(),
      }));
    }
    if (req.url === '/api/v1/agente/descargar') {
      stats.descargas++;
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', o.contenido.length);
      return res.end(o.contenido);
    }
    res.statusCode = 404; res.end();
  });
  return new Promise(resolve => srv.listen(0, '127.0.0.1', () => {
    resolve({ srv, stats, url: 'http://127.0.0.1:' + srv.address().port, sha, contenido: o.contenido });
  }));
}
const cerrar = s => new Promise(r => { s.srv.close(r); s.srv.closeAllConnections && s.srv.closeAllConnections(); });
const logNulo = () => {};

test('revisarYDescargar: al día no crea archivos', async () => {
  const s = await servidorAgente({ version: '1.1.0' });
  const dir = dirTemp();
  try {
    const r = await act.revisarYDescargar({ servidor: s.url, dirBase: dir, versionActual: '1.1.0', log: logNulo });
    assert.equal(r.estado, 'al_dia');
    assert.equal(fs.existsSync(act.rutas(dir).carpeta), false);
    assert.equal(s.stats.descargas, 0);
  } finally { await cerrar(s); }
});

test('revisarYDescargar: descarga, verifica y segunda llamada es ya_pendiente', async () => {
  const s = await servidorAgente();
  const dir = dirTemp();
  try {
    const r = await act.revisarYDescargar({ servidor: s.url, dirBase: dir, versionActual: '1.1.0', log: logNulo });
    assert.equal(r.estado, 'descargado');
    assert.equal(r.version, '1.2.0');
    const p = act.leerPendiente(dir);
    assert.equal(p.version, '1.2.0');
    assert.equal(await act.verificarArchivo(act.rutas(dir).pendienteExe, p.sha256, p.tamano), true);
    assert.equal(fs.existsSync(act.rutas(dir).pendienteExe + '.tmp'), false);
    const r2 = await act.revisarYDescargar({ servidor: s.url, dirBase: dir, versionActual: '1.1.0', log: logNulo });
    assert.equal(r2.estado, 'ya_pendiente');
    assert.equal(s.stats.descargas, 1);
  } finally { await cerrar(s); }
});

test('revisarYDescargar: sha incorrecto => error sin pendiente ni .tmp', async () => {
  const s = await servidorAgente({ shaMal: true });
  const dir = dirTemp();
  try {
    const r = await act.revisarYDescargar({ servidor: s.url, dirBase: dir, versionActual: '1.1.0', log: logNulo });
    assert.equal(r.estado, 'error');
    const rt = act.rutas(dir);
    assert.equal(fs.existsSync(rt.pendienteJson), false);
    assert.equal(fs.existsSync(rt.pendienteExe), false);
    assert.equal(fs.existsSync(rt.pendienteExe + '.tmp'), false);
  } finally { await cerrar(s); }
});

test('revisarYDescargar: versión en fallidas => fallida sin descargar', async () => {
  const s = await servidorAgente();
  const dir = dirTemp();
  try {
    act.marcarFallida(dir, '1.2.0');
    const r = await act.revisarYDescargar({ servidor: s.url, dirBase: dir, versionActual: '1.1.0', log: logNulo });
    assert.equal(r.estado, 'fallida');
    assert.equal(s.stats.descargas, 0);
  } finally { await cerrar(s); }
});

test('revisarYDescargar: 404 en /version => error', async () => {
  const s = await servidorAgente({ version404: true });
  const dir = dirTemp();
  try {
    const r = await act.revisarYDescargar({ servidor: s.url, dirBase: dir, versionActual: '1.1.0', log: logNulo });
    assert.equal(r.estado, 'error');
  } finally { await cerrar(s); }
});

test('revisarYDescargar: servidor caído => error', async () => {
  const s = await servidorAgente();
  const url = s.url;
  await cerrar(s);
  const r = await act.revisarYDescargar({ servidor: url, dirBase: dirTemp(), versionActual: '1.1.0', log: logNulo });
  assert.equal(r.estado, 'error');
});

test('revisarYDescargar: http no local => sin_https sin requests', async () => {
  let llamadas = 0;
  const r = await act.revisarYDescargar({
    servidor: 'http://192.168.1.10:3001', dirBase: dirTemp(), versionActual: '1.1.0', log: logNulo,
    fetchImpl: async () => { llamadas++; throw new Error('no debería'); },
  });
  assert.equal(r.estado, 'sin_https');
  assert.equal(llamadas, 0);
});

test('revisarYDescargar: pendiente viejo (<= actual) se borra', async () => {
  const s = await servidorAgente({ version: '1.1.0' });
  const dir = dirTemp();
  try {
    const rt = act.rutas(dir);
    fs.mkdirSync(rt.carpeta, { recursive: true });
    fs.writeFileSync(rt.pendienteExe, 'viejo');
    fs.writeFileSync(rt.pendienteJson, JSON.stringify({ version: '1.0.5', sha256: 'b'.repeat(64), tamano: 5 }));
    const r = await act.revisarYDescargar({ servidor: s.url, dirBase: dir, versionActual: '1.1.0', log: logNulo });
    assert.equal(r.estado, 'al_dia');
    assert.equal(fs.existsSync(rt.pendienteExe), false);
    assert.equal(fs.existsSync(rt.pendienteJson), false);
  } finally { await cerrar(s); }
});

test('revisarYDescargar: falla al escribir el .tmp => error sin lanzar ni colgar', async () => {
  const s = await servidorAgente({ contenido: crypto.randomBytes(8 * 1024 * 1024) });
  const dir = dirTemp();
  try {
    const rt = act.rutas(dir);
    // El .tmp es una carpeta: createWriteStream falla (EISDIR).
    fs.mkdirSync(rt.pendienteExe + '.tmp', { recursive: true });
    const r = await Promise.race([
      act.revisarYDescargar({ servidor: s.url, dirBase: dir, versionActual: '1.1.0', log: logNulo }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('colgado')), 5000)),
    ]);
    assert.equal(r.estado, 'error');
    assert.equal(fs.existsSync(rt.pendienteJson), false);
    assert.equal(fs.existsSync(rt.pendienteExe), false);
  } finally { await cerrar(s); }
});

test('revisarYDescargar: 404 en /descargar => error sin pendiente', async () => {
  const s = await servidorAgente();
  s.srv.removeAllListeners('request');
  s.srv.on('request', (req, res) => {
    if (req.url === '/api/v1/agente/version') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ version: '1.2.0', sha256: s.sha, tamano: s.contenido.length, generado_en: 'x' }));
    }
    res.statusCode = 404; res.end();
  });
  const dir = dirTemp();
  try {
    const r = await act.revisarYDescargar({ servidor: s.url, dirBase: dir, versionActual: '1.1.0', log: logNulo });
    assert.equal(r.estado, 'error');
    assert.equal(fs.existsSync(act.rutas(dir).pendienteJson), false);
  } finally { await cerrar(s); }
});
