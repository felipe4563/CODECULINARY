# Opciones de Producto Multi-Paso (Sabor → Específico)

**Fecha:** 2026-07-31

## Goal

Hoy un producto puede tener **un solo** grupo de opciones (`productos.grupo_opciones_id`, FK 1 a 1), y el cliente elige una sola opción de ese grupo (o "sin especificar") en `SelectorOpcionModal.jsx`. Un negocio necesita encadenar varios grupos por producto — por ejemplo, para "bubbas": primero elegir **Sabor** (única elección) y después elegir **Extras** (varias a la vez, ej. "chocolate" y "maní"). Este trabajo reemplaza la relación 1-a-1 por una relación muchos-a-muchos ordenada, agrega selección única/múltiple por grupo, y convierte el selector de opciones en un asistente de pasos secuenciales.

**Fuera de alcance:** el rediseño visual de `VentasPage.jsx` a los tokens shadcn/ui — se hace en un trabajo separado, después de esta feature (decisión explícita del usuario: primero la funcionalidad, después el rediseño incluyéndola).

## Decisiones (de la sesión de brainstorming)

1. **Tipo de selección por grupo:** configurable — cada grupo de opciones define si es de elección única (radio/botones, como hoy) o múltiple (checkboxes). Un mismo grupo tiene un solo `tipo_seleccion`, pero productos distintos pueden reusar grupos distintos con tipos distintos.
2. **Obligatoriedad:** configurable por asignación producto↔grupo, no por el grupo en sí. El mismo grupo "Extras" podría ser obligatorio en un producto y opcional en otro.
3. **Almacenamiento de la elección final:** se mantiene como texto libre concatenado en `detalle_pedidos.nota` (columna ya existente, `varchar(255)`) — no se crea tabla nueva de detalle. Cero cambios en comanda de cocina, tickets de venta, o reportes, porque todos ya leen `nota` como texto plano.

## Arquitectura

### Base de datos (migración `019_opciones_multipaso.sql`)

```sql
ALTER TABLE grupos_opciones
  ADD COLUMN tipo_seleccion ENUM('unica','multiple') NOT NULL DEFAULT 'unica' AFTER nombre;

CREATE TABLE producto_grupos_opciones (
  producto_id INT UNSIGNED NOT NULL,
  grupo_opciones_id INT UNSIGNED NOT NULL,
  orden INT NOT NULL DEFAULT 0,
  obligatorio TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (producto_id, grupo_opciones_id),
  FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE,
  FOREIGN KEY (grupo_opciones_id) REFERENCES grupos_opciones(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Migrar asignaciones existentes (1 grupo por producto → orden 0, no obligatorio,
-- igual al comportamiento actual donde siempre se puede "agregar sin especificar")
INSERT INTO producto_grupos_opciones (producto_id, grupo_opciones_id, orden, obligatorio)
SELECT id, grupo_opciones_id, 0, 0 FROM productos WHERE grupo_opciones_id IS NOT NULL;

ALTER TABLE productos DROP FOREIGN KEY productos_ibfk_2;
ALTER TABLE productos DROP COLUMN grupo_opciones_id;
```

(Verificado contra `bd/bd_codeculinary.sql:1094`: la constraint de `grupo_opciones_id` en `productos` se llama exactamente `productos_ibfk_2`.)

### Backend

**Modelos** (`backend/src/models/`):
- `GrupoOpciones.js`: agrega campo `tipo_seleccion`.
- Nuevo modelo `ProductoGrupoOpciones.js` (tabla puente, con `orden`/`obligatorio` como atributos propios — no es una FK simple, es una relación con datos).
- `models/index.js`: `Producto.belongsToMany(GrupoOpciones, { through: ProductoGrupoOpciones, as: 'grupos_opciones', foreignKey: 'producto_id', otherKey: 'grupo_opciones_id' })` y su inversa. Se quita la asociación 1-a-1 anterior (`Producto.belongsTo(GrupoOpciones, { as: 'grupo_opciones' })`).

