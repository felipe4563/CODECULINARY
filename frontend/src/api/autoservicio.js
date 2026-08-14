import api from './cliente';

export const getMenuAutoservicio = (codigo) =>
  api.get(`/autoservicio/mesa/${codigo}`).then(r => r.data.datos);

export const crearPedidoAutoservicio = (codigo, items, cuponCodigo, numeroDocumento) =>
  api.post(`/autoservicio/mesa/${codigo}/pedido`, {
    items, cupon_codigo: cuponCodigo || undefined, numero_documento: numeroDocumento || undefined,
  }).then(r => r.data.datos);

export const validarCuponAutoservicio = (codigo, cuponCodigo, items) =>
  api.post(`/autoservicio/mesa/${codigo}/cupon/validar`, { codigo: cuponCodigo, items }).then(r => r.data.datos);

export const getEstadoPedidoAutoservicio = (codigo, pedidoId) =>
  api.get(`/autoservicio/mesa/${codigo}/pedido/${pedidoId}/estado`).then(r => r.data.datos);
