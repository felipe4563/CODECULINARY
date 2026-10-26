import api from './cliente';

export const getCombos        = (params)    => api.get('/combos', { params }).then(r => r.data.datos);
export const getCombosActivos = (params)    => api.get('/combos/activos', { params }).then(r => r.data.datos);
export const getCombo         = (id)        => api.get(`/combos/${id}`).then(r => r.data.datos);
export const crearCombo       = (datos)     => api.post('/combos', datos).then(r => r.data.datos);
export const actualizarCombo  = (id, datos) => api.put(`/combos/${id}`, datos).then(r => r.data.datos);
export const eliminarCombo    = (id)        => api.delete(`/combos/${id}`).then(r => r.data.datos);
