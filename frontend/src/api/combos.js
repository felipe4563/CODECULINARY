import api from './cliente';

export const getCombos        = ()          => api.get('/combos').then(r => r.data.datos);
export const getCombosActivos = ()          => api.get('/combos/activos').then(r => r.data.datos);
export const getCombo         = (id)        => api.get(`/combos/${id}`).then(r => r.data.datos);
export const crearCombo       = (datos)     => api.post('/combos', datos).then(r => r.data.datos);
export const actualizarCombo  = (id, datos) => api.put(`/combos/${id}`, datos).then(r => r.data.datos);
export const eliminarCombo    = (id)        => api.delete(`/combos/${id}`).then(r => r.data.datos);
