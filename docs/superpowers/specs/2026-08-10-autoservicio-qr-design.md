# Autoservicio por QR en mesa

**Fecha:** 2026-08-10

## Goal

Permitir que un cliente sentado en una mesa pida y pague **sin depender de un mozo**, escaneando un QR fijo pegado en la mesa: ve el menú digital, arma su pedido con las mismas opciones/variantes que ya existen hoy, y paga por QR (CodePay). El pedido entra a cocina automáticamente en cuanto se confirma el pago — sin que nadie tenga que aprobarlo a mano.

**Motivación:** el negocio a veces solo tiene un cajero (sin mozo), y hoy toda venta en mesa requiere que alguien tome el pedido manualmente.

**Fuera de alcance de este diseño:**
- Autoservicio para pedidos "para llevar" o en mostrador — este diseño es solo para mesas físicas ya sentadas.
- QR dinámico/rotativo (pantalla o tablet en la mesa) — se asume QR impreso fijo, pegado una sola vez.
- Pago en efectivo desde el flujo autoservicio — el autoservicio **siempre** paga por QR (no hay nadie ahí para cobrar/dar cambio en efectivo).
- Cuenta única combinada por mesa ("una sola factura al cerrar") — cada ronda de pedido es un cobro independiente por QR. La agrupación por mesa es solo para visibilidad/reportes (ver "Sesión de mesa" abajo), no para facturación conjunta.
- Aprobación manual de pedidos — se descartó a propósito (ver Decisiones).

## Decisiones (de la sesión de brainstorming)

1. **QR fijo por mesa, no por sesión.** Cada mesa tiene un código QR impreso una sola vez. Como el QR nunca cambia, no puede ser el mecanismo de seguridad por sí mismo (una foto vieja del QR serviría para siempre) — la protección vive en el backend, no en el QR.

2. **Filtro de "mesa ocupada".** El QR solo muestra el menú si esa mesa está actualmente marcada como ocupada en el sistema (reutiliza `mesa.estado`, que ya existe). Si está `disponible`, se muestra "Esta mesa no está habilitada para pedir, llamá al mozo/cajero" y no se llega a mostrar el menú. Esto corta el caso típico de QR robado/fotografiado y usado desde afuera del local (esa mesa concreta tendría que estar ocupada en ese momento para que el QR sirva).

3. **Pago QR obligatorio, sin bandeja de aprobación.** Se descartó la idea inicial de que un mozo/cajero apruebe cada pedido antes de mandarlo a cocina — no siempre hay alguien disponible para eso. En cambio, el pedido pasa directo a `completado` y se dispara a cocina automáticamente en cuanto CodePay confirma el pago (mismo mecanismo que ya existe hoy para el cobro QR que hace un cajero — se reutiliza tal cual, solo que ahora lo dispara el cliente). El pago real de por medio es en sí mismo una segunda barrera contra pedidos falsos: nadie genera un pedido fantasma pagando plata real por él.

4. **Múltiples pedidos independientes por mesa (rondas).** Una mesa de 5+ personas puede pedir en varias rondas (cada 2-3 personas piden por separado, y después piden más). Cada ronda es un pedido y un cobro QR independiente — no hay "cuenta abierta" que se cierra al final.

5. **Sesión de mesa (nuevo concepto) para evitar choques de mesa.** Si solo se usara `mesa.estado`, existe un caso real: la familia de la mesa 8 sigue sentada y pidiendo (rondas 2, 3...), y mientras tanto el cajero — sin verlo físicamente — crea a mano un pedido nuevo para un cliente distinto y por error/apuro también le asigna la mesa 8. Para evitarlo, al ocupar la mesa se abre una **sesión de mesa** (registro con hora de inicio) que agrupa todos los pedidos de esa mesa hasta que alguien la cierra explícitamente. Si el cajero intenta crear un pedido nuevo en una mesa con sesión activa, el sistema se lo advierte explícitamente en vez de mezclarlo en silencio.

