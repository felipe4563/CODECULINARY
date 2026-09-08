# Integración con app de pedidos externa — Diseño

## Contexto

El negocio ya tiene una app de pedidos externa desarrollada (tipo PedidosYa), y
necesita que esa app pueda: (1) leer el menú del sistema para vender lo mismo que
se vende en el local, y (2) crear el pedido en el sistema cuando alguien compra
desde la app, identificando de qué sucursal es.

Hoy el sistema ya expone un flujo parecido para clientes sin staff de por medio:
Autoservicio (QR de mesa). Ese flujo está construido alrededor del concepto de
"mesa" (`mesa_sesiones`, `codigo_qr`) — la app externa no tiene mesa, tiene pedidos
para retirar en el local o para delivery, así que no encaja ahí directamente.

## Objetivo

Exponer una API con autenticación por clave, pensada para ser consumida por la app
de pedidos externa, que permita:
- Consultar el catálogo completo (productos, combos, opciones, promociones)
  disponible en una sucursal.
- Crear un pedido que entre al sistema igual que cualquier otro (cocina, reportes,
  tickets), distinguible por su origen.
- Consultar el estado de ese pedido.

Sin necesidad de saber nada de mesas, y sin duplicar la lógica de precios,
combos, opciones ni cupones que ya existe en `ventas.service.js`.

## Decisión de arquitectura

Módulo nuevo `backend/src/modules/integraciones/`, en vez de extender
`autoservicio` (que está atado a mesas) o construir un sistema paralelo con sus
propias tablas de catálogo (duplicaría datos y los desincronizaría). El módulo
nuevo reutiliza los servicios existentes (`productos.service`, `combos.service`,
`promociones.service`, `cupones.service`, y sobre todo `ventas.service.crearCompleta`)
— es una capa de traducción de contrato HTTP + autenticación, no un motor de
ventas nuevo.

Los pedidos de la app externa entran al sistema con un valor nuevo de `origen`
(`'app_externa'`, junto a los ya existentes `'staff'` y `'autoservicio'`), así que
todo lo que ya filtra o agrupa por origen (cocina, reportes, tickets) seguí
funcionando sin cambios estructurales — solo hay que enseñarle a reconocer el
valor nuevo donde haga falta mostrarlo.

## Autenticación

Una API key por sucursal (no una sola key global): a futuro va a haber varias
sucursales, y con una key por sucursal el sistema identifica de dónde es el
pedido solo con ver qué key se usó, sin depender de que la app mande un
`sucursal_id` correcto en cada request (evita un punto de fallo silencioso si la
app externa tiene mal configurada la sucursal).

**Tabla nueva `integraciones_api_keys`:**

