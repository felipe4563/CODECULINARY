const { SesionCaja, Pedido } = require('../../models');
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

// Tope de pedidos con pago QR en curso por sesión de mesa. Cada POST dispara
// una llamada real (y facturable) a CodePay para generar el QR, y el endpoint
// es anónimo: quien haya fotografiado el QR de una mesa podría scriptearlo.
// No es un rate limiter con ventana de tiempo (eso queda para un middleware
// dedicado, fuera de alcance acá): simplemente no se deja acumular más de
// MAX_PAGOS_PENDIENTES pagos sin resolver en la misma sesión.
const MAX_PAGOS_PENDIENTES = 3;

async function crearPedido(codigo_qr, { items, cupon_codigo }) {
  const { mesa, sesion } = await _mesaConSesionActiva(codigo_qr);

  const pendientes = await Pedido.count({ where: { mesa_sesion_id: sesion.id, estado: 'pendiente_pago' } });
  if (pendientes >= MAX_PAGOS_PENDIENTES) {
    throw Object.assign(
      new Error('Ya tenés pagos pendientes en esta mesa. Esperá a que se confirmen o expiren antes de pedir de nuevo.'),
      { status: 429 }
    );
  }

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
    // crearCompleta ya sabe validar y aplicar el cupón (misma lógica que usa
    // el cajero) — acá solo se deja pasar el código, sin reglas nuevas. Un
    // cupón "exclusivo de un cliente" o con límite por cliente va a fallar
    // acá porque cliente_id es null: en autoservicio todavía no hay forma de
    // identificar al cliente (eso queda para el diseño de fidelidad).
    cupon_codigo,
  });
}

async function consultarEstadoPedido(codigo_qr, pedido_id) {
  const { sesion } = await _mesaConSesionActiva(codigo_qr);

  // Chequeo de pertenencia ANTES de llamar a consultarEstadoPagoQr: esa
  // función no solo lee, puede finalizar el pago (confirmar stock/libro
  // caja/sockets) o revertirlo contra CodePay para el pedido_id que se le
  // pase. Si se llamara primero y se filtrara por sesión después, cualquiera
  // con un QR válido de su propia mesa podría probar pedido_id al azar y
  // disparar esos efectos secundarios sobre pedidos de otras mesas/sucursales
  // antes de que el 404 llegara a devolverse. Por eso la pertenencia se
  // resuelve acá con un findByPk liviano, de solo lectura, y se corta con
  // 404 (no 403, para no confirmarle a un caller anónimo que el id existe)
  // sin tocar consultarEstadoPagoQr en absoluto si no matchea.
  const pedido = await Pedido.findByPk(pedido_id, { attributes: ['id', 'mesa_sesion_id'] });
  if (!pedido || pedido.mesa_sesion_id !== sesion.id) {
    throw Object.assign(new Error('Pedido no encontrado'), { status: 404 });
  }

  return ventasService.consultarEstadoPagoQr(pedido_id, null);
}

module.exports = { obtenerMenu, crearPedido, consultarEstadoPedido };
