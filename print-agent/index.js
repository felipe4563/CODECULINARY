// Punto de entrada — modo instalador o modo agente

// Silencia el ExperimentalWarning del Fetch API global (usado por el
// instalador para consultar sucursales) — no aporta nada al usuario final.
process.on('warning', (warning) => {
  if (warning.name !== 'ExperimentalWarning') console.warn(warning);
});

const args = process.argv.slice(2);

if (args.includes('--service')) {
  if (process.pkg) {
    arrancarServicio();
  } else {
    // En desarrollo (node index.js) no hay exe que reemplazar.
    require('./agent');
  }
} else {
  require('./installer');
}

// Antes de levantar el agente: si la PC recién prendió y hay una actualización
// ya descargada y verificada, se aplica (ver actualizacion.alArrancar).
async function arrancarServicio() {
  const fs   = require('fs');
  const os   = require('os');
  const path = require('path');
  const act  = require('./actualizacion');
  const { version } = require('./package.json');

  const dirBase = path.dirname(process.execPath);
  const log = (msg) => {
    const linea = '[' + new Date().toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '] ' + msg;
    console.log(linea);
    try { fs.appendFileSync(path.join(dirBase, 'agente.log'), linea + '\n'); } catch {}
  };

  // AGENTE_FORZAR_ARRANQUE=1: SOLO para probar el reemplazo a mano (la PC lleva
  // horas prendida); hace de cuenta que Windows recién arrancó. Las tareas
  // programadas no lo definen.
  const uptimeSeg = process.env.AGENTE_FORZAR_ARRANQUE === '1' ? 0 : os.uptime();
  // AGENTE_TIMEOUT_SALUD_MS: SOLO para pruebas (acortar la espera de la vuelta
  // atrás). Por defecto, 60 s.
  const timeoutMs = parseInt(process.env.AGENTE_TIMEOUT_SALUD_MS, 10) > 0
    ? parseInt(process.env.AGENTE_TIMEOUT_SALUD_MS, 10) : 60000;

  let resultado = 'sin_cambios';
  try {
    resultado = await act.alArrancar(Object.assign({
      dirBase,
      versionActual: version,
      uptimeSeg,
      agenteVivo: () => act.agenteVivoSegunLock(path.join(dirBase, 'agente.lock')),
      timeoutMs,
      log,
    }, act.lanzadorReal()));
  } catch (e) {
    log('✗ Error al aplicar la actualización: ' + (e && e.message ? e.message : e));
  }

  // 'aplicado': ya atiende la versión nueva. 'otro_aplicando': otro arranque
  // simultáneo está reemplazando el exe — este se retira sin tocar el puerto.
  if (resultado === 'otro_aplicando') log('.. Otro arranque está aplicando la actualización — este se retira.');
  if (resultado === 'aplicado' || resultado === 'otro_aplicando') process.exit(0);
  require('./agent');
}
