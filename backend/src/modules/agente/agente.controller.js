const fs = require('fs');
const path = require('path');

// El directorio se resuelve en cada request para poder apuntarlo a un temporal en tests.
const dirDist = () => process.env.AGENTE_DIST_DIR || path.join(__dirname, '../../../agente-dist');

// Devuelve el agente.json tal cual: el agente de impresión lo lee directo (sin envolver en `datos`).
const version = (req, res) => {
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(path.join(dirDist(), 'agente.json'), 'utf8'));
  } catch {
    return res.status(404).json({ ok: false, mensaje: 'No hay una versión del agente publicada' });
  }
  res.json(meta);
};

const descargar = (req, res) => {
  const ruta = path.join(dirDist(), 'agente-impresion.exe');
  let stat;
  try {
    stat = fs.statSync(ruta);
  } catch {
    return res.status(404).json({ ok: false, mensaje: 'No hay un agente publicado para descargar' });
  }
  res.set({
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(stat.size),
    'Content-Disposition': 'attachment; filename="agente-impresion.exe"',
  });
  fs.createReadStream(ruta).on('error', () => res.destroy()).pipe(res);
};

module.exports = { version, descargar };
