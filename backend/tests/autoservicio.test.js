const request = require('supertest');
const app = require('../src/app');
const { Sucursal, Area, Mesa, MesaSesion } = require('../src/models');

describe('Autoservicio API', () => {
  it('GET .../mesa/:codigo_qr con código inexistente → 404', async () => {
    const res = await request(app).get('/api/v1/autoservicio/mesa/no-existe-123');
    expect(res.status).toBe(404);
  });

  describe('con una mesa real', () => {
    let sucursal, area, mesa;

    beforeAll(async () => {
      sucursal = await Sucursal.create({ nombre: 'Sucursal Autoservicio Test' });
      area = await Area.create({ nombre: 'Area Autoservicio Test', sucursal_id: sucursal.id });
      mesa = await Mesa.create({ area_id: area.id, nombre: 'Mesa Autoservicio Test', codigo_qr: 'test-qr-001' });
    });

    afterAll(async () => {
      await MesaSesion.destroy({ where: { mesa_id: mesa.id } });
      await Mesa.destroy({ where: { id: mesa.id } });
      await Area.destroy({ where: { id: area.id } });
      await Sucursal.destroy({ where: { id: sucursal.id } });
    });

    it('mesa sin sesión activa → 409 al pedir el menú', async () => {
      const res = await request(app).get(`/api/v1/autoservicio/mesa/${mesa.codigo_qr}`);
      expect(res.status).toBe(409);
    });

    it('mesa con sesión activa → devuelve el menú', async () => {
      await MesaSesion.create({ mesa_id: mesa.id, sucursal_id: sucursal.id, abierta_por: 'staff' });
      const res = await request(app).get(`/api/v1/autoservicio/mesa/${mesa.codigo_qr}`);
      expect(res.status).toBe(200);
      expect(res.body.datos.mesa.id).toBe(mesa.id);
      expect(Array.isArray(res.body.datos.productos)).toBe(true);
    });

    it('crear pedido sin caja abierta en la sucursal → 409', async () => {
      const res = await request(app)
        .post(`/api/v1/autoservicio/mesa/${mesa.codigo_qr}/pedido`)
        .send({ items: [{ producto_id: 1, cantidad: 1 }] });
      expect(res.status).toBe(409);
    });

    it('crear pedido sin items → 400', async () => {
      const res = await request(app)
        .post(`/api/v1/autoservicio/mesa/${mesa.codigo_qr}/pedido`)
        .send({ items: [] });
      expect(res.status).toBe(400);
    });
  });
});
