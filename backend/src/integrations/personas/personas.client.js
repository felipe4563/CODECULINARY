// Cliente de la API de Personas (registro civil boliviano) — se usa para
// autocompletar el formulario de "Nuevo Cliente" a partir del número de CI.
// Auth: token opaco por Bearer, válido 8h, sin endpoint de refresh — se
// cachea en memoria del proceso y se renueva antes de vencer.

let _tokenCache = null; // { token, expiraEn: Date } | null

function _config() {
  return {
    apiUrl: process.env.PERSONAS_API_URL,
    username: process.env.PERSONAS_API_USERNAME,
    password: process.env.PERSONAS_API_PASSWORD,
  };
}

async function _login() {
  const { apiUrl, username, password } = _config();
  let res;
  try {
    res = await fetch(`${apiUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  } catch {
    throw Object.assign(new Error('No se pudo conectar con la API de personas'), { status: 502 });
  }
  if (!res.ok) {
    throw Object.assign(new Error('No se pudo autenticar con la API de personas'), { status: 502 });
  }
  const datos = await res.json();
  _tokenCache = { token: datos.token, expiraEn: new Date(datos.expiraEn) };
  return _tokenCache.token;
}

// Renueva 5 minutos antes de vencer, para no arriesgar un request en vuelo
// justo cuando el token expira.
async function _obtenerToken() {
  const margenMs = 5 * 60 * 1000;
  if (_tokenCache && _tokenCache.expiraEn.getTime() - margenMs > Date.now()) {
    return _tokenCache.token;
  }
  return _login();
}

async function _getAutenticado(path) {
  const { apiUrl } = _config();
  const token = await _obtenerToken();
  let res;
  try {
    res = await fetch(`${apiUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    throw Object.assign(new Error('No se pudo conectar con la API de personas'), { status: 502 });
  }
  // El token pudo haber sido revocado del lado del servidor entre requests
  // (fuera de nuestro control) — un solo reintento con login fresco alcanza.
  if (res.status === 401) {
    const tokenNuevo = await _login();
    try {
      res = await fetch(`${apiUrl}${path}`, { headers: { Authorization: `Bearer ${tokenNuevo}` } });
    } catch {
      throw Object.assign(new Error('No se pudo conectar con la API de personas'), { status: 502 });
    }
  }
  return res;
}

async function buscarPorDocumento(numeroDocumento) {
  const res = await _getAutenticado(`/personas/documento/${encodeURIComponent(numeroDocumento)}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw Object.assign(new Error('Error al consultar la API de personas'), { status: 502 });
  }
  return res.json();
}

// Búsqueda de texto libre (nombre completo, en cualquier orden) — ver
// sección 4.1 de la documentación de la API.
async function buscarPorNombre(q, { page = 0, size = 10 } = {}) {
  const params = new URLSearchParams({ q, page: String(page), size: String(size) });
  const res = await _getAutenticado(`/personas/buscar?${params.toString()}`);
  if (!res.ok) {
    throw Object.assign(new Error('Error al consultar la API de personas'), { status: 502 });
  }
  return res.json();
}

// Por "código" (la PK interna de la tabla persona, distinta del número de
// documento) — hay registros con numero_documento vacío que solo se pueden
// ubicar por acá (ver sección 3 de la documentación).
async function buscarPorCodigo(codigo) {
  const res = await _getAutenticado(`/personas/${encodeURIComponent(codigo)}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw Object.assign(new Error('Error al consultar la API de personas'), { status: 502 });
  }
  return res.json();
}

module.exports = { buscarPorDocumento, buscarPorNombre, buscarPorCodigo };
