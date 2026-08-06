import api from './cliente';

export const getCupones       = ()          => api.get('/cupones').then(r => r.data.datos);
export const getCupon         = (id)        => api.get(`/cupones/${id}`).then(r => r.data.datos);
export const crearCupon       = (datos)     => api.post('/cupones', datos).then(r => r.data.datos);
export const actualizarCupon  = (id, datos) => api.put(`/cupones/${id}`, datos).then(r => r.data.datos);
export const eliminarCupon    = (id)        => api.delete(`/cupones/${id}`).then(r => r.data.datos);
export const validarCupon     = (codigo, subtotal, cliente_id, items) => api.get(`/cupones/validar/${encodeURIComponent(codigo)}`, { params: { subtotal, cliente_id, items: items ? JSON.stringify(items) : undefined } }).then(r => r.data.datos);
export const getCuponesDisponibles = (cliente_id) => api.get('/cupones/disponibles', { params: { cliente_id } }).then(r => r.data.datos);
