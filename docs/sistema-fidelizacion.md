# Sistema de fidelización — Promociones, Cupones, Ruleta y Cumpleaños

Documentación de cómo funcionan, por dentro, las cuatro piezas del sistema de fidelización de clientes. Las cuatro son independientes entre sí (se pueden usar por separado), pero comparten una misma idea de fondo: **descontar dinero de una venta de forma controlada y auditable**, y en el caso de la ruleta y los cumpleaños, también se apoyan en los **puntos de fidelidad** del cliente.

```
Puntos de fidelidad (Cliente.puntos)
        │
        ├── se ganan comprando (puntos_por_bs) ──────────────► Configuración
        ├── se pueden canjear directo en el cobro (valor_punto_bs)
        └── se pueden gastar para girar la Ruleta ──► genera un Cupón

Promociones ──► descuentan el precio de LISTA de productos específicos, automático, sin código
Cupones     ──► descuentan al cobrar, con código, control de usos y (opcional) restringidos a productos
Ruleta      ──► gasta puntos del cliente y, si gana, genera un Cupón
Cumpleaños  ──► un job diario genera un Cupón personal a cada cliente que cumple años
```

---

## 1. Puntos de fidelidad (la base de todo)

No es una función aparte, pero la ruleta y (indirectamente) los cupones dependen de ella.

- Cada `Cliente` tiene un campo `puntos` (entero).
- Se configuran 4 llaves en `Configuracion` (tabla clave/valor): `fidelidad_activa`, `puntos_por_bs`, `valor_punto_bs`, `fidelidad_canje_efectivo`, `fidelidad_canje_qr`.
- Al **cobrar una venta** (`ventas.service.js` → `_finalizarVenta`), si hay cliente asociado:
  - Se le **acreditan puntos** = `floor(monto_neto * puntos_por_bs)`.
  - Si el cajero indicó `puntos_canjear`, se le **descuentan** esos puntos y el total se reduce en `puntos_canjear * valor_punto_bs`.
- El canje en efectivo y por QR se controlan por separado (`fidelidad_canje_efectivo` / `fidelidad_canje_qr`) porque el pago QR "congela" el monto a cobrar antes de que el cliente pague, así que ahí los puntos se reservan **al generar el QR** (`iniciarPagoQr`), no al cobrar — si el pago falla o expira, se devuelven (`_devolverPuntosCanjeados`).
- Todo el movimiento de saldo pasa por una fila bloqueada (`lock: transaction.LOCK.UPDATE`) dentro de una transacción — así dos cobros simultáneos del mismo cliente no pueden descontarle puntos que no tiene.

---

## 2. Promociones

**Qué son:** un descuento automático sobre el **precio de lista** de uno o varios productos específicos, sin que el cliente/cajero tenga que hacer nada — el precio ya sale rebajado en el menú del POS.

**Modelo:** `Promocion` (`nombre`, `tipo`: `porcentaje` | `monto`, `valor`, `fecha_inicio`, `fecha_fin`, `dias_semana`, `activo`) + tabla puente `promocion_productos` (muchos-a-muchos con `Producto`). Una promo siempre tiene **uno o más productos** asociados (no existe una promo "de todo el carrito").

**Vigencia:** `fecha_inicio`/`fecha_fin` son **inclusivas**, y `dias_semana` es un CSV de números (`0`=domingo…`6`=sábado; vacío = todos los días). La función `estaActivoHoy()` (`backend/src/utils/disponibilidad.js`) es la que decide si una promo/premio está vigente "hoy", usando siempre la hora de Bolivia (UTC-4) para no depender de la zona horaria del servidor.

**Cómo se aplica en el POS:**
1. `promociones.service.js` → `listarActivas()` trae las promos vigentes y las "aplana": si una promo tiene 3 productos, devuelve 3 filas (una por producto), cada una con su propio `producto_id`. Así el frontend arma un mapa `producto_id → promo` igual que si cada promo fuera de un solo producto.
2. `ventas.service.js` → `_precioConPromocion(producto)` busca, para cada producto del carrito, si hay una promo activa que lo incluya (`Promocion.findOne` con `include` sobre `productos` filtrado por ese `producto.id`) y calcula el precio rebajado.
3. El precio con descuento ya es el que se guarda en el detalle del pedido — no es un "descuento" aparte en el recibo, es directamente el precio de venta de esa línea.

**Admin (`PromocionesPage.jsx`):** selector de productos por checkboxes (puede ser más de uno), tipo/valor, rango de fechas y días de la semana.

---

