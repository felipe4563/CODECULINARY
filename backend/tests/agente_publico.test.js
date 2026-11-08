const request = require('supertest');
const fs = require('fs');
const os = require('os');
const path = require('path');
const app = require('../src/app');

describe('Endpoints públicos del agente de impresión', () => {
  let dir;
  const anterior = process.env.AGENTE_DIST_DIR;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agente-dist-'));
    process.env.AGENTE_DIST_DIR = dir;
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    if (anterior === undefined) delete process.env.AGENTE_DIST_DIR;
    else process.env.AGENTE_DIST_DIR = anterior;
  });

  it('sin archivos publicados responde 404 en ambos', async () => {
    const v = await request(app).get('/api/v1/agente/version');
    expect(v.status).toBe(404);
    expect(v.body.ok).toBe(false);
    const d = await request(app).get('/api/v1/agente/descargar');
    expect(d.status).toBe(404);
    expect(d.body.ok).toBe(false);
  });

  it('publica version y binario sin autenticación', async () => {
    const meta = { version: '1.1.0', sha256: 'abc', tamano: 4, generado_en: '2026-11-08T00:00:00.000Z' };
    fs.writeFileSync(path.join(dir, 'agente.json'), JSON.stringify(meta));
    fs.writeFileSync(path.join(dir, 'agente-impresion.exe'), 'hola');

    const v = await request(app).get('/api/v1/agente/version');
    expect(v.status).toBe(200);
    expect(v.body).toEqual(meta);

    const d = await request(app).get('/api/v1/agente/descargar').buffer(true).parse((res, cb) => {
      const partes = [];
      res.on('data', (c) => partes.push(c));
      res.on('end', () => cb(null, Buffer.concat(partes)));
    });
    expect(d.status).toBe(200);
    expect(d.headers['content-type']).toMatch(/^application\/octet-stream/);
    expect(d.headers['content-length']).toBe('4');
    expect(d.body.toString()).toBe('hola');
  });
});
