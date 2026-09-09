// backend/tests/combo_opciones_receta.test.js
// Regresión: una opción elegida para un producto DENTRO de un combo debe
// disparar su línea de receta (RecetaInsumo ligada a esa opcion_id), igual
// que ya pasaba para productos sueltos — ver ventas.service.js, loop de
// combo.productos en cobrar().
const {
  Sucursal, Categoria, Producto, Usuario, Rol, Caja, SesionCaja, Pedido, DetallePedido,
  GrupoOpciones, Opcion, Combo, ComboProducto, DetallePedidoComboOpcion,
  Insumo, InsumoStockSucursal, RecetaInsumo, LibroCaja,
} = require('../src/models');
const bcrypt = require('bcryptjs');
const { cobrar } = require('../src/modules/ventas/ventas.service');

describe('Receta de insumos ligada a una opción dentro de un combo', () => {
  let sucursalId, usuarioId, cajaId, sesionId;
  let categoriaId, productoId, grupoId, opcionConId, opcionSinId, comboId, insumoId;

  beforeAll(async () => {
    const sucursal = await Sucursal.create({ nombre: 'Sucursal Combo Receta Test' });
    sucursalId = sucursal.id;
    const rol = await Rol.findOne({ where: { nombre: 'Cajero' } });
    const hash = await bcrypt.hash('clave123', 10);
    const usuario = await Usuario.create({ rol_id: rol.id, nombre: 'Combo Receta Test', email: 'combo-receta-test@restaurante.com', contrasena: hash });
    usuarioId = usuario.id;
    const caja = await Caja.create({ sucursal_id: sucursalId, nombre: 'Caja Combo Receta Test' });
    cajaId = caja.id;
    const sesion = await SesionCaja.create({ usuario_id: usuarioId, sucursal_id: sucursalId, caja_id: cajaId, monto_apertura: 0 });
    sesionId = sesion.id;

    const categoria = await Categoria.create({ nombre: 'Categoria Combo Receta Test' });
    categoriaId = categoria.id;
    const producto = await Producto.create({ categoria_id: categoria.id, nombre: 'Cafe Combo Receta Test', precio: 5, stock: null });
    productoId = producto.id;

    const grupo = await GrupoOpciones.create({ nombre: 'Azucar Combo Receta Test', tipo_seleccion: 'unica' });
    grupoId = grupo.id;
    const opcionCon = await Opcion.create({ grupo_opciones_id: grupo.id, nombre: 'Con azucar', precio_adicional: 0, orden: 0 });
    opcionConId = opcionCon.id;
    const opcionSin = await Opcion.create({ grupo_opciones_id: grupo.id, nombre: 'Sin azucar', precio_adicional: 0, orden: 1 });
    opcionSinId = opcionSin.id;

    const insumo = await Insumo.create({ nombre: 'Azucar Combo Receta Test', unidad_medida: 'gramo' });
    insumoId = insumo.id;
    await InsumoStockSucursal.create({ insumo_id: insumoId, sucursal_id: sucursalId, stock: 1000 });

    // Receta: "Con azucar" descuenta 25g. "Sin azucar" no tiene línea propia
    // (no debe descontar nada). Sin línea "Base": el producto no consume
    // insumo si no se elige ninguna opción con receta.
    await RecetaInsumo.create({ producto_id: productoId, opcion_id: opcionConId, insumo_id: insumoId, cantidad: 25 });

    const combo = await Combo.create({ nombre: 'Combo Cafe Receta Test', precio: 10 });
    comboId = combo.id;
    await ComboProducto.create({ combo_id: comboId, producto_id: productoId, cantidad: 1 });
  });

  afterAll(async () => {
    // cobrar() asienta cada venta en LibroCaja — hay que limpiarlo antes de
    // borrar el usuario, o la FK usuario_id lo bloquea.
    await LibroCaja.destroy({ where: { sesion_caja_id: sesionId } });
    await Pedido.destroy({ where: { sucursal_id: sucursalId } });
    await ComboProducto.destroy({ where: { combo_id: comboId } });
    await Combo.destroy({ where: { id: comboId } });
    await RecetaInsumo.destroy({ where: { producto_id: productoId } });
    await InsumoStockSucursal.destroy({ where: { insumo_id: insumoId } });
    await Insumo.destroy({ where: { id: insumoId } });
    await Opcion.destroy({ where: { grupo_opciones_id: grupoId } });
    await GrupoOpciones.destroy({ where: { id: grupoId } });
    await Producto.destroy({ where: { id: productoId } });
    await Categoria.destroy({ where: { id: categoriaId } });
    await SesionCaja.destroy({ where: { id: sesionId } });
    await Caja.destroy({ where: { id: cajaId } });
    await Usuario.destroy({ where: { id: usuarioId } });
    await Sucursal.destroy({ where: { id: sucursalId } });
  });

  async function stockActual() {
    const fila = await InsumoStockSucursal.findOne({ where: { insumo_id: insumoId, sucursal_id: sucursalId } });
    return Number(fila.stock);
  }

  it('vender el combo eligiendo "Con azucar" descuenta los 25g de la receta', async () => {
    const pedido = await Pedido.create({
      sucursal_id: sucursalId, usuario_id: usuarioId, sesion_caja_id: sesionId,
      tipo: 'llevar', estado: 'pendiente', total: 10,
    });
    const detalle = await DetallePedido.create({ pedido_id: pedido.id, combo_id: comboId, cantidad: 1, precio: 10 });
    await DetallePedidoComboOpcion.create({ detalle_pedido_id: detalle.id, producto_id: productoId, opcion_id: opcionConId });

    const antes = await stockActual();
    await cobrar(pedido.id, usuarioId, { metodo_pago: 'efectivo', monto_recibido: 10 }, { sucursal_id: sucursalId });
    const despues = await stockActual();

    expect(antes - despues).toBe(25);
  });

  it('vender el combo eligiendo "Sin azucar" no descuenta nada del insumo', async () => {
    const pedido = await Pedido.create({
      sucursal_id: sucursalId, usuario_id: usuarioId, sesion_caja_id: sesionId,
      tipo: 'llevar', estado: 'pendiente', total: 10,
    });
    const detalle = await DetallePedido.create({ pedido_id: pedido.id, combo_id: comboId, cantidad: 1, precio: 10 });
    await DetallePedidoComboOpcion.create({ detalle_pedido_id: detalle.id, producto_id: productoId, opcion_id: opcionSinId });

    const antes = await stockActual();
    await cobrar(pedido.id, usuarioId, { metodo_pago: 'efectivo', monto_recibido: 10 }, { sucursal_id: sucursalId });
    const despues = await stockActual();

    expect(antes - despues).toBe(0);
  });
});
