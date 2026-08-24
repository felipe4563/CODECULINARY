# Impresión Bluetooth en cocina + estado de agentes — Diseño

## Contexto

El sistema imprime tickets de dos formas (`Caja.modo_impresion`): **física** (una PC con Windows corre `print-agent/agent.js`, que escucha eventos `print:caja`/`print:cocina` por socket.io y también un servidor HTTP en `127.0.0.1:4321`) y **bluetooth** (el navegador arma el ticket ESC/POS y lo dispara con RawBT vía `rawbt:` URL scheme — ver `frontend/src/utils/rawbt.js`).

Todo el disparo de impresión pasa por `_emitirImpresion()` en `backend/src/modules/ventas/ventas.service.js:468`, que se llama una sola vez, cuando el pedido queda `completado` (efectivo: al cobrar; QR: al confirmarse el pago, sea por polling del cliente o por webhook de CodePay). Esa función:

- Siempre emite `print:caja` (ticket de venta), a la sala `caja:<id>` de quien vendió.
- Emite `print:cocina` (comanda) solo si `Configuracion.flujo_cocina === 'fisico'`, a la sala `sucursal:<id>` (si `cocina_destino === 'centralizada'`, default) o `caja:<id>` (si `'por_caja'`).

**El problema — dos puntos ciegos:**

1. **Bluetooth no tiene "agente"**: el único lugar que dispara `imprimirBluetoothCocina()`/`imprimirBluetoothCaja()` hoy es el navegador del cajero, justo después de recibir la respuesta HTTP de "venta creada" (`imprimirLocal()` en `frontend/src/utils/impresionLocal.js:37`). Ningún componente del frontend escucha `print:caja`/`print:cocina` por socket. Funciona bien cuando un cajero vende activamente desde su propio celular. **No funciona para pedidos de autoservicio** (QR): ahí el pedido se confirma por el polling del celular del *cliente* o por el webhook de CodePay — nunca por el navegador de un cajero — así que nadie dispara el Bluetooth y el ticket nunca sale.

2. **No hay visibilidad de si el agente físico está vivo**: el agente expone `GET /salud` en `127.0.0.1:4321` (`print-agent/agent.js:317`), pero nada en el frontend lo consulta. Un admin no tiene forma de saber, sin ir físicamente a la PC, si el agente de una caja se cayó.

## Objetivo

1. Que la comanda de cocina se imprima sola en modo Bluetooth para **cualquier** pedido que llegue a `completado` con `flujo_cocina: 'fisico'`, incluyendo autoservicio — sin depender de que un cajero esté vendiendo.
2. Dar visibilidad, desde el Dashboard y desde cualquier dispositivo/ubicación, de si el agente de impresión física de cada caja está conectado.

**Fuera de alcance:** el ticket de *cliente* para autoservicio (decisión ya tomada: no hace falta, es un respaldo contable, se puede reimprimir a mano si hace falta desde el listado de ventas). Tampoco se toca el modo `cocina_destino: 'por_caja'` más allá de soportarlo como opción secundaria (ver abajo) — el caso principal es `'centralizada'`.

## Parte 1 — Pantalla dedicada de cocina (Bluetooth)

### Idea central

Una página nueva, protegida por login de staff, pensada para dejarse abierta en una tablet/celular fijo en cocina (con RawBT instalado y una impresora Bluetooth emparejada). Escucha `print:cocina` por el mismo socket que ya usa toda la app y dispara la impresión ella misma — sin depender de que nadie esté vendiendo.

Para no duplicar tickets en los locales chicos que hoy usan "un solo cajero, una sola impresora Bluetooth para todo" (que deben seguir funcionando exactamente igual), la pantalla dedicada es **opt-in** vía una configuración nueva. Cuando está prendida, el dispositivo que vende deja de imprimir la comanda de cocina — esa responsabilidad pasa entera a la pantalla dedicada.

### Cambios de datos

**Migración nueva** `backend/database/migrations/041_impresion_dedicada.sql`:

