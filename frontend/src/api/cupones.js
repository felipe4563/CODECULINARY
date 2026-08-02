import api from './cliente';

export const getCupones       = ()          => api.get('/cupones').then(r => r.data.datos);
export const getCupon         = (id)        => api.get(`/cupones/${id}`).then(r => r.data.datos);
export const crearCupon       = (datos)     => api.post('/cupones', datos).then(r => r.data.datos);
export const actualizarCupon  = (id, datos) => api.put(`/cupones/${id}`, datos).then(r => r.data.datos);
export const eliminarCupon    = (id)        => api.delete(`/cupones/${id}`).then(r => r.data.datos);
export const validarCupon     = (codigo, subtotal) => api.get(`/cupones/validar/${encodeURIComponent(codigo)}`, { params: { subtotal } }).then(r => r.data.datos);
