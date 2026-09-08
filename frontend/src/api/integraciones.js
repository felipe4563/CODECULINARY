import api from './cliente';

export const getApiKeys = () =>
  api.get('/integraciones-admin').then((r) => r.data.datos);

export const crearApiKey = (datos) =>
  api.post('/integraciones-admin', datos).then((r) => r.data.datos);

export const desactivarApiKey = (id) =>
  api.post(`/integraciones-admin/${id}/desactivar`).then((r) => r.data.datos);

export const regenerarApiKey = (id) =>
  api.post(`/integraciones-admin/${id}/regenerar`).then((r) => r.data.datos);
