import api from './clienteAnonimo';
import { useClienteAutoservicioStore } from '../store/clienteAutoservicioStore';

export const getMenuAutoservicio = (codigo) =>
  api.get(`/autoservicio/mesa/${codigo}`).then(r => r.data.datos);

export const crearPedidoAutoservicio = (codigo, items, cuponCodigo, numeroDocumento, puntosCanjear) => {
  const token = useClienteAutoservicioStore.getState().token;
  return api.post(
    `/autoservicio/mesa/${codigo}/pedido`,
    { items, cupon_codigo: cuponCodigo || undefined, numero_documento: numeroDocumento || undefined, puntos_canjear: puntosCanjear || undefined },
    token ? { headers: { Authorization: `Bearer ${token}` } } : undefined
  ).then(r => r.data.datos);
};

export const validarCuponAutoservicio = (codigo, cuponCodigo, items) =>
  api.post(`/autoservicio/mesa/${codigo}/cupon/validar`, { codigo: cuponCodigo, items }).then(r => r.data.datos);

export const getEstadoPedidoAutoservicio = (codigo, pedidoId) =>
  api.get(`/autoservicio/mesa/${codigo}/pedido/${pedidoId}/estado`).then(r => r.data.datos);
