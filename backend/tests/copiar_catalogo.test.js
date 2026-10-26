const request = require('supertest');
const app = require('../src/app');
const {
  Categoria, Producto, GrupoOpciones, Opcion, ProductoGrupoOpciones, RecetaInsumo, Insumo,
  Combo, ComboProducto, ProductoStockSucursal, sequelize,
} = require('../src/models');
const { copiarCatalogo } = require('../src/modules/productos/copiarCatalogo.service');
const { crearDosSucursales } = require('./helpers/dosSucursales');

describe('Copiar catálogo entre sucursales', () => {
  let ctx, insumo;
  const auth = (token) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    ctx = await crearDosSucursales();
    insumo = await Insumo.create({ nombre: `Insumo Copia ${Date.now()}`, unidad_medida: 'gramo' });
  });

  afterAll(async () => {
    await ctx.limpiar();
    await insumo.destroy();
  });

  // Producto en la sucursal A con un grupo de opciones (2 opciones) y receta
  // base + una línea ligada a una opción.
  async function productoConGrupoYReceta(sufijo) {
    const cat = await Categoria.create({ sucursal_id: ctx.sucursalA.id, nombre: `Cat ${sufijo}` });
    const grupo = await GrupoOpciones.create({ sucursal_id: ctx.sucursalA.id, nombre: `Grupo ${sufijo}`, tipo_seleccion: 'unica' });
    const [chica, grande] = await Opcion.bulkCreate([
      { grupo_opciones_id: grupo.id, nombre: 'Chica', precio_adicional: 0, orden: 0 },
      { grupo_opciones_id: grupo.id, nombre: 'Grande', precio_adicional: 5.5, orden: 1 },
    ]);
    const prod = await Producto.create({ sucursal_id: ctx.sucursalA.id, categoria_id: cat.id, nombre: `Prod ${sufijo}`, precio: 25, stock: null, es_pesable: 0 });
    await ProductoGrupoOpciones.create({ producto_id: prod.id, grupo_opciones_id: grupo.id, orden: 2, obligatorio: 1 });
    await RecetaInsumo.bulkCreate([
      { producto_id: prod.id, opcion_id: null, insumo_id: insumo.id, cantidad: 100 },
      { producto_id: prod.id, opcion_id: grande.id, insumo_id: insumo.id, cantidad: 50 },
    ]);
    return { cat, grupo, chica, grande, prod };
  }

  it('copia un producto con grupo de opciones y receta', async () => {
    const { prod } = await productoConGrupoYReceta('Receta');

    const r = await copiarCatalogo({ origen_id: ctx.sucursalA.id, destino_id: ctx.sucursalB.id, producto_ids: [prod.id] });

    expect(r.creados).toEqual({ categorias: 1, grupos_opciones: 1, productos: 1, combos: 0 });
    expect(r.omitidos).toEqual([]);
    const copiaId = r.mapaProductos[prod.id];
    expect(typeof copiaId).toBe('number');

    const copia = await Producto.findByPk(copiaId, {
      include: [
        { model: Categoria, as: 'categoria' },
        { model: GrupoOpciones, as: 'grupos_opciones', include: [{ model: Opcion, as: 'opciones' }] },
      ],
    });
    expect(copia.sucursal_id).toBe(ctx.sucursalB.id);
    expect(copia.nombre).toBe('Prod Receta');
    expect(parseFloat(copia.precio)).toBe(25);
    expect(copia.categoria.sucursal_id).toBe(ctx.sucursalB.id);
    expect(copia.categoria.nombre).toBe('Cat Receta');

    expect(copia.grupos_opciones).toHaveLength(1);
    const grupo = copia.grupos_opciones[0];
    expect(grupo.sucursal_id).toBe(ctx.sucursalB.id);
    expect(grupo.nombre).toBe('Grupo Receta');
    expect(grupo.ProductoGrupoOpciones.orden).toBe(2);
    expect(!!grupo.ProductoGrupoOpciones.obligatorio).toBe(true);
    const opciones = grupo.opciones.map((o) => ({ nombre: o.nombre, precio: parseFloat(o.precio_adicional) }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
    expect(opciones).toEqual([{ nombre: 'Chica', precio: 0 }, { nombre: 'Grande', precio: 5.5 }]);

    const receta = await RecetaInsumo.findAll({ where: { producto_id: copiaId }, include: [{ model: Opcion, as: 'opcion' }] });
    expect(receta).toHaveLength(2);
    const base = receta.find((l) => l.opcion_id === null);
    expect(base.insumo_id).toBe(insumo.id);
    expect(parseFloat(base.cantidad)).toBe(100);
    const porOpcion = receta.find((l) => l.opcion_id !== null);
    expect(porOpcion.opcion.nombre).toBe('Grande');
    expect(porOpcion.opcion.grupo_opciones_id).toBe(grupo.id);
    expect(parseFloat(porOpcion.cantidad)).toBe(50);
  });

  it('producto con stock en origen queda con stock 0 en destino; producto sin control sigue con stock null', async () => {
    const cat = await Categoria.create({ sucursal_id: ctx.sucursalA.id, nombre: 'Cat Stock' });
    const conStock = await Producto.create({ sucursal_id: ctx.sucursalA.id, categoria_id: cat.id, nombre: 'Prod Con Stock', precio: 10, stock: 7 });
    await ProductoStockSucursal.create({ producto_id: conStock.id, sucursal_id: ctx.sucursalA.id, stock: 7 });
    const sinStock = await Producto.create({ sucursal_id: ctx.sucursalA.id, categoria_id: cat.id, nombre: 'Prod Sin Stock', precio: 10, stock: null });

    const r = await copiarCatalogo({ origen_id: ctx.sucursalA.id, destino_id: ctx.sucursalB.id, categoria_ids: [cat.id] });

    expect(r.creados.productos).toBe(2);
    const copiaCon = await Producto.findByPk(r.mapaProductos[conStock.id]);
    const copiaSin = await Producto.findByPk(r.mapaProductos[sinStock.id]);
    expect(copiaCon.stock).toBe(0);
    expect(copiaSin.stock).toBeNull();
    expect(await ProductoStockSucursal.count({ where: { producto_id: copiaCon.id } })).toBe(0);
  });

  it('copiar dos veces no duplica', async () => {
    const { prod } = await productoConGrupoYReceta('Dos Veces');
    const args = { origen_id: ctx.sucursalA.id, destino_id: ctx.sucursalB.id, producto_ids: [prod.id] };

    const primera = await copiarCatalogo(args);
    expect(primera.creados.productos).toBe(1);
    const categoriasAntes = await Categoria.count({ where: { sucursal_id: ctx.sucursalB.id } });
    const gruposAntes = await GrupoOpciones.count({ where: { sucursal_id: ctx.sucursalB.id } });

    const segunda = await copiarCatalogo(args);
    expect(segunda.creados).toEqual({ categorias: 0, grupos_opciones: 0, productos: 0, combos: 0 });
    expect(segunda.omitidos).toContainEqual({ tipo: 'producto', nombre: 'Prod Dos Veces', motivo: 'ya existe en la sucursal destino' });
    expect(segunda.mapaProductos[prod.id]).toBe(primera.mapaProductos[prod.id]);
    expect(await Categoria.count({ where: { sucursal_id: ctx.sucursalB.id } })).toBe(categoriasAntes);
    expect(await GrupoOpciones.count({ where: { sucursal_id: ctx.sucursalB.id } })).toBe(gruposAntes);
  });

  it('copia un combo con sus productos y cantidades, y no lo duplica', async () => {
    const cat = await Categoria.create({ sucursal_id: ctx.sucursalA.id, nombre: 'Cat Combo Ok' });
    const p1 = await Producto.create({ sucursal_id: ctx.sucursalA.id, categoria_id: cat.id, nombre: 'Prod Combo Ok', precio: 10 });
    const combo = await Combo.create({ sucursal_id: ctx.sucursalA.id, nombre: 'Combo Ok', descripcion: 'desc', precio: 18, dias_semana: '1,2' });
    await ComboProducto.create({ combo_id: combo.id, producto_id: p1.id, cantidad: 3 });

    const r = await copiarCatalogo({ origen_id: ctx.sucursalA.id, destino_id: ctx.sucursalB.id, producto_ids: [p1.id], combo_ids: [combo.id] });
    expect(r.creados.combos).toBe(1);
    const copia = await Combo.findOne({ where: { sucursal_id: ctx.sucursalB.id, nombre: 'Combo Ok' } });
    expect(copia.descripcion).toBe('desc');
    expect(parseFloat(copia.precio)).toBe(18);
    expect(copia.dias_semana).toBe('1,2');
    const lineas = await ComboProducto.findAll({ where: { combo_id: copia.id } });
    expect(lineas.map((l) => ({ producto_id: l.producto_id, cantidad: l.cantidad })))
      .toEqual([{ producto_id: r.mapaProductos[p1.id], cantidad: 3 }]);

    const otra = await copiarCatalogo({ origen_id: ctx.sucursalA.id, destino_id: ctx.sucursalB.id, combo_ids: [combo.id] });
    expect(otra.creados.combos).toBe(0);
    expect(otra.omitidos).toContainEqual({ tipo: 'combo', nombre: 'Combo Ok', motivo: 'ya existe en la sucursal destino' });
  });

  it('combo con un producto no copiado y sin equivalente se omite con motivo', async () => {
    const cat = await Categoria.create({ sucursal_id: ctx.sucursalA.id, nombre: 'Cat Combo Falta' });
    const p = await Producto.create({ sucursal_id: ctx.sucursalA.id, categoria_id: cat.id, nombre: 'Prod Solo En A', precio: 10 });
    const combo = await Combo.create({ sucursal_id: ctx.sucursalA.id, nombre: 'Combo Falta', precio: 15 });
    await ComboProducto.create({ combo_id: combo.id, producto_id: p.id, cantidad: 1 });

    const r = await copiarCatalogo({ origen_id: ctx.sucursalA.id, destino_id: ctx.sucursalB.id, combo_ids: [combo.id] });

    expect(r.creados.combos).toBe(0);
    expect(r.omitidos).toContainEqual({ tipo: 'combo', nombre: 'Combo Falta', motivo: 'falta el producto Prod Solo En A en la sucursal destino' });
    expect(await Combo.count({ where: { sucursal_id: ctx.sucursalB.id, nombre: 'Combo Falta' } })).toBe(0);
  });

  it('una categoría seleccionada sin productos activos igual se crea en el destino', async () => {
    const cat = await Categoria.create({ sucursal_id: ctx.sucursalA.id, nombre: 'Cat Vacia' });
    await Producto.create({ sucursal_id: ctx.sucursalA.id, categoria_id: cat.id, nombre: 'Prod Inactivo', precio: 10, activo: 0 });

    const r = await copiarCatalogo({ origen_id: ctx.sucursalA.id, destino_id: ctx.sucursalB.id, categoria_ids: [cat.id] });

    expect(r.creados).toEqual({ categorias: 1, grupos_opciones: 0, productos: 0, combos: 0 });
    expect(await Categoria.count({ where: { sucursal_id: ctx.sucursalB.id, nombre: 'Cat Vacia' } })).toBe(1);
    expect(await Producto.count({ where: { sucursal_id: ctx.sucursalB.id, nombre: 'Prod Inactivo' } })).toBe(0);
  });

  it('un grupo reutilizado conserva sus opciones; la receta de una opción que no existe ahí se omite', async () => {
    const cat = await Categoria.create({ sucursal_id: ctx.sucursalA.id, nombre: 'Cat Grupo Reusado' });
    const grupoA = await GrupoOpciones.create({ sucursal_id: ctx.sucursalA.id, nombre: 'Grupo Reusado' });
    const extra = await Opcion.create({ grupo_opciones_id: grupoA.id, nombre: 'Extra Queso', precio_adicional: 3 });
    const grupoB = await GrupoOpciones.create({ sucursal_id: ctx.sucursalB.id, nombre: 'Grupo Reusado' });
    await Opcion.create({ grupo_opciones_id: grupoB.id, nombre: 'Solo En B', precio_adicional: 1 });
    const prod = await Producto.create({ sucursal_id: ctx.sucursalA.id, categoria_id: cat.id, nombre: 'Prod Grupo Reusado', precio: 10 });
    await ProductoGrupoOpciones.create({ producto_id: prod.id, grupo_opciones_id: grupoA.id });
    await RecetaInsumo.create({ producto_id: prod.id, opcion_id: extra.id, insumo_id: insumo.id, cantidad: 20 });

    const r = await copiarCatalogo({ origen_id: ctx.sucursalA.id, destino_id: ctx.sucursalB.id, producto_ids: [prod.id] });

    expect(r.creados.grupos_opciones).toBe(0);
    expect(r.creados.productos).toBe(1);
    expect(r.omitidos).toContainEqual({ tipo: 'receta', nombre: 'Prod Grupo Reusado', motivo: 'la opción Extra Queso no existe en el grupo destino' });
    const opcionesB = await Opcion.findAll({ where: { grupo_opciones_id: grupoB.id } });
    expect(opcionesB.map((o) => o.nombre)).toEqual(['Solo En B']);
    const copiaId = r.mapaProductos[prod.id];
    expect(await ProductoGrupoOpciones.count({ where: { producto_id: copiaId, grupo_opciones_id: grupoB.id } })).toBe(1);
    expect(await RecetaInsumo.count({ where: { producto_id: copiaId } })).toBe(0);
  });

  it('ignora ids que no pertenecen a la sucursal origen', async () => {
    const catB = await Categoria.create({ sucursal_id: ctx.sucursalB.id, nombre: 'Cat Ajena' });
    const ajeno = await Producto.create({ sucursal_id: ctx.sucursalB.id, categoria_id: catB.id, nombre: 'Prod Ajeno', precio: 10 });

    const r = await copiarCatalogo({ origen_id: ctx.sucursalA.id, destino_id: ctx.sucursalB.id, producto_ids: [ajeno.id], categoria_ids: [catB.id] });

    expect(r.creados).toEqual({ categorias: 0, grupos_opciones: 0, productos: 0, combos: 0 });
    expect(r.mapaProductos).toEqual({});
  });

  it('usa la transacción recibida: si se revierte, no queda nada', async () => {
    const cat = await Categoria.create({ sucursal_id: ctx.sucursalA.id, nombre: 'Cat Rollback' });
    const prod = await Producto.create({ sucursal_id: ctx.sucursalA.id, categoria_id: cat.id, nombre: 'Prod Rollback', precio: 10 });

    const t = await sequelize.transaction();
    const r = await copiarCatalogo({ origen_id: ctx.sucursalA.id, destino_id: ctx.sucursalB.id, producto_ids: [prod.id] }, { transaction: t });
    expect(r.creados.productos).toBe(1);
    await t.rollback();

    expect(await Producto.count({ where: { sucursal_id: ctx.sucursalB.id, nombre: 'Prod Rollback' } })).toBe(0);
    expect(await Categoria.count({ where: { sucursal_id: ctx.sucursalB.id, nombre: 'Cat Rollback' } })).toBe(0);
  });

  it('sucursal inexistente → 404; origen igual a destino → 400', async () => {
    await expect(copiarCatalogo({ origen_id: ctx.sucursalA.id, destino_id: 999999999 }))
      .rejects.toMatchObject({ status: 404, message: 'Sucursal no encontrada' });
    await expect(copiarCatalogo({ origen_id: ctx.sucursalA.id, destino_id: ctx.sucursalA.id }))
      .rejects.toMatchObject({ status: 400, message: 'La sucursal origen y destino deben ser distintas' });
  });

  describe('POST /productos/copiar', () => {
    it('con usuario de una sola sucursal → 403', async () => {
      const res = await request(app).post('/api/v1/productos/copiar').set(auth(ctx.tokenA))
        .send({ origen_id: ctx.sucursalA.id, destino_id: ctx.sucursalB.id });
      expect(res.status).toBe(403);
      expect(res.body.mensaje).toBe('Solo un usuario con acceso a todas las sucursales puede copiar catálogo');
    });

    it('origen igual a destino → 400', async () => {
      const res = await request(app).post('/api/v1/productos/copiar').set(auth(ctx.tokenGlobal))
        .send({ origen_id: ctx.sucursalA.id, destino_id: ctx.sucursalA.id });
      expect(res.status).toBe(400);
      expect(res.body.mensaje).toBe('La sucursal origen y destino deben ser distintas');
    });

    it('categoria_ids, producto_ids o combo_ids que no son listas → 400', async () => {
      for (const campo of ['categoria_ids', 'producto_ids', 'combo_ids']) {
        const res = await request(app).post('/api/v1/productos/copiar').set(auth(ctx.tokenGlobal))
          .send({ origen_id: ctx.sucursalA.id, destino_id: ctx.sucursalB.id, [campo]: '5' });
        expect(res.status).toBe(400);
        expect(res.body.mensaje).toBe('categoria_ids, producto_ids y combo_ids deben ser listas');
      }
    });

    it('el global copia y recibe creados y omitidos', async () => {
      const cat = await Categoria.create({ sucursal_id: ctx.sucursalA.id, nombre: 'Cat Ruta' });
      await Producto.create({ sucursal_id: ctx.sucursalA.id, categoria_id: cat.id, nombre: 'Prod Ruta', precio: 10 });

      const res = await request(app).post('/api/v1/productos/copiar').set(auth(ctx.tokenGlobal))
        .send({ origen_id: ctx.sucursalA.id, destino_id: ctx.sucursalB.id, categoria_ids: [cat.id] });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.datos.creados).toEqual({ categorias: 1, grupos_opciones: 0, productos: 1, combos: 0 });
      expect(res.body.datos.omitidos).toEqual([]);
      expect(res.body.datos.mapaProductos).toBeUndefined();
    });
  });
});
