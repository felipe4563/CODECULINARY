// backend/tests/socket_agentes.test.js
const http = require('http');
const { io: ioClient } = require('socket.io-client');
const { init, estadoAgentes, desconexionesAgentes } = require('../src/socket');

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

  it('al desconectarse registra la hora de la caída por cada caja del agente', async () => {
    const agente = await conectarCliente();
    agente.emit('agente:conectado', { sucursal_id: 6161, caja_ids: [881, 882] });
    await new Promise((r) => setTimeout(r, 150));

    const antes = Date.now();
    agente.disconnect();
    await new Promise((r) => setTimeout(r, 150));

    const { desconexiones } = desconexionesAgentes();
    expect(desconexiones.get(881)).toBeGreaterThanOrEqual(antes);
    expect(desconexiones.get(882)).toBeGreaterThanOrEqual(antes);
  });

  it('guarda versión/pendiente/autoactualización y un re-emit del mismo socket actualiza la fila', async () => {
    const agente = await conectarCliente();
    agente.emit('agente:conectado', { sucursal_id: 7171, caja_ids: [991], version: '1.1.0', version_pendiente: null, autoactualizacion: true });
    await new Promise((r) => setTimeout(r, 150));
    const antes = estadoAgentes().filter((a) => a.sucursal_id === 7171);
    expect(antes).toHaveLength(1);
    expect(antes[0]).toEqual(expect.objectContaining({ version: '1.1.0', version_pendiente: null, autoactualizacion: true }));

    agente.emit('agente:conectado', { sucursal_id: 7171, caja_ids: [991], version: '1.1.0', version_pendiente: '1.2.0', autoactualizacion: true });
    await new Promise((r) => setTimeout(r, 150));
    const despues = estadoAgentes().filter((a) => a.sucursal_id === 7171);
    expect(despues).toHaveLength(1);
    expect(despues[0].version_pendiente).toBe('1.2.0');
    expect(despues[0].conectado_en).toBe(antes[0].conectado_en);
  });

  it('agente viejo sin los campos → version/pendiente/autoactualizacion null', async () => {
    const agente = await conectarCliente();
    agente.emit('agente:conectado', { sucursal_id: 7272, caja_id: 992 });
    await new Promise((r) => setTimeout(r, 150));
    expect(estadoAgentes().find((a) => a.sucursal_id === 7272)).toEqual(
      expect.objectContaining({ version: null, version_pendiente: null, autoactualizacion: null }));
  });
});
