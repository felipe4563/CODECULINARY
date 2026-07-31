# Rediseño visual con shadcn/ui + tema configurable

## Contexto

El sistema (restaurante/POS: Ventas, Cocina, Caja, Productos, Reportes, administración) usa React 18 + Vite + Tailwind 3 en JavaScript (sin TypeScript), con ~30 páginas y componentes compartidos (`Modal`, `Sidebar`, `Topbar`, etc.) que usan clases de Tailwind fijas (`bg-blue-600`, `text-blue-600`, ...) repetidas en decenas de archivos. Visualmente se ve como un dashboard genérico, no como un producto formal de restaurante.

El negocio planea convertirse en un SaaS que atienda distintos rubros de comida (carnicería, pescadería, pollo broaster, etc.), potencialmente con un superadmin gestionando múltiples restaurantes. **Ese cambio multi-tenant queda fuera de este documento** — se diseñará por separado. Aquí solo se sienta la base para que el color de marca sea configurable por restaurante, sin construir todavía el modelo multi-tenant.

## Objetivo

1. Dar una identidad visual consistente y "formal" a todas las páginas del sistema.
2. Dejar el color primario/secundario configurable desde `ConfiguracionPage.jsx`, guardado en la tabla `configuraciones` existente, aplicado en tiempo real sin recompilar.
3. No tocar lógica de negocio — es un cambio de capa visual únicamente.

## Fuera de alcance

- Modelo multi-tenant / superadmin / múltiples restaurantes en una sola instancia.
- Cambio de framework (sigue siendo React + Vite, no Next.js).
- Cambios de flujo o de lógica de negocio en cualquier página.

## Arquitectura

### Librería de componentes

Se adopta **shadcn/ui** sobre la base Tailwind existente. No es una dependencia de runtime: los componentes se generan como archivos `.jsx` dentro del proyecto (`src/components/ui/`), así que se pueden editar libremente y no hay conflicto con el resto del código. Usa Radix UI por debajo para accesibilidad (foco, teclado, aria) en modales, dropdowns, tabs, etc.

### Sistema de temas

- Variables CSS en `:root` (`--primary`, `--secondary`, `--background`, `--foreground`, `--muted`, `--border`, etc.), siguiendo la convención estándar de shadcn, definidas en `src/index.css`.
- Paleta neutra por defecto: gris carbón como base + un acento teal/azul-grisáceo apagado (reemplaza el azul genérico actual). Debe funcionar en modo claro y oscuro (el proyecto ya tiene `useTheme`/`themeStore` para eso).
- Tailwind (`tailwind.config.js`) se extiende para que sus utilidades de color (`bg-primary`, `text-primary`, etc.) lean esas variables CSS, en vez de usar los colores fijos de la paleta de Tailwind (`blue-600`, etc.).

### Color de marca configurable

- Se agregan dos claves nuevas a la tabla `configuraciones`: `color_primario`, `color_secundario` (valores hex, ej. `#7c2d12`).
- Se extiende `obtenerPublica()` en `configuracion.service.js` para incluir estas dos claves (ya se usa para `nombre_negocio`/`logo`, que se cargan sin necesidad de estar autenticado — login, etc.).
- Un `ThemeProvider` (nuevo, en el frontend) lee la configuración pública al arrancar la app y, si existen `color_primario`/`color_secundario`, sobreescribe `--primary`/`--secondary` en `:root` vía JS (`style.setProperty`). Si no están configurados, se usa la paleta neutra por defecto — no rompe restaurantes que no lo configuren.
- `ConfiguracionPage.jsx` obtiene un selector de color (input `type="color"` + hex manual) para `color_primario` y `color_secundario`, reutilizando el mismo endpoint de actualización de configuración que ya existe (`PUT /configuracion` o equivalente).

### Componentes base a migrar primero

Por ser compartidos entre casi todas las páginas, se migran antes que nada (esto ya mejora visualmente las ~30 páginas sin tocarlas una por una):

- `Modal.jsx` → `Dialog` de shadcn (mantiene la misma API externa — `titulo`, `onClose`, `children`, `ancho` — para no tener que tocar cada modal que lo consume).
- Botones (variantes: primario, secundario, destructivo, ghost).
- Inputs de texto, selects, textareas.
- `Sidebar.jsx` / `Topbar.jsx` / `Layout.jsx`.
- Tablas (usadas en Productos, Usuarios, Roles, Compras, Reportes, etc.).
- Badges de estado (pendiente/listo/completado/cancelado, etc.).
- Dropdowns/menús contextuales.

### Migración de páginas (orden)

Después de la base de componentes, se pasa cada página explícitamente a los nuevos componentes, en este orden (por uso diario):

1. **Ventas/POS** (`VentasPage.jsx`, `PedidoPage.jsx` y sus modales) + **Cocina** (`CocinaPage.jsx`) — las de mayor uso operativo diario.
2. **Caja** (`CajaPage.jsx`), **Reportes** (`ReportesPage.jsx` + tabs), **Productos** (`ProductosPage.jsx`).
3. Administración: `UsuariosPage`, `RolesPage`, `SucursalesPage`, `CajasPage`, `ClientesPage`, `ComprasPage`, `InventarioPage`, `LibroCajaPage`.
4. `LoginPage.jsx` (primera impresión) y `PerfilPage.jsx` al final.

### Verificación

Cada fase (base de componentes, cada grupo de páginas) se verifica levantando el servidor de desarrollo (`npm run dev`) y probando visualmente en navegador — no solo que compile. Es trabajo de UI: el criterio de éxito es visual, no solo ausencia de errores de build.

## Riesgos / decisiones a vigilar

- Migrar 29 archivos de página es trabajo grande; se hace por fases para poder revisar y ajustar el rumbo sin esperar a que todo esté listo.
- El `Modal.jsx` actual se usa en al menos 8 páginas/componentes — mantener su misma API pública al migrarlo a `Dialog` evita tener que tocar cada consumidor en el mismo paso.
- Los valores por defecto del tema deben verse bien en claro y oscuro sin que el restaurante configure nada — es el estado inicial de cualquier cliente nuevo.
