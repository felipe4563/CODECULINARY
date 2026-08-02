import api from './cliente';
import { BASE_URL } from './configuracion';

export const avatarSrc = (path) => (path ? `${BASE_URL}${path}` : null);

export const getPerfil = () => api.get('/perfil').then((r) => r.data.datos);

export const actualizarPerfil = (datos) =>
  api.put('/perfil', datos).then((r) => r.data.datos);

export const cambiarContrasena = (datos) =>
  api.put('/perfil/contrasena', datos).then((r) => r.data.datos);

export const subirAvatar = (file) => {
  const form = new FormData();
  form.append('imagen', file);
  return api.post('/uploads/imagen', form).then((r) => r.data.datos.url);
};
