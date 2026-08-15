# Fidelidad en autoservicio: identificación por CI + PIN

## Contexto

El autoservicio (mesa QR) ya permite sumar puntos de fidelidad de forma
opcional y silenciosa: el cliente escribe su CI antes de pagar, el backend
resuelve o crea el `Cliente` correspondiente (vía la API de Personas) y liga
ese `cliente_id` al pedido — la acumulación de puntos ya funciona sola desde
ahí (`ventasService._finalizarVenta`).

Ese mecanismo no tiene ninguna verificación: cualquiera que sepa el CI de
otra persona queda "identificado" como esa persona. Es un riesgo aceptable
para *sumar* puntos (en el peor caso, alguien le suma puntos a la cuenta de
otro sin que se entere, sin pérdida real para nadie), pero no lo es para:

1. **Canjear puntos** — descontar del total usando puntos acumulados. Hoy no
   existe desde autoservicio, justamente por este riesgo.
2. **Ver historial de pedidos** — expone información del cliente.

Este documento diseña un mecanismo de PIN para habilitar ambas cosas, más la
posibilidad de cambiar el PIN. El flujo de "solo sumar puntos con CI, sin
PIN" **no cambia** — sigue existiendo tal cual está, sin fricción.

## Alcance

**Incluye:**
- Creación de PIN (con verificación de email obligatoria).
- Login con CI + PIN (con bloqueo temporal ante intentos fallidos).
- Cambio de PIN (autenticado).
- Historial de pedidos del cliente (autenticado).
- Canje de puntos en el pedido de autoservicio, solo con sesión válida.
- Mostrar nombre y puntos disponibles una vez logueado con PIN (no antes).

**Fuera de alcance (decisiones explícitas del usuario):**
- Recuperación de PIN olvidado por el propio cliente (SMS/email de reseteo)
  — solo el cajero puede resetear un PIN, desde el panel de Clientes ya
  existente. Se agrega el botón "Resetear PIN" ahí.
- El PIN nunca se exige para *solo sumar puntos* — sigue siendo opcional y
  sin fricción como hoy.
- No hay "cerrar sesión en otros dispositivos" ni revocación server-side de
  tokens — el token expira solo, no hay nada más sensible detrás (no es
  pago ni dato bancario).

## Riesgo aceptado: "primero en poner PIN se queda con la cuenta"

Si un CI todavía no tiene PIN, la primera persona que complete el flujo de
creación (CI + PIN elegido + verificación de email) se queda con esa cuenta.
No hay forma de atar el email al CI de manera verificable (la API de
Personas no expone email), así que esto no se puede cerrar del todo sin una
integración externa que hoy no existe. La verificación por email sí eleva
la barrera: ya no alcanza con saber el CI, hace falta además controlar una
casilla de email y completar el código a tiempo — mucho más esfuerzo que
escribir un PIN a ciegas.

## Modelo de datos

### `Cliente` — columnas nuevas

| Columna | Tipo | Notas |
|---|---|---|
| `pin_hash` | STRING, nullable | bcrypt del PIN activo (mismo mecanismo que `Usuario.contrasena`) |
| `pin_intentos_fallidos` | INTEGER, default 0 | se resetea al loguear con éxito |
| `pin_bloqueado_hasta` | DATETIME, nullable | si está en el futuro, se rechaza sin comparar el PIN |

### `cliente_pin_verificaciones` — tabla nueva

Una fila = una verificación de PIN pendiente. `cliente_id` es único: una
nueva solicitud reemplaza (borra + recrea) cualquier pendiente anterior de
ese cliente.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | PK | |
| `cliente_id` | FK, unique | |
| `pin_hash` | STRING | el PIN elegido, ya hasheado, todavía no activo |
| `email` | STRING | el email al que se mandó el código |
| `codigo_hash` | STRING | hash del código de 6 dígitos |
| `intentos` | INTEGER, default 0 | máx. 5 antes de exigir pedir un código nuevo |
| `expira_en` | DATETIME | 10 minutos desde la creación |
| `creado_en` | DATETIME | |

Migración: `backend/database/migrations/039_clientes_pin.sql`.

## Variables de entorno nuevas