6. **Aviso en tiempo real al cajero/cocina, no aprobación.** En cuanto se confirma un pedido autoservicio, aparece una notificación en vivo (reusando el Socket.IO que ya está montado en el sistema) del tipo *"Mesa 8 — pedido autoservicio confirmado, Bs 45"*, con etiqueta visual `Autoservicio` para diferenciarlo de un pedido tomado por mozo/cajero. Sirve para que el cajero sepa que tiene que llevar esa comida, sin que tenga que aprobar nada.

7. **Gap encontrado: pagos QR abandonados.** El sistema ya tiene expiración de 30 minutos para pagos QR pendientes (`PagoQr.expires_at`), pero hoy se revisa de forma perezosa — solo se dispara cuando alguien consulta activamente el estado de ese pago (la pantalla del cajero, mientras espera). En autoservicio, si el cliente inicia un pago desde su celular y se va sin pagar, nadie más vuelve a consultar ese pago puntual. Se necesita un job programado (mismo patrón que `cumpleanos.job.js`, con `node-cron`) que barra periódicamente los pagos vencidos y los revierta automáticamente, sin depender de que alguien esté mirando esa pantalla. Como el pedido nunca pasa a `completado` sin pago confirmado, esto no genera ninguna pérdida de comida/insumos — es solo higiene de datos (que el pedido fantasma no quede colgado indefinidamente).

## Flujo completo

1. **Setup único:** se genera un QR fijo por mesa, con un código opaco (no el id crudo de la mesa) que apunta a una página pública tipo `carta.tudominio.com/m/<codigo>`. Se imprime y pega una sola vez.
2. **Llega el cliente, se sienta.** El cajero marca la mesa como `ocupada` — esto ya se hace hoy al iniciar cualquier venta en esa mesa, no es un paso nuevo. Se abre automáticamente una sesión de mesa.
3. **El cliente escanea el QR.** Se abre la página pública, sin login. El backend resuelve el código a una mesa y valida que su sesión esté activa.
   - Si la mesa no tiene sesión activa → mensaje de "mesa no habilitada", corta ahí.
   - Si sí → se muestra el menú digital de esa sucursal.
4. **Arma el pedido.** Mismo catálogo y opciones/variantes que ya existen (grupos de opciones, precios adicionales).
5. **Confirma y paga.** Se crea el pedido en estado `pendiente_pago` y se genera un QR de cobro CodePay (mismo mecanismo que el cobro QR actual). El cliente paga desde la app de su banco.
6. **Pago confirmado (webhook CodePay).** El pedido pasa a `completado` automáticamente, se dispara a cocina, se descuentan insumos por receta (si aplica) — todo el pipeline que ya existe hoy para una venta completada. Se emite una notificación en vivo al cajero/cocina etiquetada `Autoservicio`.
7. **Si el cliente abandona el pago sin completarlo.** El job periódico de expiración lo detecta pasados los 30 minutos y revierte el pedido — no llegó a cocina, no se descontó nada, no se perdió plata.
8. **Rondas siguientes.** El cliente puede volver a escanear el mismo QR y pedir de nuevo mientras la sesión de mesa siga activa — cada ronda repite los pasos 3-6 de forma independiente.
9. **Cierre.** Cuando la mesa se va, el cajero cierra la sesión de mesa (como ya cierra/libera la mesa hoy) — recién ahí vuelve a estar `disponible` para el siguiente grupo, y el QR deja de mostrar menú hasta que se vuelva a abrir.

## Arquitectura

### Base de datos

- **`mesas`** gana una columna `codigo_qr VARCHAR(32) UNIQUE NULL` — código opaco generado al crear la mesa (o al activar autoservicio en una mesa existente), usado en la URL pública. No se expone el `id` numérico de la mesa.
- **Nueva tabla `mesa_sesiones`:**
  ```
  id, mesa_id, sucursal_id,
  abierta_en DATETIME, cerrada_en DATETIME NULL,
  abierta_por ENUM('staff','autoservicio') -- quién disparó la apertura
  ```
  Reemplaza la señal binaria de `mesa.estado` como fuente de verdad para "¿puedo pedir/crear un pedido en esta mesa ahora?" — `mesa.estado` se sigue actualizando para no romper la UI actual del mapa de mesas, pero la validación real (QR y choque de mesas) se hace contra la sesión.
