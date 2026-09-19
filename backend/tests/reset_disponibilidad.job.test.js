// backend/tests/reset_disponibilidad.job.test.js
const { Categoria, Producto } = require('../src/models');
const { resetDisponibilidadDiaria } = require('../src/jobs/resetDisponibilidad.job');

describe('Job: reset de disponibilidad diaria', () => {
  let categoriaId, noDisponibleId, yaDisponibleId;

  beforeAll(async () => {
    const categoria = await Categoria.create({ nombre: 'Categoria Reset Disponibilidad Test' });
    categoriaId = categoria.id;
    const noDisponible = await Producto.create({ categoria_id: categoriaId, nombre: 'Producto Reset No Disponible Test', precio: 10, disponible_hoy: false });
    noDisponibleId = noDisponible.id;
    const yaDisponible = await Producto.create({ categoria_id: categoriaId, nombre: 'Producto Reset Ya Disponible Test', precio: 10, disponible_hoy: true });
    yaDisponibleId = yaDisponible.id;
  });

  afterAll(async () => {
    await Producto.destroy({ where: { categoria_id: categoriaId } });
    await Categoria.destroy({ where: { id: categoriaId } });
  });

  it('pone en true todos los productos marcados como no disponibles', async () => {
    const { afectados } = await resetDisponibilidadDiaria();
    expect(afectados).toBeGreaterThanOrEqual(1);

    const producto = await Producto.findByPk(noDisponibleId);
    expect(producto.disponible_hoy).toBe(1);
  });

  it('no rompe nada en un producto que ya estaba disponible', async () => {
    await resetDisponibilidadDiaria();
    const producto = await Producto.findByPk(yaDisponibleId);
    expect(producto.disponible_hoy).toBe(1);
  });
});
