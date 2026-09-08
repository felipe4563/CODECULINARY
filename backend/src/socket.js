const { Server } = require('socket.io');

let _io = null;

// socket.id -> { sucursal_id, caja_ids, conectado_en } — solo agentes de
// impresión física que se identificaron con 'agente:conectado' (ver
// print-agent/agent.js). Un navegador de staff normal nunca emite ese
// evento, así que nunca aparece acá. caja_ids es un array porque una misma
// PC/agente puede atender más de una caja (una sola impresora para varios
// puntos de cobro).
const agentesConectados = new Map();

function init(server) {
  const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map(o => o.trim());

  _io = new Server(server, {
    cors: {
      // Acepta los orígenes configurados + el agente de impresión (sin origin)
      origin: (origin, cb) => {
        if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
        cb(new Error('socket.io CORS: ' + origin));
      },
      methods: ['GET', 'POST'],
    },
  });
  _io.on('connection', (socket) => {
    console.log('Socket conectado:', socket.id);
    socket.on('unirse_sucursal', (sucursal_id) => {
      if (sucursal_id) socket.join(`sucursal:${sucursal_id}`);
    });
    // Sala por caja: permite mandar el ticket de venta solo al agente de
    // impresión de la caja que hizo la venta, en vez de a todas las cajas
    // de la sucursal (ver print:caja en emitir()).
    socket.on('unirse_caja', (caja_id) => {
      if (caja_id) socket.join(`caja:${caja_id}`);
    });
    // El agente de impresión física se identifica apenas conecta (ver
    // print-agent/agent.js) — a diferencia de unirse_sucursal/unirse_caja
    // (que también usan pantallas de staff normales), esto es exclusivo
    // del agente, así que sirve para saber "está vivo" desde el backend.
    socket.on('agente:conectado', ({ sucursal_id, caja_id, caja_ids } = {}) => {
      if (!sucursal_id) return;
      // Compatibilidad: agentes viejos (antes de la selección múltiple de
      // cajas) mandan un único `caja_id` en vez de `caja_ids`.
      const idsFinal = Array.isArray(caja_ids) && caja_ids.length ? caja_ids : (caja_id ? [caja_id] : []);
      agentesConectados.set(socket.id, { sucursal_id, caja_ids: idsFinal, conectado_en: Date.now() });
      if (idsFinal.length) {
        idsFinal.forEach((id) => emitir('agente:estado', { caja_id: id, conectado: true }, sucursal_id));
      } else {
        emitir('agente:estado', { caja_id: null, conectado: true }, sucursal_id);
      }
    });
    socket.on('disconnect', () => {
      console.log('Socket desconectado:', socket.id);
      const info = agentesConectados.get(socket.id);
      if (info) {
        agentesConectados.delete(socket.id);
        if (info.caja_ids.length) {
          info.caja_ids.forEach((id) => emitir('agente:estado', { caja_id: id, conectado: false }, info.sucursal_id));
        } else {
          emitir('agente:estado', { caja_id: null, conectado: false }, info.sucursal_id);
        }
      }
    });
  });
  return _io;
}

function emitir(evento, datos = {}, sucursal_id = null, caja_id = null) {
  if (!_io) return;
  if (caja_id) {
    _io.to(`caja:${caja_id}`).emit(evento, datos);
  } else if (sucursal_id) {
    _io.to(`sucursal:${sucursal_id}`).emit(evento, datos);
  } else {
    _io.emit(evento, datos);
  }
}

// Aplana un agente con varias cajas en una fila por cada una — así
// obtenerEstadoAgentes() (que arma un Set de caja_id) marca conectadas TODAS
// las cajas que ese agente atiende, no solo la primera.
function estadoAgentes() {
  const filas = [];
  for (const info of agentesConectados.values()) {
    if (info.caja_ids.length) {
      info.caja_ids.forEach((caja_id) => filas.push({ sucursal_id: info.sucursal_id, caja_id, conectado_en: info.conectado_en }));
    } else {
      filas.push({ sucursal_id: info.sucursal_id, caja_id: null, conectado_en: info.conectado_en });
    }
  }
  return filas;
}

module.exports = { init, emitir, estadoAgentes };
