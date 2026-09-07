// backend/tests/detalle_pedido_combo_opciones.test.js
const {
  Sucursal, Area, Mesa, Categoria, Producto, ProductoStockSucursal, Usuario, Rol,
  Caja, SesionCaja, Pedido, DetallePedido, GrupoOpciones, Opcion, Combo, ComboProducto,
  DetallePedidoComboOpcion,
} = require('../src/models');
const bcrypt = require('bcryptjs');

describe('DetallePedidoComboOpcion — cascada de borrado', () => {
  let sucursalId, usuarioId, cajaId, sesionId, pedidoId, detalleId, opcionId, productoId;

  beforeAll(async () => {
    const sucursal = await Sucursal.create({ nombre: 'Sucursal Combo Opciones Test' });
    sucursalId = sucursal.id;
    const rol = await Rol.findOne({ where: { nombre: 'Cajero' } });
    const hash = await bcrypt.hash('clave123', 10);
    const usuario = await Usuario.create({ rol_id: rol.id, nombre: 'Combo Opciones Test', email: 'combo-opciones-test@restaurante.com', contrasena: hash });
    usuarioId = usuario.id;
    const caja = await Caja.create({ sucursal_id: sucursalId, nombre: 'Caja Combo Opciones Test' });
    cajaId = caja.id;
    const sesion = await SesionCaja.create({ usuario_id: usuarioId, sucursal_id: sucursalId, caja_id: cajaId, monto_apertura: 0 });
    sesionId = sesion.id;

    const categoria = await Categoria.create({ nombre: 'Categoria Combo Opciones Test' });
    const producto = await Producto.create({ categoria_id: categoria.id, nombre: 'Producto Combo Opciones Test', precio: 5, stock: 0 });
    productoId = producto.id;

    const grupo = await GrupoOpciones.create({ nombre: 'Tamaño Combo Opciones Test', tipo_seleccion: 'unica' });
    const opcion = await Opcion.create({ grupo_opciones_id: grupo.id, nombre: 'Grande', precio_adicional: 3, orden: 0 });
    opcionId = opcion.id;

    const combo = await Combo.create({ nombre: 'Combo Test Cascada', precio: 20 });
    await ComboProducto.create({ combo_id: combo.id, producto_id: productoId, cantidad: 1 });

    const pedido = await Pedido.create({
      sucursal_id: sucursalId, usuario_id: usuarioId, sesion_caja_id: sesionId,
      tipo: 'llevar', estado: 'completado', total: 23,
    });
    pedidoId = pedido.id;
    const detalle = await DetallePedido.create({ pedido_id: pedido.id, combo_id: combo.id, cantidad: 1, precio: 23 });
    detalleId = detalle.id;
    await DetallePedidoComboOpcion.create({ detalle_pedido_id: detalleId, producto_id: productoId, opcion_id: opcionId });
  });

  afterAll(async () => {
    await Pedido.destroy({ where: { id: pedidoId } });
    await SesionCaja.destroy({ where: { id: sesionId } });
    await Caja.destroy({ where: { id: cajaId } });
    await Usuario.destroy({ where: { id: usuarioId } });
    await Sucursal.destroy({ where: { id: sucursalId } });
  });

  it('la fila de opciones existe antes de borrar el detalle', async () => {
    const filas = await DetallePedidoComboOpcion.findAll({ where: { detalle_pedido_id: detalleId } });
    expect(filas.length).toBe(1);
  });

  it('borrar el DetallePedido borra en cascada sus filas de detalle_pedido_combo_opciones', async () => {
    await DetallePedido.destroy({ where: { id: detalleId } });
    const filas = await DetallePedidoComboOpcion.findAll({ where: { detalle_pedido_id: detalleId } });
    expect(filas.length).toBe(0);
  });
});
