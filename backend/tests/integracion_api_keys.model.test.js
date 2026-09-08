const { Sucursal, IntegracionApiKey } = require('../src/models');

describe('Modelo IntegracionApiKey', () => {
  let sucursal;

  beforeAll(async () => {
    sucursal = await Sucursal.create({ nombre: 'Sucursal Integracion Test' });
  });

  afterAll(async () => {
    await IntegracionApiKey.destroy({ where: { sucursal_id: sucursal.id } });
    await Sucursal.destroy({ where: { id: sucursal.id } });
  });

  it('crea una key con activo=true por defecto', async () => {
    const key = await IntegracionApiKey.create({
      sucursal_id: sucursal.id, nombre_app: 'PedidosYa', api_key_hash: 'hash-de-prueba',
    });
    expect(key.activo).toBe(true);
  });

  it('se borra en cascada si se borra la sucursal', async () => {
    const sucursalTemp = await Sucursal.create({ nombre: 'Sucursal Cascada Test' });
    await IntegracionApiKey.create({
      sucursal_id: sucursalTemp.id, nombre_app: 'Test', api_key_hash: 'hash-cascada',
    });
    await sucursalTemp.destroy();
    const restantes = await IntegracionApiKey.findAll({ where: { sucursal_id: sucursalTemp.id } });
    expect(restantes.length).toBe(0);
  });
});