```sql
CREATE TABLE integraciones_api_keys (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sucursal_id INT UNSIGNED NOT NULL,
  nombre_app VARCHAR(100) NOT NULL,
  api_key_hash VARCHAR(255) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

La key se guarda hasheada (igual que `clientes.pin_hash`) — se muestra en texto
plano una única vez, al generarla desde el panel de administración, y no se puede
volver a consultar después (solo regenerar).

**Middleware `authApiKeyExterna`:** lee la key del header `X-Api-Key`, la hashea y
busca en `integraciones_api_keys` con `activo: true`. Si no encuentra match, 401.
Si encuentra, cuelga `req.sucursal_id` y `req.integracion` (para poder loguear qué
app hizo el request) y sigue.

## Contrato de la API

Base: `/api/integraciones/v1/`

### `GET /menu`
Devuelve categorías, productos activos y vendibles (con sus `grupos_opciones` y
disponibilidad — reusa la misma lógica de `productos.service.listarProductos`),
combos activos (con las opciones de cada producto componente, igual que ya
devuelve `combos.service.listarActivos` desde el trabajo de opciones-en-combos), y
promociones activas — todo filtrado por `req.sucursal_id`.

### `POST /cupones/validar`
Espejo de `cuponesService.validar` — recibe un código y un subtotal, devuelve si
es válido y el descuento. Mismo patrón que ya usa Autoservicio.

### `POST /pedidos`
Crea el pedido. Payload:

```json
{
  "items": [
    { "producto_id": 12, "cantidad": 2, "opcion_ids": [4] },
    { "combo_id": 3, "cantidad": 1, "opciones_por_producto": [{ "producto_id": 12, "opcion_ids": [4] }] }
  ],
  "tipo": "delivery",
  "direccion_entrega": "Av. Siempre Viva 742",
  "nombre_cliente": "Juan Pérez",
  "telefono_cliente": "70012345",
  "pago": "contra_entrega",
  "cupon_codigo": "PROMO10"
}
```

- `tipo`: `"llevar"` (retiro en el local) o `"delivery"` (requiere `direccion_entrega`).
- `pago`: `"prepago"` (ya cobrado en la app) o `"contra_entrega"` (se cobra en el local).
- `items` usa el mismo formato que ya acepta `ventasService.crearCompleta` — no se
  inventa un formato nuevo, se traduce 1:1.

Internamente:
1. Busca la `SesionCaja` con `estado: 'abierta'` de `req.sucursal_id`. Si no hay
   ninguna, responde `409` ("el local no está tomando pedidos en este momento") —
   mismo comportamiento que ya tiene Autoservicio hoy sin caja abierta.
2. Llama a `ventasService.crearCompleta({ ...items traducidos, tipo, origen:
   'app_externa', sucursal_id, sesion_caja_id, usuario_id: sesionCaja.usuario_id,
   metodo_pago: pago === 'prepago' ? 'app_externa' : 'efectivo', ... })`.
   - Si `pago === 'prepago'`: `metodo_pago: 'app_externa'` sigue el mismo camino
     que hoy sigue `efectivo` dentro de `crearCompleta` (llama a `_finalizarVenta`
     de una), y el pedido queda `estado: 'completado'` desde el inicio.
   - Si `pago === 'contra_entrega'`: se necesita un modo en `crearCompleta` que
     deje el pedido en `estado: 'pendiente'` sin cobrar todavía (hoy `crearCompleta`
     solo tiene ese comportamiento diferido para `metodo_pago: 'qr'`, atado al
     flujo de CodePay) — el pedido queda pendiente hasta que un cajero lo cobre
     después con `POST /ventas/:id/cobrar` (endpoint que ya existe y no es
     específico de mesas).
3. Responde con el pedido creado (id, estado, total).

### `GET /pedidos/:id/estado`
Devuelve el estado del pedido — igual que el `estadoPedido` que ya existe para
Autoservicio, pero verificando además que el pedido pertenezca a
`req.sucursal_id` y tenga `origen: 'app_externa'` (para que una key no pueda
consultar pedidos de otro origen).

## Cambios en el modelo de datos existente

- `pedidos.origen` ENUM(`'staff'`,`'autoservicio'`) → agrega `'app_externa'`.
- `pedidos.tipo` ENUM(`'mesa'`,`'llevar'`) → agrega `'delivery'`.
- `pedidos.metodo_pago` ENUM(`'efectivo'`,`'qr'`) → agrega `'app_externa'` (para
  que reportes y caja puedan distinguir ingresos prepagados en la app de los
  cobrados en efectivo/QR del local — ya se agrupa por `metodo_pago` en
  `reportes.service.js`).
- `pedidos` gana dos columnas nuevas: `direccion_entrega` (VARCHAR/TEXT, NULL,
  obligatoria a nivel aplicación solo cuando `tipo = 'delivery'`) y
  `telefono_cliente` (VARCHAR, NULL — hoy no existe ningún campo de teléfono en
  `pedidos`, y para delivery hace falta poder contactar al cliente).

No se toca `detalle_pedidos`, `detalle_pedido_opciones` ni
`detalle_pedido_combo_opciones` — el pedido de la app externa arma sus líneas
exactamente igual que uno creado por un cajero o por Autoservicio.

## Cliente / fidelidad

Los pedidos de esta integración usan un **cliente genérico** (`nombre_cliente`,
`documento_cliente` opcional, `telefono_cliente`) sin vincularse al programa de
fidelidad (`clientes`, puntos) ni pedir PIN — igual que hoy un pedido "para
llevar" creado por un cajero para alguien sin cuenta. Vincular fidelidad queda
fuera de este diseño; se puede agregar después como una extensión del contrato
(mandar un identificador de cliente) sin romper nada de lo definido acá.

## Confirmación del pedido

El pedido entra a cocina automáticamente en cuanto se crea (mismo comportamiento
que Autoservicio hoy) — no hay un paso de "el local acepta el pedido" antes de
que empiece a prepararse. Si algo no se puede cumplir (ej. sucursal cerrada), el
único punto de rechazo es la validación de caja abierta al crear el pedido; no
hay mecanismo de rechazo posterior a nivel de este contrato (cancelar un pedido
ya creado usa el `POST /ventas/:id/cancelar` que ya existe).

## Frontend

**1. Badge de origen en Cocina** — `CocinaPage.jsx` y `PantallaCocinaImpresion.jsx`
hoy solo muestran el número de "para llevar" en cada ticket de la cola. Se agrega
una etiqueta corta junto al número indicando el origen (`Local`, `QR`, o el
`nombre_app` de la integración que creó el pedido), y si `tipo === 'delivery'`,
también la dirección y el teléfono ahí mismo — quien prepara/empaqueta necesita
verlo sin tener que abrir nada más.

**2. Página nueva "Pedidos externos"** (`PedidosExternosPage.jsx`, con entrada
propia en el menú lateral) — hoy no existe ninguna vista de "pedidos para llevar
pendientes de cobro" porque los que crea un cajero se cobran en el momento; los de
esta integración pueden quedar pendientes de cobro sin que nadie los esté
mirando. La página:
- Lista pedidos con `origen: 'app_externa'` de la sucursal (usa el `GET /ventas`
  que ya existe, filtrado por origen).
- Muestra cliente, teléfono, dirección (si aplica), estado, y método de pago.
- Si `metodo_pago === 'app_externa'` (prepagado): solo lectura, marcado "Pagado
  en la app".
- Si está `pendiente` y no fue prepagado: botón "Cobrar" que abre el mismo modal
  de cobro que ya usa Ventas, contra el `POST /ventas/:id/cobrar` existente.

**3. Pestaña nueva en Configuración: "Integraciones"** — mismo patrón visual que
las demás pestañas de `ConfiguracionPage.jsx` (como `TabAreas`). Permite generar
una API key por sucursal (se muestra una sola vez al crearla), ver cuáles están
activas, y desactivar/regenerar.

## Tickets e impresión

El ticket ya tiene un bloque para "PARA LLEVAR" (`ticketVenta.js`, `pedido.tipo
=== 'llevar'`). Se extiende para cubrir `tipo === 'delivery'` (imprime dirección y
teléfono) y para mostrar el `nombre_app` de origen en el encabezado cuando
`origen === 'app_externa'` (ej. "Pedido de PedidosYa") — mismo patrón ya usado en
`escpos.js` y `print-agent/agent.js`, sin cambiar la estructura del ticket.

**Riesgo conocido, fuera de alcance de este diseño:** ya se identificó en otra
sesión que, cuando una caja usa `modo_impresion: 'bluetooth'`, los pedidos de
Autoservicio no se imprimen solos (no hay agente/listener de socket en ese modo,
solo funciona si un cajero tiene el navegador abierto). Los pedidos de esta
integración van a tener el mismo problema, agravado por llegar sin que nadie esté
mirando la pantalla. Si una sucursal con impresión Bluetooth usa esta
integración, ese punto ciego debe resolverse aparte antes de confiar en que los
tickets salgan solos.

## Fuera de alcance (v1)

- Notificar a la app externa cuando cambia el estado del pedido (se resuelve con
  polling sobre `GET /pedidos/:id/estado`, que ya existe como patrón).
- Vincular pedidos al programa de fidelidad.
- Un paso de aceptación/rechazo manual del pedido antes de que entre a cocina.
- Resolver el punto ciego de impresión Bluetooth (problema preexistente, no
  introducido por esta integración).