```sql
-- backend/database/migrations/041_impresion_dedicada.sql
INSERT INTO configuraciones (clave, valor) VALUES ('cocina_pantalla_dedicada', 'false')
  ON DUPLICATE KEY UPDATE valor = valor;
```

(Sigue el mismo patrón que las demás claves de `Configuracion` — no es una columna, es una fila en la tabla `configuraciones`.)

### Backend

**`ventas.service.js`** — `_emitirImpresion()` (línea 469): agregar `'cocina_pantalla_dedicada'` a la lista de claves que ya lee de `Configuracion`, y agregarla al objeto `cfg` que ya viaja dentro de `datosCocina.config` (no hace falta un endpoint ni consulta aparte — el valor viaja en el mismo payload que ya arma cada ticket).

No hace falta tocar la lógica de emisión de `print:cocina` en sí: sigue emitiéndose exactamente igual (a `sucursal:<id>` o `caja:<id>` según `cocina_destino`). Lo único que cambia es qué hace cada lado con ese evento.

### Frontend — dejar de imprimir cocina en el dispositivo que vende

**`frontend/src/utils/impresionLocal.js`** — `imprimirLocal()` (línea 37): antes de disparar `imprimirBluetoothCocina()` o `marcarCocinaPendiente()`, chequear `datosImpresion.cocina?.config?.cocina_pantalla_dedicada === 'true'`. Si es `'true'`, no hacer nada con `cocina` (el ticket de caja se sigue imprimiendo normal, eso no cambia).

`reimprimirConFallback()` (para el botón manual "Imprimir de nuevo" desde el listado de ventas) **no cambia** — reimprimir a mano sigue funcionando igual sin importar el flag, es una acción explícita del usuario, no automática.

### Frontend — página nueva

**`frontend/src/pages/cocina/PantallaCocinaImpresion.jsx`** (nueva), ruta protegida `/pantalla-cocina-impresion` dentro de `RutaProtegida`, permiso `cocina.ver` (reutiliza el que ya existe, no hace falta uno nuevo).

Comportamiento:
- Al montarse, pide un **wake lock** de pantalla (`navigator.wakeLock.request('screen')`, con manejo de que el navegador no lo soporte — no rompe nada si falla, solo no evita que la pantalla se apague sola).
- Escucha `print:cocina` en el `socket` global ya existente (`frontend/src/socket.js`) — la sala de sucursal ya se une sola al loguearse, no hace falta código de unión nuevo para el caso `centralizada`.
- **Opción "vincular a una caja"**: un `<select>` simple (persistido en `localStorage`, por dispositivo) para el caso `cocina_destino: 'por_caja'` — si se elige una caja, la página emite `socket.emit('unirse_caja', caja_id)` (evento que el backend ya entiende, usado hoy por el agente físico) para también recibir esos eventos.
- Por cada `print:cocina` recibido: si `datos.modo_impresion === 'bluetooth'`, deduplicar por `pedido.id` (un `Set` en memoria con TTL corto — mismo patrón que `print-agent/agent.js:120-145`, por si el socket reconecta y reenvía) y llamar a `imprimirBluetoothCocina(datos)`.
- Lista simple en pantalla, más reciente arriba: `"Comanda #12 — Mesa 4 — impresa 14:32"`. Nada de KDS visual — esta pantalla es solo para confirmar de un vistazo que la impresora respondió, no reemplaza `CocinaPage` (que sigue existiendo tal cual, para el flujo `digital`).

### Manejo de errores

- Socket desconectado (wifi cae): reconecta solo (mismo `socket.io-client` de siempre); lo que se perdió mientras estuvo offline se reimprime a mano desde el listado de ventas (`reimprimirConFallback`, ya soporta Bluetooth).
- RawBT no instalado / impresora no emparejada: `dispararRawBT()` no hace nada visible (comportamiento ya existente en el resto de la app) — no bloquea ni rompe la cola de comandas siguientes.
- Nadie tiene la pantalla abierta ese día: los tickets de cocina simplemente no salen — mismo riesgo que ya existe hoy si la PC del agente físico está apagada. No se resuelve acá (ver Parte 2, que sí da visibilidad de esto para el caso físico; para Bluetooth queda como limitación conocida, documentada, no bloqueante).