## 3. Cupones

**Qué son:** un descuento que el cajero aplica **al momento de cobrar**, escribiendo o eligiendo un código. A diferencia de las promociones, tienen control de cuántas veces se pueden usar, pueden ser exclusivos de un cliente, y pueden (opcionalmente) restringirse a ciertos productos.

**Modelo:** `Cupon` (`codigo` único, `tipo`: `fijo` | `porcentaje`, `valor`, `fecha_expiracion`, `usos_maximos`, `usos_actuales`, `limite_por_cliente`, `cliente_id` opcional, `activo`) + tabla puente opcional `cupon_productos` (muchos-a-muchos con `Producto` — si está vacía, el cupón aplica a **todo el carrito**; si tiene productos, solo a esos).

**Validación y cálculo del descuento (`cupones.service.js` → `resolver()`):**
1. El cupón debe existir, estar activo, no haber alcanzado `usos_maximos`, y no estar vencido (`fecha_expiracion`).
2. Si tiene `cliente_id`, solo lo puede usar ese cliente exacto.
3. Si tiene `limite_por_cliente`, se cuentan cuántas veces ese cliente ya lo usó en pedidos completados.
4. **Si el cupón está restringido a productos:** la "base" sobre la que se calcula el descuento deja de ser el subtotal completo del carrito y pasa a ser la suma de **solo las líneas del carrito cuyo producto está en la lista del cupón**. Si ninguna línea del carrito coincide, tira error ("solo aplica a ciertos productos que no están en el pedido").
5. El descuento final es `porcentaje` → `base * valor/100`, o `fijo` → `valor` tal cual — pero nunca puede superar `base` (`Math.min(base, ...)`).
6. Con un cupón **`fijo`** restringido a varios productos, el descuento se aplica **una sola vez en total** (no por producto). Con **`porcentaje`**, se aplica sobre la suma de todas las líneas que coincidan — por eso para promos tipo "20% en productos con los colores de Bolivia" conviene usar `porcentaje`, no `fijo`.

**Doble validación:** el mismo `resolver()` se llama primero **sin transacción** como previsualización rápida en el checkout (`validar()`, usado por `CuponInput.jsx`), y de nuevo **dentro de la transacción** que cierra la venta, con la fila del cupón bloqueada (`lock: transaction.LOCK.UPDATE`) — la previsualización nunca es la fuente de verdad, solo la del cobro real cuenta, para que dos cobros concurrentes con el mismo código de un solo uso no lo pasen de largo.

**Admin (`CuponesPage.jsx`):** generación de código (manual o aleatorio, mínimo 2 caracteres), tipo/valor, vencimiento, usos, cliente exclusivo opcional, y checkboxes de productos (opcional) con la etiqueta "Aplica a: Todo el pedido" o la lista de nombres.

---

## 4. Ruleta de premios

**Qué es:** el cliente gasta puntos de fidelidad para tirar una ruleta ponderada; si gana, se le genera automáticamente un **cupón** con el premio.

**Modelo:** `RuletaPremio` (`nombre`, `tipo`: `porcentaje` | `fijo` | `producto_gratis` | `combo_gratis` | `nada`, `valor`, `producto_id`/`combo_id` según el tipo, `probabilidad`, `color`, `orden`, `activo`) + `RuletaGiro` (historial: qué cliente, qué premio, qué cupón generó, cuántos puntos gastó).

**Configuración** (tabla `Configuracion`): `ruleta_activa`, `ruleta_costo_puntos` (cuántos puntos cuesta girar), `ruleta_max_giros_periodo`, `ruleta_periodo` (`dia` | `semana`), `ruleta_vigencia_dias_premio` (cuántos días dura el cupón que se gana).

**El sorteo (`ruleta.service.js` → `_sortear()`):** ponderado por `probabilidad` — se suman las probabilidades de todos los premios activos, se saca un número aleatorio entre 0 y esa suma, y se recorre restando hasta que el resultado cae en un premio. **A propósito, el tamaño visual del segmento en la ruleta ya NO refleja esto** — todos los segmentos se dibujan del mismo tamaño (`calcularSegmentos` en `ruedaUtils.js` reparte 360° en partes iguales), para que la rueda se vea estéticamente equilibrada aunque las probabilidades reales no lo estén (ej. un premio con 80% de probabilidad no se ve como un segmento gigante). El sorteo se hace **en el backend, antes de abrir la transacción** — nunca depende del frontend, para que no se pueda manipular.