- **`pedidos`** gana:
  - `mesa_sesion_id INT UNSIGNED NULL` — a qué sesión de mesa pertenece (NULL para pedidos que no son de mesa, ej. para llevar).
  - `origen ENUM('staff','autoservicio') DEFAULT 'staff'` — para diferenciarlo en reportes y en el aviso en vivo del cajero.

### Backend

- **Endpoints públicos (sin autenticación)**, nuevo módulo `backend/src/modules/autoservicio/`:
  - `GET /publico/mesa/:codigo_qr` — resuelve el código, valida sesión activa, devuelve el menú de la sucursal (productos, opciones, precios).
  - `POST /publico/mesa/:codigo_qr/pedido` — arma el pedido igual que `crearCompleta` hoy, pero fuerza `metodo_pago: 'qr'` y arranca directo el flujo `iniciarPagoQr` (reutilizado tal cual). Devuelve el `qr_code` de CodePay para que el cliente pague desde su banco.
  - `GET /publico/mesa/:codigo_qr/pedido/:id/estado` — poll simple para que la pantalla del cliente sepa cuándo se confirmó el pago (reutiliza `consultarEstadoPagoQr`).
- **`mesas.service.js` (modificar):** `abrirSesion(mesa_id)` / `cerrarSesion(mesa_id)` — se llaman desde el flujo actual de "iniciar venta en mesa" y "liberar mesa", sin cambiar esas pantallas más que agregar esta llamada.
- **`ventas.service.js` (modificar):** al crear un pedido en una mesa, verificar si ya hay una sesión activa distinta a la que se está por abrir — si el cajero intenta abrir una nueva sesión en una mesa que ya tiene una activa, devolver el detalle de la sesión existente (hora de apertura, monto acumulado) para que el frontend se lo muestre como advertencia en vez de crear el pedido directo.
- **Nuevo job `expirarPagosQr.job.js`** (`node-cron`, cada 5 minutos): busca `PagoQr` en estado `pendiente` con `expires_at` vencido y llama a `_revertirPagoQr` — mismo código que ya existe, solo que ahora se dispara solo en vez de depender de un poll.
- **Socket.IO:** al confirmarse un pago de un pedido con `origen = 'autoservicio'`, emitir un evento adicional (ej. `restaurante:autoservicio_confirmado`) con mesa, monto y hora, que la pantalla de caja/cocina escucha para mostrar el aviso en vivo.

### Frontend

- **Nueva mini-app pública** (`frontend/src/paginas-publicas/AutoservicioPage.jsx` o proyecto separado liviano — a definir en el plan de implementación), ruta tipo `/m/:codigo`, sin layout ni login del sistema actual: menú, carrito, selección de opciones, pantalla de "esperando pago" con el QR de CodePay, y pantalla de confirmación.
- **Vista de caja/cocina:** feed en vivo de pedidos autoservicio confirmados (badge/notificación), y aviso al intentar abrir una mesa que ya tiene sesión activa.
- **Reportes:** el reporte de Ventas (`TabVentas.jsx`, ya tiene filtro de tipo mesa/llevar) suma un filtro/columna de `origen` para poder ver cuánto se vendió por autoservicio vs. staff.

## Testing

- Mesa `disponible` (sin sesión activa): el QR no muestra el menú.
- Mesa con sesión activa: el QR muestra el menú y permite pedir.
- Pago QR confirmado: el pedido pasa a completado, dispara cocina, descuenta insumos por receta — igual que un cobro QR hecho por un cajero.
- Pago QR abandonado: pasados los 30 minutos, el job lo revierte automáticamente sin intervención humana.
- Segunda ronda en la misma sesión de mesa: se crea como pedido independiente, mismo `mesa_sesion_id`.
- Cajero intenta crear un pedido a mano en una mesa con sesión de autoservicio activa: recibe la advertencia con el detalle de la sesión existente, no se mezcla en silencio.
- Cierre de sesión de mesa: el QR deja de mostrar menú hasta que se abra una sesión nueva.
- Reporte de ventas: un pedido `origen='autoservicio'` aparece correctamente etiquetado y sumado en los totales existentes.
