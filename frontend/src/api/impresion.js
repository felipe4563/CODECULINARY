import api from './cliente';

export const getEstadoAgentes = () =>
  api.get('/impresion/estado-agentes').then(r => r.data.datos);
