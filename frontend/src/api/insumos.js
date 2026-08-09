import api from './cliente';

export const getInsumos = () =>
  api.get('/insumos').then(r => r.data.datos);

export const crearInsumo = (datos) =>
  api.post('/insumos', datos).then(r => r.data.datos);

export const actualizarInsumo = (id, datos) =>
  api.put(`/insumos/${id}`, datos).then(r => r.data.datos);

export const desactivarInsumo = (id) =>
  api.delete(`/insumos/${id}`).then(r => r.data.datos);

export const ajustarStockInsumo = (id, datos) =>
  api.put(`/insumos/${id}/ajustar-stock`, datos).then(r => r.data.datos);

export const getRecetaProducto = (producto_id) =>
  api.get(`/insumos/receta/${producto_id}`).then(r => r.data.datos);

export const guardarRecetaProducto = (producto_id, lineas) =>
  api.put(`/insumos/receta/${producto_id}`, { lineas }).then(r => r.data.datos);

export const getTotalGastadoInsumos = (params) =>
  api.get('/insumos/reportes/total-gastado', { params }).then(r => r.data.datos);

export const getReporteComprasInsumos = (params) =>
  api.get('/insumos/reportes/compras', { params }).then(r => r.data.datos);
