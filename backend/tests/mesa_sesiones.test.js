const { Sucursal, Area, Mesa } = require('../src/models');
const mesasService = require('../src/modules/mesas/mesas.service');

describe('mesas.service — sesión de mesa y código QR', () => {
  let sucursalId, areaId, mesaId;

  beforeAll(async () => {
    const sucursal = await Sucursal.create({ nombre: 'Sucursal Sesion Test' });
    sucursalId = sucursal.id;
    const area = await Area.create({ nombre: 'Area Sesion Test', sucursal_id: sucursalId });
    areaId = area.id;
  });

  afterAll(async () => {
    await Mesa.destroy({ where: { area_id: areaId } });
    await Area.destroy({ where: { id: areaId } });
    await Sucursal.destroy({ where: { id: sucursalId } });
  });

  it('crearMesa genera un codigo_qr único', async () => {
    const mesa = await mesasService.crearMesa({ area_id: areaId, nombre: 'Mesa QR 1' }, sucursalId);
    mesaId = mesa.id;
    expect(mesa.codigo_qr).toEqual(expect.any(String));
    expect(mesa.codigo_qr.length).toBeGreaterThanOrEqual(16);
  });

  it('obtenerSesionActiva devuelve null si no hay sesión abierta', async () => {
    const sesion = await mesasService.obtenerSesionActiva(mesaId);
    expect(sesion).toBeNull();
  });

  it('abrirSesion crea una sesión y obtenerSesionActiva la encuentra', async () => {
    const abierta = await mesasService.abrirSesion(mesaId, sucursalId, 'staff');
    expect(abierta.cerrada_en).toBeNull();

    const activa = await mesasService.obtenerSesionActiva(mesaId);
    expect(activa.id).toBe(abierta.id);
  });

  it('abrirSesion es idempotente: si ya hay una activa, devuelve la misma en vez de crear otra', async () => {
    const primera = await mesasService.obtenerSesionActiva(mesaId);
    const segunda = await mesasService.abrirSesion(mesaId, sucursalId, 'staff');
    expect(segunda.id).toBe(primera.id);
  });

  it('cerrarSesion deja la mesa sin sesión activa', async () => {
    await mesasService.cerrarSesion(mesaId);
    const activa = await mesasService.obtenerSesionActiva(mesaId);
    expect(activa).toBeNull();
  });

  it('obtenerMesaPorCodigoQr resuelve la mesa con su área', async () => {
    const mesa = await Mesa.findByPk(mesaId);
    const resuelta = await mesasService.obtenerMesaPorCodigoQr(mesa.codigo_qr);
    expect(resuelta.id).toBe(mesaId);
    expect(resuelta.area.sucursal_id).toBe(sucursalId);
  });

  it('obtenerMesaPorCodigoQr con código inexistente lanza 404', async () => {
    await expect(mesasService.obtenerMesaPorCodigoQr('codigo-que-no-existe')).rejects.toMatchObject({ status: 404 });
  });

  // Regresión: la edición manual de mesas no tocaba mesa_sesiones, así que
  // liberar la mesa desde Configuración → Mesas dejaba viva la sesión de
  // autoservicio y el QR fijo seguía aceptando pedidos pagados de una mesa
  // que ya nadie está atendiendo.
  it('actualizarMesa a un estado distinto de "ocupada" cierra la sesión activa', async () => {
    await mesasService.abrirSesion(mesaId, sucursalId, 'staff');
    expect(await mesasService.obtenerSesionActiva(mesaId)).not.toBeNull();

    await mesasService.actualizarMesa(mesaId, { estado: 'disponible' }, { sucursal_id: sucursalId, acceso_todas: false });

    expect(await mesasService.obtenerSesionActiva(mesaId)).toBeNull();
  });

  it('actualizarMesa sin tocar el estado no cierra la sesión activa', async () => {
    await mesasService.abrirSesion(mesaId, sucursalId, 'staff');

    await mesasService.actualizarMesa(mesaId, { asientos: 6 }, { sucursal_id: sucursalId, acceso_todas: false });

    expect(await mesasService.obtenerSesionActiva(mesaId)).not.toBeNull();
    await mesasService.cerrarSesion(mesaId);
  });
});
