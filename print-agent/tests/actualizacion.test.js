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
