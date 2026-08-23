const { Server } = require('socket.io');

let _io = null;

// socket.id -> { sucursal_id, caja_id, conectado_en } — solo agentes de
// impresión física que se identificaron con 'agente:conectado' (ver
// print-agent/agent.js). Un navegador de staff normal nunca emite ese
// evento, así que nunca aparece acá.
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
    socket.on('agente:conectado', ({ sucursal_id, caja_id } = {}) => {
      if (!sucursal_id) return;
      agentesConectados.set(socket.id, { sucursal_id, caja_id: caja_id || null, conectado_en: Date.now() });
      emitir('agente:estado', { caja_id: caja_id || null, conectado: true }, sucursal_id);
    });
    socket.on('disconnect', () => {
      console.log('Socket desconectado:', socket.id);
      const info = agentesConectados.get(socket.id);
      if (info) {
        agentesConectados.delete(socket.id);
        emitir('agente:estado', { caja_id: info.caja_id, conectado: false }, info.sucursal_id);
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

function estadoAgentes() {
  return Array.from(agentesConectados.values());
}

module.exports = { init, emitir, estadoAgentes };