```
SMTP_HOST=mail.codewave.com.bo
SMTP_PORT=587
SMTP_USER=<usuario>
SMTP_PASS=<contraseña>
SMTP_FROM=noreply@codewave.com.bo
```

Conexión con STARTTLS. Se usa `nodemailer` (agregar a `package.json`).

## Módulo backend nuevo: `clientePublico`

`backend/src/modules/clientePublico/` — sin el middleware `auth` de staff
(es anónimo por diseño; el CI+PIN es la única barrera). Monta en
`/api/v1/cliente`.

### Endpoints

**`POST /cliente/estado`** `{ numero_documento }`
Resuelve/crea el `Cliente` por CI (reutiliza la lógica ya existente de
`autoservicio.service.js:_resolverClientePorDocumento`, que se mueve a un
lugar compartido, ej. `clientesService`, para no duplicarla). Devuelve
`{ tiene_pin: boolean }`. No crea ninguna verificación pendiente, no
devuelve ningún otro dato del cliente.

**`POST /cliente/pin/solicitar`** `{ numero_documento, pin, email }`
- Resuelve/crea el `Cliente`. Si `cliente.pin_hash` ya existe → 409
  ("Este CI ya tiene un PIN configurado").
- Valida `pin` (4 dígitos exactos) y `email` (formato básico).
- Genera un código de 6 dígitos al azar, hashea código y PIN, reemplaza
  cualquier fila pendiente anterior de ese cliente en
  `cliente_pin_verificaciones`, con `expira_en = ahora + 10 min`.
- Manda el email con el código (texto plano simple, sin plantilla
  elaborada).
- Responde `{ ok: true }` sin filtrar si el CI existía antes o no.

**`POST /cliente/pin/confirmar`** `{ numero_documento, codigo }`
- Busca la fila pendiente del cliente resuelto por ese CI.
- Sin fila, o `expira_en` pasado → 400 ("Código vencido, pedí uno nuevo").
- `intentos >= 5` → 429 ("Demasiados intentos, pedí un código nuevo").
- Código no coincide → incrementa `intentos`, 400 ("Código incorrecto").
- Coincide → `Cliente.update({ pin_hash: fila.pin_hash, email: fila.email })`,
  borra la fila pendiente, emite un token (ver más abajo) y responde
  `{ token }`.

