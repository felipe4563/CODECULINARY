// backend/tests/socket_agentes.test.js
const http = require('http');
const { io: ioClient } = require('socket.io-client');
const { init, estadoAgentes } = require('../src/socket');

describe('socket.js — estado de agentes de impresión', () => {
  let server, port, clientes = [];

  beforeAll((done) => {
    server = http.createServer();
    init(server);
    server.listen(0, () => { port = server.address().port; done(); });
  });

  afterEach(() => {
    clientes.forEach((c) => c.disconnect());
    clientes = [];
  });

  afterAll((done) => {
    server.close(done);
  });

  function conectarCliente() {
    return new Promise((resolve) => {
      const c = ioClient(`http://127.0.0.1:${port}`, { transports: ['websocket'], reconnection: false });
      clientes.push(c);
      c.on('connect', () => resolve(c));
    });
  }

  it('agente:conectado registra el agente en estadoAgentes()', async () => {
    const cliente = await conectarCliente();
    cliente.emit('agente:conectado', { sucursal_id: 4242, caja_id: 77 });
    await new Promise((r) => setTimeout(r, 150));

    expect(estadoAgentes()).toContainEqual(expect.objectContaining({ sucursal_id: 4242, caja_id: 77 }));
  });

  it('al desconectarse el agente desaparece y se emite agente:estado con conectado:false', async () => {
    const agente = await conectarCliente();
    agente.emit('agente:conectado', { sucursal_id: 5151, caja_id: null });
    await new Promise((r) => setTimeout(r, 150));
    expect(estadoAgentes()).toContainEqual(expect.objectContaining({ sucursal_id: 5151, caja_id: null }));

    const observador = await conectarCliente();
    observador.emit('unirse_sucursal', 5151);
    await new Promise((r) => setTimeout(r, 150));

    const eventoPromise = new Promise((resolve) => observador.on('agente:estado', resolve));
    agente.disconnect();
    const evento = await eventoPromise;

    expect(evento).toEqual({ caja_id: null, conectado: false });
    expect(estadoAgentes().find((a) => a.sucursal_id === 5151)).toBeUndefined();
  });
});
