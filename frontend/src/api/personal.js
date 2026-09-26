import api from './cliente';

// Propias — cualquier usuario logueado
export const marcarAsistencia = ({ lat, lng } = {}) =>
  api.post('/personal/marcar', { lat, lng }).then((r) => r.data.datos);

export const getMiEstadoAsistencia = () =>
  api.get('/personal/mi-estado').then((r) => r.data.datos);

export const proponerHoraSalida = (marcacion_id, datos) =>
  api.post(`/personal/marcaciones/${marcacion_id}/proponer-salida`, datos).then((r) => r.data.datos);

// Administración — requiere personal.administrar
export const getFiltrosPersonal = () =>
  api.get('/personal/filtros').then((r) => r.data.datos);

export const getHorarioPersonal = (usuario_id) =>
  api.get(`/personal/horarios/${usuario_id}`).then((r) => r.data.datos);

export const guardarHorarioPersonal = (usuario_id, dias) =>
  api.put(`/personal/horarios/${usuario_id}`, { dias }).then((r) => r.data.datos);

export const getMarcacionesPersonal = (params) =>
  api.get('/personal/marcaciones', { params }).then((r) => r.data.datos);

export const resolverMarcacionPersonal = (id, hora_salida) =>
  api.patch(`/personal/marcaciones/${id}/resolver`, { hora_salida }).then((r) => r.data.datos);