**`POST /cliente/pin/verificar`** `{ numero_documento, pin }`
- Resuelve el `Cliente`. Sin `pin_hash` → 409 ("Todavía no configuraste un
  PIN").
- `pin_bloqueado_hasta` en el futuro → 429, sin comparar el PIN.
- PIN no coincide → incrementa `pin_intentos_fallidos`; al llegar a 5,
  `pin_bloqueado_hasta = ahora + 5 min` y el contador se reinicia. 401.
- PIN coincide → resetea `pin_intentos_fallidos` a 0, responde `{ token }`.

**`PUT /cliente/pin`** (requiere token) `{ pin_actual, pin_nuevo }`
- Verifica `pin_actual` contra el hash guardado.
- Si coincide, actualiza `pin_hash` al nuevo. No hace falta re-verificar
  por email — ya demostró conocer el PIN vigente.

**`GET /cliente/pedidos`** (requiere token)
- Devuelve los pedidos del `cliente_id` del token, más recientes primero,
  sin filtrar por sucursal/mesa (historial de la persona, no de una mesa
  puntual). Selección de campos liviana: fecha, sucursal/mesa, total,
  cantidad de ítems — no hace falta el detalle línea por línea para un
  historial.

**`GET /cliente/perfil`** (requiere token)
- Devuelve `{ nombre, puntos }` del cliente autenticado — lo que la UI
  muestra una vez logueado.

### Token de sesión

JWT `{ cliente_id, tipo: 'cliente' }`, firmado con el mismo `JWT_SECRET`
que ya usa el staff (mismo patrón que el `tipo: 'pre_login'` existente en
`auth.service.js`), expiración larga (180 días, para que la sesión
persista en el navegador del cliente como se definió). Middleware nuevo y
liviano `backend/src/middlewares/authCliente.js`: solo verifica firma y
`tipo === 'cliente'`, adjunta `req.clienteId`. No toca `Usuario`/`Rol`/
`Permiso` — es un circuito completamente aparte del login de staff.

## Canje de puntos en el pedido de autoservicio

`POST /autoservicio/mesa/:codigo_qr/pedido` acepta el token del cliente
(header `Authorization: Bearer <token>`, mismo header que usa el staff,
verificado con `authCliente` de forma **opcional** — si no viene o es
inválido, se ignora sin cortar el pedido). Si el token es válido:
- El `cliente_id` que resuelve el pedido pasa a ser el del token (no el que
  resolvería `numero_documento`, que en este flujo se vuelve redundante
  para quien ya inició sesión).
- Solo entonces se acepta `puntos_canjear` en el body y se pasa a
  `ventasService.crearCompleta` (que ya sabe validarlo y descontarlo — no
  se toca esa lógica).

Sin token válido, `puntos_canjear` se ignora aunque venga en el body —
protección del lado del servidor, no solo de la UI.

## Panel de staff: resetear PIN

En `Configuración → Clientes` (donde ya se edita un `Cliente`), un botón
nuevo "Resetear PIN" que limpia `pin_hash`, `pin_intentos_fallidos` y
`pin_bloqueado_hasta` — el cliente vuelve al estado "sin PIN" y puede
crear uno nuevo (con su propio email) desde autoservicio.

## Frontend (`AutoservicioPage.jsx` y componentes nuevos)

- El campo actual "CI (opcional, para sumar puntos)" en el carrito **no
  cambia** — sigue silencioso, sin PIN.
- Ícono nuevo "Mi cuenta" en el header, junto al de modo claro/oscuro.
  Abre una hoja (mismo patrón visual que el carrito):
  - **Sin token guardado:** pide CI → `POST /cliente/estado` → según
    `tiene_pin`:
    - `true` → pantalla "Ingresá tu PIN" (4 dígitos) → `verificar` →
      guarda el token (nuevo store zustand+persist, mismo patrón que
      `temaAutoservicioStore.js`, key `cliente-autoservicio`).
    - `false` → pantalla "Creá tu PIN": PIN (x2, para confirmar) + email →
      `solicitar` → pantalla "Ingresá el código que te mandamos" (6
      dígitos) → `confirmar` → guarda el token.
  - **Con token guardado:** muestra nombre y puntos (`GET /cliente/perfil`),
    accesos a "Ver historial" (`GET /cliente/pedidos`, lista simple),
    "Cambiar PIN" (formulario PIN actual + PIN nuevo x2), y "Cerrar
    sesión" (borra el token local, sin llamar al backend — no hay nada
    que revocar del lado del servidor).
- En el carrito: si hay token y el cliente tiene puntos disponibles (y
  `Configuracion` de fidelidad permite canje por QR — mismo flag
  `cfgFidelidad.canjeQr` que ya usa el staff), aparece un control para usar
  puntos como descuento, en el mismo lugar que el cupón.

## Testing

Casos de backend (`clientePublico.test.js` nuevo, más ajustes en
`autoservicio.test.js` para el canje):

- `solicitar`: CI nuevo (crea pendiente, "envía" email — mockear
  `nodemailer`), CI que ya tiene PIN (409), PIN con formato inválido (400),
  email con formato inválido (400).
- `confirmar`: código correcto (activa PIN, devuelve token), código
  incorrecto (400, incrementa intentos), código vencido (400), 5 intentos
  fallidos seguidos (429).
- `verificar`: PIN correcto (token), PIN incorrecto (401, incrementa
  contador), bloqueo a los 5 intentos fallidos (429), bloqueo vigente
  rechaza sin comparar el PIN (verificable con un PIN correcto que igual
  da 429 mientras el bloqueo está activo).
- `PUT /cliente/pin`: con PIN actual correcto (cambia), con PIN actual
  incorrecto (401), sin token (401).
- `GET /cliente/pedidos`: devuelve solo pedidos de ese `cliente_id`, no de
  otros clientes ni de otras sucursales.
- `GET /cliente/perfil`: devuelve nombre y puntos correctos; sin token,
  401.
- Canje en `crearPedido`: con token válido y puntos suficientes, el total
  baja; sin token, `puntos_canjear` en el body se ignora (el total no
  cambia); con token pero sin puntos suficientes, seguimos con el 400 que
  ya lanza `ventasService._resolverCanje` para ese caso.