**Al girar (`girar()`):**
1. Verifica que el cliente pueda girar: ruleta activa, tenga puntos suficientes, y no haya superado el límite de giros del período (día o semana, calculado en hora de Bolivia).
2. Descuenta `ruleta_costo_puntos` del cliente (con lock de fila).
3. Si el premio sorteado no es `'nada'`, genera un `Cupon` exclusivo de ese cliente:
   - `porcentaje`/`fijo` → el cupón usa el mismo tipo/valor configurado en el premio.
   - `producto_gratis`/`combo_gratis` → **truco clave**: en vez de guardar un precio fijo en el premio (que quedaría desactualizado si el producto sube de precio), en el momento del giro se busca el **precio vigente** del producto/combo y se genera un cupón `tipo: 'fijo'` por ese monto exacto. Esto significa que "premiar con un producto gratis" no necesitó ningún cambio en la lógica de cobro — reutiliza 100% el mecanismo de cupón de monto fijo que ya existía.
4. Se registra el giro en `RuletaGiro` (auditoría: qué se sorteó, qué cupón generó, cuántos puntos costó).

**Frontend:** el spin se hizo con `cubic-bezier(0.16, 1, 0.3, 1)` (desaceleración pura, sin rebote, 5 segundos) para que se sienta como una ruleta física perdiendo velocidad, no como un efecto "elástico". Los nombres de los premios ya no se dibujan curvos dentro de la rueda — viven solo en una leyenda aparte (`LeyendaPremios`) al costado, con nombre + valor, porque el texto curvo dentro de segmentos angostos se cortaba o no se leía bien en pantallas chicas.

**Se puede girar desde dos lugares:** la página dedicada `/ruleta`, y desde dentro del cobro en el POS (`ModalCobrar` en `VentasPage.jsx`) — ambos reutilizan el mismo componente `GirarRuletaPanel.jsx`, parametrizado por `layout: 'grid' | 'stack'` para adaptarse a página completa vs. modal angosto.

---

## 5. Cupones de cumpleaños

**Qué es:** un job que corre **una vez al día** y le regala un cupón a cada cliente que cumple años pronto.

**Job (`backend/src/jobs/cumpleanos.job.js`):**
- Corre todos los días a las **08:00 hora de Bolivia** (`cron.schedule('0 8 * * *', ..., { timezone: 'America/La_Paz' })`, configurado en `server.js`), y también **una vez al iniciar el servidor** por si estuvo caído el día que tocaba correr.
- Configuración (`Configuracion`): `cumple_activo`, `cumple_dias_anticipacion` (cuántos días antes del cumpleaños se genera el cupón — default 5), `cumple_tipo`/`cumple_valor` (tipo y valor del descuento), `cumple_vigencia_dias` (cuánto dura el cupón).
- Busca clientes cuyo `fecha_nacimiento` caiga exactamente `diasAnticipacion` días a partir de hoy, comparando **mes y día** con `MONTH()`/`DAY()` de SQL (así no importa el año de nacimiento).
- Por cada uno, genera un cupón `CUMPLE<cliente_id>-<año>` (`usos_maximos: 1`, exclusivo de ese cliente). El **código incluye el año**, así que si el job corre dos veces en el mismo año para el mismo cliente (ej. el servidor se reinició), lo detecta por código repetido y no duplica el cupón.

---

## Dónde tocar cada cosa

| Función | Backend (lógica) | Backend (modelo/migración) | Frontend (admin) |
|---|---|---|---|
| Puntos de fidelidad | `ventas.service.js` (`_configFidelidad`, `_resolverCanje`) | `Cliente.puntos`, `Configuracion` | `ConfiguracionPage.jsx` |
| Promociones | `promociones.service.js` | `Promocion` + `promocion_productos` (migración `033`) | `PromocionesPage.jsx` |
| Cupones | `cupones.service.js` | `Cupon` + `cupon_productos` (migración `032`) | `CuponesPage.jsx` |
| Ruleta | `ruleta.service.js` | `RuletaPremio`, `RuletaGiro` (migraciones `030`, `031`) | `RuletaPage.jsx`, `Rueda.jsx`, `GirarRuletaPanel.jsx` |
| Cumpleaños | `jobs/cumpleanos.job.js` | reutiliza `Cupon` (migración `028`) | `ConfiguracionPage.jsx` (llaves `cumple_*`) |

Todas las llaves de configuración (`fidelidad_*`, `ruleta_*`, `cumple_*`) viven en la misma tabla genérica `configuracion` (clave/valor), no en columnas propias — así se pueden agregar nuevas sin migraciones.
