const request = require('supertest');
const app = require('../src/app');
const { Sucursal, Area, Mesa, MesaSesion } = require('../src/models');

describe('Modelo MesaSesion', () => {
  let sucursalId, areaId, mesaId, sesionId;

  beforeAll(async () => {
    const sucursal = await Sucursal.create({ nombre: 'Sucursal MesaSesion Test' });
    sucursalId = sucursal.id;
    const area = await Area.create({ nombre: 'Area MesaSesion Test', sucursal_id: sucursalId });
    areaId = area.id;
    const mesa = await Mesa.create({ area_id: areaId, nombre: 'Mesa MesaSesion Test' });
    mesaId = mesa.id;
  });

  afterAll(async () => {
    await MesaSesion.destroy({ where: { mesa_id: mesaId } });
    await Mesa.destroy({ where: { id: mesaId } });
    await Area.destroy({ where: { id: areaId } });
    await Sucursal.destroy({ where: { id: sucursalId } });
  });

  it('crea una sesión de mesa y la recupera vía la asociación', async () => {
    const sesion = await MesaSesion.create({ mesa_id: mesaId, sucursal_id: sucursalId, abierta_por: 'autoservicio' });
    sesionId = sesion.id;

    const mesa = await Mesa.findByPk(mesaId, { include: [{ model: MesaSesion, as: 'sesiones' }] });
    expect(mesa.sesiones).toHaveLength(1);
    expect(mesa.sesiones[0].id).toBe(sesionId);
    expect(mesa.sesiones[0].cerrada_en).toBeNull();
  });

  it('sanidad: la app sigue arrancando con el modelo nuevo cargado', async () => {
    const res = await request(app).get('/api/v1/salud');
    expect(res.status).toBe(200);
  });
});
