import api from './clienteAnonimo';
import { useClienteAutoservicioStore } from '../store/clienteAutoservicioStore';

function authHeader() {
  const token = useClienteAutoservicioStore.getState().token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export const estadoCliente = (numeroDocumento) =>
  api.post('/cliente/estado', { numero_documento: numeroDocumento }).then(r => r.data.datos);

export const solicitarPinCliente = (numeroDocumento, pin, email) =>
  api.post('/cliente/pin/solicitar', { numero_documento: numeroDocumento, pin, email }).then(r => r.data.datos);

export const confirmarPinCliente = (numeroDocumento, codigo) =>
  api.post('/cliente/pin/confirmar', { numero_documento: numeroDocumento, codigo }).then(r => r.data.datos);

export const verificarPinCliente = (numeroDocumento, pin) =>
  api.post('/cliente/pin/verificar', { numero_documento: numeroDocumento, pin }).then(r => r.data.datos);

export const cambiarPinCliente = (pinActual, pinNuevo) =>
  api.put('/cliente/pin', { pin_actual: pinActual, pin_nuevo: pinNuevo }, { headers: authHeader() }).then(r => r.data.datos);

export const perfilCliente = () =>
  api.get('/cliente/perfil', { headers: authHeader() }).then(r => r.data.datos);

export const historialCliente = () =>
  api.get('/cliente/pedidos', { headers: authHeader() }).then(r => r.data.datos);
