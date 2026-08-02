import api from './cliente';

export const getPromociones       = ()          => api.get('/promociones').then(r => r.data.datos);
export const getPromocionesActivas = ()         => api.get('/promociones/activas').then(r => r.data.datos);
export const crearPromocion       = (datos)     => api.post('/promociones', datos).then(r => r.data.datos);
export const actualizarPromocion  = (id, datos) => api.put(`/promociones/${id}`, datos).then(r => r.data.datos);
export const eliminarPromocion    = (id)        => api.delete(`/promociones/${id}`).then(r => r.data.datos);