## Parte 2 — Estado de agentes de impresión física

### Idea central

El agente físico (`print-agent/agent.js`) ya se conecta por socket.io. Se le agrega una identificación explícita para que el backend sepa "este socket es un agente, no un navegador de staff", guarde su estado en memoria, y lo exponga tanto por API (foto inicial) como por socket (cambios en vivo).

### Backend — `print-agent/agent.js`

Al conectar (dentro del handler `socket.on('connect', ...)`, línea 199), además de `unirse_sucursal`/`unirse_caja` (que ya hace), emitir:

```js
socket.emit('agente:conectado', { sucursal_id: config.sucursal_id, caja_id: config.caja_id || null });
```

### Backend — `backend/src/socket.js`

- Mapa en memoria: `const agentesConectados = new Map(); // socket.id -> { sucursal_id, caja_id, conectado_en }`.
- Listener nuevo dentro de `_io.on('connection', ...)`:
  ```js
  socket.on('agente:conectado', ({ sucursal_id, caja_id }) => {
    if (!sucursal_id) return;
    agentesConectados.set(socket.id, { sucursal_id, caja_id: caja_id || null, conectado_en: Date.now() });
    emitir('agente:estado', { caja_id: caja_id || null, conectado: true }, sucursal_id);
  });
  ```
- En el `disconnect` ya existente: si `agentesConectados.has(socket.id)`, sacar la entrada y emitir `agente:estado` con `conectado: false` a esa `sucursal_id` antes de borrarla.
- Exportar una función `estadoAgentes(sucursal_id)` que devuelva las entradas del mapa para esa sucursal (agrupadas por `caja_id`) — se agrega a `module.exports` junto a `init`/`emitir` (línea 47), y `impresion.service.js` la importa con `const { estadoAgentes } = require('../../socket')`.

No se persiste en base de datos — "está en el mapa" ya es la señal de "conectado ahora". Un reinicio del backend limpia el mapa entero (todos los agentes reconectan solos en ~1.5s por su propia config de reconexión, así que el "desconectado" que se vería sería momentáneo y real).

### Backend — endpoint nuevo

`GET /api/v1/impresion/estado-agentes` — módulo nuevo `backend/src/modules/impresion/` (`impresion.service.js`, `.controller.js`, `.routes.js`), montado en `app.js` como el resto de módulos. Staff autenticado, respeta alcance por sucursal igual que el resto de la API (`acceso_todas` para admins, filtrado por `sucursal_activa` para el resto). Devuelve algo como:

```json
{ "agentes": [{ "caja_id": 3, "conectado": true, "conectado_en": "2026-08-23T14:02:00Z" }] }
```

### Frontend — `Dashboard.jsx`

- Query nueva (`useQuery`, `queryKey: ['estado-agentes']`) al endpoint de arriba, habilitada si `puedeVerCaja`, para la foto inicial al cargar la página.
- `useEffect` escuchando `agente:estado` en el `socket` global (mismo patrón que el `useEffect` de `restaurante:actualizar` que ya existe en este archivo, línea 227) — al recibirlo, actualiza el estado local (o simplemente `invalidateQueries(['estado-agentes'])`, más simple y consistente con el resto del archivo).
- Una `StatCard` chica (o una fila de badges si hay varias cajas) mostrando, por cada caja con al menos un agente visto alguna vez: **"Caja 1 — Agente conectado ✓"** (verde) / **"Caja 1 — Agente desconectado ⚠"** (rojo/ámbar).

## Testing

- Backend: tests para el mapa de agentes en `socket.js` (conectar → aparece en el mapa y emite `agente:estado`; desconectar → desaparece y emite `conectado:false`), y para el endpoint `estado-agentes` (alcance por sucursal, formato de respuesta).
- Backend: test de que `_emitirImpresion` incluye `cocina_pantalla_dedicada` en `datosCocina.config`.
- Frontend: no hay suite de tests de componentes en este proyecto (confirmar en el plan) — verificación manual documentada como parte del plan, igual que se hizo para el resto del frontend en esta rama.