**`productos.service.js`**:
- `crearGrupoOpciones`/`actualizarGrupoOpciones`: aceptan y persisten `tipo_seleccion`.
- `crearProducto`/`actualizarProducto`: aceptan `grupos_opciones: [{ id, orden, obligatorio }]` (array, puede venir vacío). En una transacción: `ProductoGrupoOpciones.destroy({ where: { producto_id } })` seguido de `bulkCreate` con el nuevo set — mismo patrón "reemplazar todo" que ya usa `actualizarGrupoOpciones` con sus `opciones`.
- `listarProductos`/`obtenerProducto`: el `include` de `GrupoOpciones` cambia de la asociación 1-a-1 (`as: 'grupo_opciones'`) a la muchos-a-muchos (`as: 'grupos_opciones'`), con `through: { attributes: ['orden', 'obligatorio'] }`, ordenado por `orden ASC`, y cada grupo trae sus `opciones` anidadas como ya ocurre hoy.

**Validación:** al guardar un producto, rechazar si `grupos_opciones` tiene IDs de grupo duplicados (400).

### Frontend — Admin (`ProductosPage.jsx`)

- `FormGrupoOpcionesModal`: agrega un selector (dos botones o radio) "Selección única" / "Selección múltiple" junto al nombre del grupo.
- `FormProductoModal`: el `<select>` único de "Grupo de opciones" se reemplaza por una lista de grupos asignados (`form.grupos_opciones: [{ id, orden, obligatorio }]`):
  - Un `<select>` "Agregar grupo..." con los grupos aún no asignados; al elegir uno se agrega al final de la lista.
  - Cada fila de la lista muestra el nombre del grupo, un checkbox "Obligatorio", botón quitar, y botones mover arriba/abajo (mismo patrón de reordenamiento que ya usa `FormGrupoOpcionesModal` para sus `opciones`).

### Frontend — Venta (`SelectorOpcionModal.jsx`, `VentasPage.jsx`)

- `SelectorOpcionModal` pasa de mostrar un único grupo a recorrer `producto.grupos_opciones` (ya ordenado por `orden` desde el backend) como pasos secuenciales, con estado interno `pasoActual` y un array de selecciones acumuladas.
  - Paso de tipo `'unica'`: botones tipo pill (igual al diseño actual), un clic elige y avanza al siguiente paso.
  - Paso de tipo `'multiple'`: checkboxes + botón "Continuar" (habilitado siempre, incluso con 0 elegidas si el paso no es obligatorio).
  - Si `obligatorio` es `false`: aparece un enlace "Saltar este paso" además de las opciones.
  - Al completar el último paso, construye el texto final uniendo cada grupo no vacío como `"<nombre grupo>: <opciones elegidas separadas por coma>"`, unidos entre sí con ` · `, y llama `onElegir(notaFinal)` — si todos los pasos se saltaron, `onElegir(null)`, igual que el comportamiento actual de "Agregar sin especificar".
- `VentasPage.jsx`: `handleProducto` cambia la condición `if (prod.grupo_opciones)` por `if (prod.grupos_opciones?.length > 0)`.

## Testing

- Backend: tests existentes de `productos.test.js` se actualizan para el nuevo shape (`grupos_opciones` array en vez de `grupo_opciones` objeto); se agregan casos para: crear producto con 2 grupos ordenados, actualizar reemplazando el set completo, rechazo por grupo duplicado, y que borrar un grupo no rompa productos que lo tenían (igual que hoy con `ON DELETE CASCADE` en la tabla puente — a diferencia de hoy que ponía `grupo_opciones_id = NULL`, ahora directamente desaparece la fila de la asignación, comportamiento equivalente).
- Frontend: no hay test runner (restricción ya documentada en el proyecto) — verificación manual vía `npm run lint`/`npm run build` + inspección en navegador.

## Fuera de alcance (explícito)

- Rediseño visual de `VentasPage.jsx`/`SelectorOpcionModal.jsx` a shadcn — trabajo separado posterior.
- Reportes o analítica sobre qué extras se piden más (el texto libre no lo permite; quedaría para una futura migración a almacenamiento estructurado si se pidiera).
- Límite máximo de grupos por producto — no se impone ninguno explícito, queda gobernado por el buen juicio de quien configura el producto.
