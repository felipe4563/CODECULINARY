import api from './cliente';

export const getPremiosRuleta = () => api.get('/ruleta/premios').then(r => r.data.datos);
export const getPremiosRuletaActivos = () => api.get('/ruleta/premios/activos').then(r => r.data.datos);
export const crearPremioRuleta = (datos) => api.post('/ruleta/premios', datos).then(r => r.data.datos);
export const actualizarPremioRuleta = (id, datos) => api.put(`/ruleta/premios/${id}`, datos).then(r => r.data.datos);
export const eliminarPremioRuleta = (id) => api.delete(`/ruleta/premios/${id}`).then(r => r.data.datos);
export const getEstadoRuleta = (cliente_id) => api.get('/ruleta/estado', { params: { cliente_id } }).then(r => r.data.datos);
export const girarRuleta = (cliente_id) => api.post('/ruleta/girar', { cliente_id }).then(r => r.data.datos);
