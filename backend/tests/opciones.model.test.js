const { GrupoOpciones, Opcion, Producto, Categoria, ProductoGrupoOpciones } = require('../src/models');

describe('Modelos GrupoOpciones y Opcion', () => {
  let categoriaId;

  beforeAll(async () => {
    const cat = await Categoria.create({ nombre: 'Categoria Opciones Model Test' });
    categoriaId = cat.id;
  });

  afterAll(async () => {
    await Producto.destroy({ where: { categoria_id: categoriaId } });
    await Categoria.destroy({ where: { id: categoriaId } });
  });

  it('crea un grupo de opciones con sus opciones asociadas', async () => {
    const grupo = await GrupoOpciones.create({ nombre: 'Término de cocción Model Test' });
    await Opcion.bulkCreate([
      { grupo_opciones_id: grupo.id, nombre: 'Jugoso', orden: 1 },
      { grupo_opciones_id: grupo.id, nombre: 'Término medio', orden: 2 },
    ]);

    const recargado = await GrupoOpciones.findByPk(grupo.id, { include: [{ model: Opcion, as: 'opciones' }] });
    expect(recargado.opciones).toHaveLength(2);

    await Opcion.destroy({ where: { grupo_opciones_id: grupo.id } });
    await grupo.destroy();
  });

  it('un producto puede asignarse a un grupo de opciones vía la tabla puente, y al borrar el grupo se quita la asignación', async () => {
    const grupo = await GrupoOpciones.create({ nombre: 'Sabor Model Test' });
    const producto = await Producto.create({ categoria_id: categoriaId, nombre: 'Jugo Model Test', precio: 10 });
    await ProductoGrupoOpciones.create({ producto_id: producto.id, grupo_opciones_id: grupo.id, orden: 0, obligatorio: 0 });

    const recargado = await Producto.findByPk(producto.id, { include: [{ model: GrupoOpciones, as: 'grupos_opciones' }] });
    expect(recargado.grupos_opciones.map((g) => g.nombre)).toEqual(['Sabor Model Test']);

    await grupo.destroy(); // ON DELETE CASCADE en producto_grupos_opciones — no debe fallar por el producto asignado
    const asignaciones = await ProductoGrupoOpciones.findAll({ where: { producto_id: producto.id } });
    expect(asignaciones).toHaveLength(0);
  });
});
