import api from './cliente';

export const getMenuAutoservicio = (codigo) =>
  api.get(`/autoservicio/mesa/${codigo}`).then(r => r.data.datos);

export const crearPedidoAutoservicio = (codigo, items, cuponCodigo) =>
  api.post(`/autoservicio/mesa/${codigo}/pedido`, { items, cupon_codigo: cuponCodigo || undefined }).then(r => r.data.datos);

export const getEstadoPedidoAutoservicio = (codigo, pedidoId) =>
  api.get(`/autoservicio/mesa/${codigo}/pedido/${pedidoId}/estado`).then(r => r.data.datos);
