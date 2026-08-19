import axios from 'axios';

// Instancia separada de la de `cliente.js`: esta es para las rutas públicas
// de autoservicio/clientePublico, que se llaman desde el navegador de un
// comensal, no de un miembro del staff. `cliente.js` engancha interceptores
// pensados para la sesión de staff (adjunta el token de useAuthStore a TODA
// request, y ante un 401 sin refresh redirige a /login del staff). Si un
// comensal usa autoservicio en un dispositivo donde también hay una sesión
// de staff logueada (algo común para demos/pruebas), esos interceptores
// pisarían el Bearer del cliente con el del staff, o mandarían al comensal
// a la pantalla de login del staff ante cualquier 401 de su propio token.
// Por eso esta instancia no tiene ningún interceptor: cada función de
// `autoservicio.js`/`clientePublico.js` adjunta su propio Bearer (o ninguno)
// a mano.
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api/v1',
});

export default api;
