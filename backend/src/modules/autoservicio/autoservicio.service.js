const { SesionCaja } = require('../../models');
const mesasService = require('../mesas/mesas.service');
const ventasService = require('../ventas/ventas.service');
const { listarProductos } = require('../productos/productos.service');

async function _mesaConSesionActiva(codigo_qr) {
  const mesa = await mesasService.obtenerMesaPorCodigoQr(codigo_qr);
  const sesion = await mesasService.obtenerSesionActiva(mesa.id);
  if (!sesion) {
    throw Object.assign(
      new Error('Esta mesa no está habilitada para pedir ahora. Llamá al mozo o cajero.'),
      { status: 409 }
    );
  }
  return { mesa, sesion };
}

async function obtenerMenu(codigo_qr) {
  const { mesa } = await _mesaConSesionActiva(codigo_qr);
  const alcance = { sucursal_id: mesa.area.sucursal_id, acceso_todas: false };
  const productos = await listarProductos({ solo_vendibles: true, solo_disponibles: true }, alcance);
  return { mesa: { id: mesa.id, nombre: mesa.nombre }, productos };
}

async function crearPedido(codigo_qr, { items }) {
  const { mesa, sesion } = await _mesaConSesionActiva(codigo_qr);

  const sesionCaja = await SesionCaja.findOne({ where: { sucursal_id: mesa.area.sucursal_id, estado: 'abierta' } });
  if (!sesionCaja) {
    throw Object.assign(new Error('El local no está tomando pedidos por autoservicio en este momento.'), { status: 409 });
  }

  return ventasService.crearCompleta({
    tipo: 'mesa',
    mesa_id: mesa.id,
    items,
    metodo_pago: 'qr',
    sesion_caja_id: sesionCaja.id,
    usuario_id: sesionCaja.usuario_id,
    cliente_id: null,
    mesa_sesion_id: sesion.id,
    origen: 'autoservicio',
  });
}

async function consultarEstadoPedido(codigo_qr, pedido_id) {
  const { sesion } = await _mesaConSesionActiva(codigo_qr);
  const resultado = await ventasService.consultarEstadoPagoQr(pedido_id, null);
  if (resultado.pedido.mesa_sesion_id !== sesion.id) {
    // Evita que alguien consulte el estado de un pedido ajeno probando ids
    // al azar — solo se puede consultar un pedido de la sesión activa
    // resuelta por ESTE código QR.
    throw Object.assign(new Error('Pedido no encontrado'), { status: 404 });
  }
  return resultado;
}

module.exports = { obtenerMenu, crearPedido, consultarEstadoPedido };
