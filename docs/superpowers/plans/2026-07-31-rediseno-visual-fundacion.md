# Rediseño Visual — Fase 1: Fundación (shadcn/ui + tema configurable) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Instalar y dejar funcionando la base del rediseño visual (shadcn/ui + sistema de temas por variables CSS) con el color de marca configurable por restaurante desde `ConfiguracionPage.jsx`, sin tocar todavía la migración página por página.

**Architecture:** shadcn/ui se integra como código copiado al proyecto (no dependencia de runtime), usando Radix UI por debajo. El color se controla con variables CSS en `:root`/`.dark` (paleta neutra por defecto); un componente de efecto (`BrandTheme`) lee `color_primario`/`color_secundario` desde `configuraciones` (vía el endpoint público ya existente) y sobreescribe esas variables en tiempo real. `Modal.jsx` se migra a `Dialog` de shadcn manteniendo su misma API externa para no romper a sus 8+ consumidores.

**Tech Stack:** React 18 + Vite 5 + Tailwind 3.4 (JavaScript, sin TypeScript) en el frontend; Node/Express + Sequelize + Jest/Supertest en el backend.

## Global Constraints

- Frontend en JavaScript puro (sin TypeScript) — el proyecto no usa TS en ningún lado.
- `darkMode: 'class'` de Tailwind debe seguir funcionando exactamente igual (el toggle claro/oscuro ya existente vía `useThemeStore`/`useTheme` no se toca).
- No cambiar de framework: sigue siendo React + Vite.
- La API pública de `Modal.jsx` — `{ titulo, onClose, children, ancho }` — no puede cambiar; la consumen 8+ archivos que no se tocan en este plan.
- Las claves de configuración son exactamente `color_primario` y `color_secundario` (strings hex, ej. `#245b62`), guardadas en la tabla `configuraciones` ya existente.
- Si el restaurante no configura colores, se debe ver bien la paleta neutra por defecto, en claro y oscuro, sin ninguna acción del usuario.
- Backend: seguir el patrón de test ya establecido (Jest + Supertest, login real contra la API) — ver `backend/tests/productos.test.js` y `backend/tests/roles.test.js` como referencia de estilo.
- Frontend: **no hay test runner configurado** (solo ESLint) — no se introduce uno nuevo en este plan. La verificación de tareas de frontend es manual: `npm run dev` + revisión en navegador, tal como especifica el spec (`docs/superpowers/specs/2026-07-31-rediseno-visual-shadcn-design.md`).
- No se modifica lógica de negocio de ninguna página en este plan — solo capa visual/tema.

---

### Task 1: Backend — exponer colores de marca en la configuración pública

**Files:**
- Modify: `backend/src/modules/configuracion/configuracion.service.js:12`
- Test: `backend/tests/configuracion.test.js`

**Interfaces:**
- Produces: `GET /api/v1/configuracion/publica` (sin auth) ahora puede incluir `color_primario` y `color_secundario` además de `nombre_negocio`/`logo`.
- Consumes: nada nuevo — reutiliza `Configuracion.findAll`/`Configuracion.upsert` ya existentes.

- [ ] **Step 1: Escribir el test que falla**

Agregar al final de `backend/tests/configuracion.test.js`:

```js
describe('Configuración pública incluye colores de marca', () => {
  let adminToken;

  beforeAll(async () => {
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@restaurante.com', contrasena: process.env.ADMIN_PASSWORD || 'admin123' });
    adminToken = login.body.datos.token;
  });

  it('PUT /api/v1/configuracion con color_primario/color_secundario, luego GET /api/v1/configuracion/publica los incluye', async () => {
    await request(app)
      .put('/api/v1/configuracion')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ color_primario: '#245b62', color_secundario: '#d97706' })
      .expect(200);

    const res = await request(app).get('/api/v1/configuracion/publica');
    expect(res.status).toBe(200);
    expect(res.body.datos.color_primario).toBe('#245b62');
    expect(res.body.datos.color_secundario).toBe('#d97706');
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd backend && npx jest tests/configuracion.test.js -t "incluye colores de marca"`
Expected: FAIL — `res.body.datos.color_primario` es `undefined` (el endpoint público todavía filtra solo `nombre_negocio`/`logo`).

- [ ] **Step 3: Implementar el cambio mínimo**

En `backend/src/modules/configuracion/configuracion.service.js`, cambiar:

```js
async function obtenerPublica() {
  const claves = ['nombre_negocio', 'logo'];
```

por:

```js
async function obtenerPublica() {
  const claves = ['nombre_negocio', 'logo', 'color_primario', 'color_secundario'];
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd backend && npx jest tests/configuracion.test.js -t "incluye colores de marca"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/configuracion/configuracion.service.js backend/tests/configuracion.test.js
git commit -m "feat: exponer color_primario/color_secundario en configuracion publica"
```

---

### Task 2: Frontend — instalar y configurar la base de shadcn/ui

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/vite.config.js`
- Modify: `frontend/tailwind.config.js`
- Create: `frontend/jsconfig.json`
- Create: `frontend/components.json`
- Create: `frontend/src/lib/utils.js`

**Interfaces:**
- Produces: helper `cn(...inputs)` en `frontend/src/lib/utils.js`, usado por todos los componentes shadcn de las tareas siguientes.
- Produces: alias de import `@/*` → `frontend/src/*` (usado por Tasks 4-7).
- Produces: utilidades de color de Tailwind (`bg-primary`, `text-secondary`, `bg-card`, etc.) mapeadas a variables CSS, consumidas por Task 3 en adelante.

- [ ] **Step 1: Instalar dependencias**

Run (dentro de `frontend/`):
```bash
npm install class-variance-authority clsx tailwind-merge tailwindcss-animate @radix-ui/react-dialog @radix-ui/react-slot
```

- [ ] **Step 2: Agregar el alias `@` en Vite**

En `frontend/vite.config.js`, agregar el import al inicio del archivo:

```js
import { fileURLToPath, URL } from 'node:url';
```

Y dentro del objeto que retorna `defineConfig(({ mode }) => { ... return { ... } })`, agregar la clave `resolve` (al mismo nivel que `plugins` y `server`):

```js
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
```

- [ ] **Step 3: Crear `frontend/jsconfig.json`** (alias para autocompletado del editor)

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: Crear `frontend/components.json`** (marcador estándar de shadcn/ui, útil si luego se usa su CLI)

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": false,
  "tsx": false,
  "tailwind": {
    "config": "tailwind.config.js",
    "css": "src/index.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils"
  }
}
```

- [ ] **Step 5: Crear `frontend/src/lib/utils.js`**

```js
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 6: Extender `frontend/tailwind.config.js`**

Reemplazar todo el contenido por:

```js
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
```

- [ ] **Step 7: Verificar que el build sigue funcionando**

Run: `cd frontend && npm run build`
Expected: build termina sin errores (todavía no se usa nada nuevo, solo se agregó configuración).

- [ ] **Step 8: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vite.config.js frontend/tailwind.config.js frontend/jsconfig.json frontend/components.json frontend/src/lib/utils.js
git commit -m "chore: instalar base de shadcn/ui (deps, alias @, tailwind por variables CSS)"
```

---

### Task 3: Frontend — variables CSS del tema (paleta neutra por defecto, claro + oscuro)

**Files:**
- Modify: `frontend/src/index.css`

**Interfaces:**
- Produces: variables CSS `--background`, `--foreground`, `--card`, `--card-foreground`, `--popover`, `--popover-foreground`, `--primary`, `--primary-foreground`, `--secondary`, `--secondary-foreground`, `--muted`, `--muted-foreground`, `--accent`, `--accent-foreground`, `--destructive`, `--destructive-foreground`, `--border`, `--input`, `--ring`, `--radius`, en `:root` y en `.dark`. Consumidas por `tailwind.config.js` (Task 2) y por los componentes de Tasks 4-6.

- [ ] **Step 1: Reemplazar `frontend/src/index.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 240 10% 12%;

    --card: 0 0% 100%;
    --card-foreground: 240 10% 12%;

    --popover: 0 0% 100%;
    --popover-foreground: 240 10% 12%;

    --primary: 189 45% 28%;
    --primary-foreground: 0 0% 100%;

    --secondary: 240 5% 90%;
    --secondary-foreground: 240 10% 12%;

    --muted: 240 5% 96%;
    --muted-foreground: 240 4% 46%;

    --accent: 189 45% 92%;
    --accent-foreground: 189 45% 20%;

    --destructive: 0 72% 51%;
    --destructive-foreground: 0 0% 100%;

    --border: 240 6% 88%;
    --input: 240 6% 88%;
    --ring: 189 45% 28%;

    --radius: 0.75rem;
  }

  .dark {
    --background: 240 10% 8%;
    --foreground: 0 0% 96%;

    --card: 240 8% 12%;
    --card-foreground: 0 0% 96%;

    --popover: 240 8% 12%;
    --popover-foreground: 0 0% 96%;

    --primary: 189 55% 45%;
    --primary-foreground: 240 10% 8%;

    --secondary: 240 6% 18%;
    --secondary-foreground: 0 0% 96%;

    --muted: 240 6% 16%;
    --muted-foreground: 240 5% 65%;

    --accent: 189 40% 20%;
    --accent-foreground: 189 55% 85%;

    --destructive: 0 62% 45%;
    --destructive-foreground: 0 0% 96%;

    --border: 240 6% 20%;
    --input: 240 6% 20%;
    --ring: 189 55% 45%;
  }
}
```

- [ ] **Step 2: Verificación manual visual**

Run: `cd frontend && npm run dev`, abrir la app en el navegador, iniciar sesión.
Expected: todas las páginas se ven exactamente igual que antes (las clases `bg-blue-600`, `text-gray-800`, etc. no fueron tocadas — las nuevas variables todavía no las usa ningún componente existente). Alternar el toggle de modo oscuro (Topbar) sigue funcionando igual que antes. No debe haber errores en la consola del navegador.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/index.css
git commit -m "feat: definir paleta de tema por defecto (variables CSS, claro y oscuro)"
```

---

### Task 4: Frontend — componentes base `Button` y `Dialog` de shadcn/ui

**Files:**
- Create: `frontend/src/components/ui/button.jsx`
- Create: `frontend/src/components/ui/dialog.jsx`

**Interfaces:**
- Consumes: `cn` de `frontend/src/lib/utils.js` (Task 2).
- Produces: `Button, buttonVariants` desde `button.jsx` — `<Button variant="default|secondary|destructive|outline|ghost|link" size="default|sm|lg|icon">`.
- Produces: `Dialog, DialogTrigger, DialogPortal, DialogClose, DialogOverlay, DialogContent, DialogHeader, DialogTitle, DialogBody` desde `dialog.jsx` — usados por Task 5.

- [ ] **Step 1: Crear `frontend/src/components/ui/button.jsx`**

```jsx
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 px-3',
        lg: 'h-11 px-6',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

const Button = React.forwardRef(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
});
Button.displayName = 'Button';

export { Button, buttonVariants };
```

- [ ] **Step 2: Crear `frontend/src/components/ui/dialog.jsx`**

```jsx
import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-1/2 top-1/2 z-50 grid w-full max-w-md -translate-x-1/2 -translate-y-1/2 gap-0 border border-border bg-card text-card-foreground p-0 shadow-xl rounded-2xl max-h-[90vh] flex flex-col data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
        className
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }) => (
  <div className={cn('flex items-center justify-between px-6 py-4 border-b border-border shrink-0', className)} {...props} />
);

const DialogTitle = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn('font-semibold text-foreground', className)} {...props} />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogBody = ({ className, ...props }) => (
  <div className={cn('overflow-y-auto p-6', className)} {...props} />
);

export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogClose,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
};
```

- [ ] **Step 3: Verificar que compila**

Run: `cd frontend && npm run build`
Expected: build termina sin errores (los archivos nuevos no se importan todavía desde ningún lado, pero deben ser JS/JSX válido — Vite igual los procesa si hay algún import dinámico; si el build pasa sin tocarlos, hacer además `npx eslint src/components/ui/button.jsx src/components/ui/dialog.jsx` y confirmar 0 errores).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ui/button.jsx frontend/src/components/ui/dialog.jsx
git commit -m "feat: agregar componentes base Button y Dialog de shadcn/ui"
```

---

### Task 5: Frontend — migrar `Modal.jsx` a `Dialog`, manteniendo su API externa

**Files:**
- Modify: `frontend/src/components/ui/Modal.jsx`

**Interfaces:**
- Consumes: `Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogClose` de `frontend/src/components/ui/dialog.jsx` (Task 4).
- Produces: `export default function Modal({ titulo, onClose, children, ancho = 'max-w-md' })` — **misma firma que antes**, sin cambios para sus consumidores (`VentasPage.jsx`, `PedidoPage.jsx`, `ConfiguracionPage.jsx`, `ModalLlevar.jsx`, etc.).

- [ ] **Step 1: Reemplazar el contenido de `frontend/src/components/ui/Modal.jsx`**

```jsx
import { X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogClose } from './dialog';

export default function Modal({ titulo, onClose, children, ancho = 'max-w-md' }) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className={ancho}>
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogClose className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <X className="w-4 h-4" />
          </DialogClose>
        </DialogHeader>
        <DialogBody>{children}</DialogBody>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verificación manual — apertura/cierre**

Run: `cd frontend && npm run dev`, iniciar sesión, ir a Ventas.
Expected:
1. Click en "Para llevar" abre `ModalLlevar` centrado, con overlay oscuro detrás.
2. Tecla `Escape` cierra el modal (comportamiento nuevo gracias a Radix — antes no existía).
3. Click fuera del modal (en el overlay) lo cierra.
4. Click en la `X` lo cierra.
5. El ancho (`max-w-sm` en este caso) se respeta igual que antes.
No debe haber errores en la consola del navegador.

- [ ] **Step 3: Verificación manual — otro modal con contenido scrolleable**

Ir a Ventas → seleccionar una mesa con productos en el carrito → "Cobrar" (abre `ModalCobrar`, `ancho="max-w-sm"`).
Expected: se ve igual que antes (fondo blanco/gris según tema, borde redondeado, header con título y X, cuerpo con scroll si el contenido es alto).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ui/Modal.jsx
git commit -m "refactor: migrar Modal a Dialog de shadcn/ui manteniendo su API externa"
```

---

### Task 6: Frontend — selector de color de marca en `ConfiguracionPage.jsx`

**Files:**
- Modify: `frontend/src/pages/configuracion/ConfiguracionPage.jsx`

**Interfaces:**
- Consumes: `getConfiguracion`, `actualizarConfiguracion` (ya existentes en `frontend/src/api/configuracion.js`, sin cambios necesarios — `actualizar` en el backend acepta cualquier par clave/valor).
- Produces: los campos `color_primario`/`color_secundario` viajan dentro del mismo `form` que ya se guarda con `guardar.mutate(form)`.

- [ ] **Step 1: Agregar los campos al estado inicial del formulario**

En `frontend/src/pages/configuracion/ConfiguracionPage.jsx`, dentro de `TabNegocio`, modificar el bloque:

```js
  if (!isLoading && form === null) {
    setForm({
      nombre_negocio: config.nombre_negocio ?? '',
      direccion:      config.direccion      ?? '',
      telefono:       config.telefono       ?? '',
      moneda:         config.moneda         ?? 'Bs',
      simbolo_moneda: config.simbolo_moneda ?? 'Bs.',
      zona_horaria:   config.zona_horaria   ?? 'America/La_Paz',
      pie_ticket:     config.pie_ticket     ?? '¡Gracias por su preferencia!',
      logo:           config.logo           ?? '',
    });
  }
```

por:

```js
  if (!isLoading && form === null) {
    setForm({
      nombre_negocio: config.nombre_negocio ?? '',
      direccion:      config.direccion      ?? '',
      telefono:       config.telefono       ?? '',
      moneda:         config.moneda         ?? 'Bs',
      simbolo_moneda: config.simbolo_moneda ?? 'Bs.',
      zona_horaria:   config.zona_horaria   ?? 'America/La_Paz',
      pie_ticket:     config.pie_ticket     ?? '¡Gracias por su preferencia!',
      logo:           config.logo           ?? '',
      color_primario:   config.color_primario   ?? '#245b62',
      color_secundario: config.color_secundario ?? '#d97706',
    });
  }
```

- [ ] **Step 2: Agregar los inputs de color en el formulario**

Ubicar en el mismo archivo:

```jsx
      {campo('Pie de ticket', 'pie_ticket', { textarea: true, placeholder: '¡Gracias por su preferencia!' })}

      {puedeEditar && (
        <div className="flex items-center gap-4 pt-2">
```

Y reemplazar por:

```jsx
      {campo('Pie de ticket', 'pie_ticket', { textarea: true, placeholder: '¡Gracias por su preferencia!' })}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
            Color primario
          </label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={form.color_primario}
              onChange={e => set('color_primario', e.target.value)}
              disabled={!puedeEditar}
              className="w-10 h-10 rounded-lg border border-gray-200 dark:border-gray-600 bg-transparent disabled:opacity-60"
            />
            <input
              type="text"
              value={form.color_primario}
              onChange={e => set('color_primario', e.target.value)}
              disabled={!puedeEditar}
              className="flex-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
            Color secundario
          </label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={form.color_secundario}
              onChange={e => set('color_secundario', e.target.value)}
              disabled={!puedeEditar}
              className="w-10 h-10 rounded-lg border border-gray-200 dark:border-gray-600 bg-transparent disabled:opacity-60"
            />
            <input
              type="text"
              value={form.color_secundario}
              onChange={e => set('color_secundario', e.target.value)}
              disabled={!puedeEditar}
              className="flex-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl px-4 py-2.5 text-sm text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
            />
          </div>
        </div>
      </div>

      {puedeEditar && (
        <div className="flex items-center gap-4 pt-2">
```

- [ ] **Step 3: Verificación manual**

Run: `cd frontend && npm run dev`, iniciar sesión como admin, ir a Configuración → Negocio.
Expected:
1. Se ven dos campos nuevos ("Color primario", "Color secundario") con un cuadro de color + un input de texto hex, prellenados con `#245b62` y `#d97706` (o los valores ya guardados).
2. Cambiar el color primario a otro valor, click en "Guardar cambios" → aparece "Guardado correctamente".
3. Recargar la página (F5) → el color elegido sigue ahí (confirma que se persistió vía `PUT /api/v1/configuracion`).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/configuracion/ConfiguracionPage.jsx
git commit -m "feat: agregar selector de color de marca en Configuracion > Negocio"
```

---

### Task 7: Frontend — aplicar el color de marca en tiempo real (`BrandTheme`)

**Files:**
- Create: `frontend/src/lib/color.js`
- Create: `frontend/src/components/theme/BrandTheme.jsx`
- Modify: `frontend/src/App.jsx`

**Interfaces:**
- Produces: `hexToHslTriplet(hex: string): string` en `frontend/src/lib/color.js` — convierte `"#rrggbb"` al formato `"H S% L%"` que usan las variables CSS de Task 3.
- Consumes: `getConfiguracionPublica` de `frontend/src/api/configuracion.js` (ya existente).
- Produces: `<BrandTheme />`, componente de efecto (no renderiza nada visible) montado en `App.jsx` junto a `<ThemeSync />`.

- [ ] **Step 1: Crear `frontend/src/lib/color.js`**

```js
// Convierte un color hex (#rrggbb) al formato "H S% L%" usado por las
// variables CSS del tema (ver src/index.css), para poder sobreescribirlas
// en tiempo real con el color de marca que configure cada restaurante.
export function hexToHslTriplet(hex) {
  const clean = hex.replace('#', '');
  const bigint = parseInt(clean, 16);
  const r = ((bigint >> 16) & 255) / 255;
  const g = ((bigint >> 8) & 255) / 255;
  const b = (bigint & 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }

  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}
```

- [ ] **Step 2: Verificar el algoritmo manualmente**

Run:
```bash
node -e "
function hexToHslTriplet(hex) {
  const clean = hex.replace('#', '');
  const bigint = parseInt(clean, 16);
  const r = ((bigint >> 16) & 255) / 255;
  const g = ((bigint >> 8) & 255) / 255;
  const b = (bigint & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return Math.round(h*360) + ' ' + Math.round(s*100) + '% ' + Math.round(l*100) + '%';
}
console.log(hexToHslTriplet('#ff0000'));
console.log(hexToHslTriplet('#00ff00'));
console.log(hexToHslTriplet('#b3441e'));
"
```
Expected exactamente:
```
0 100% 50%
120 100% 50%
15 71% 41%
```

- [ ] **Step 3: Crear `frontend/src/components/theme/BrandTheme.jsx`**

```jsx
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getConfiguracionPublica } from '../../api/configuracion';
import { hexToHslTriplet } from '../../lib/color';

// Sobreescribe --primary/--secondary en :root con el color de marca del
// restaurante (si lo configuró en Configuración > Negocio). Si no hay
// nada configurado, no toca nada y queda la paleta neutra por defecto
// definida en src/index.css.
export default function BrandTheme() {
  const { data } = useQuery({
    queryKey: ['configuracion-publica'],
    queryFn: getConfiguracionPublica,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    const root = document.documentElement;
    if (data?.color_primario) {
      root.style.setProperty('--primary', hexToHslTriplet(data.color_primario));
    }
    if (data?.color_secundario) {
      root.style.setProperty('--secondary', hexToHslTriplet(data.color_secundario));
    }
  }, [data]);

  return null;
}
```

- [ ] **Step 4: Montar `BrandTheme` en `App.jsx`**

En `frontend/src/App.jsx`, agregar el import:

```js
import BrandTheme from './components/theme/BrandTheme';
```

Y agregar `<BrandTheme />` junto a `<ThemeSync />`:

```jsx
    <QueryClientProvider client={queryClient}>
      <ThemeSync />
      <BrandTheme />
      <OfflineIndicator />
      <InstallPrompt />
      <RouterProvider router={router} />
    </QueryClientProvider>
```

- [ ] **Step 5: Verificación manual de punta a punta**

Requiere haber completado la Task 6 (selector de color en Configuración).

1. Run: `cd frontend && npm run dev`, iniciar sesión como admin.
2. Ir a Configuración → Negocio, cambiar "Color primario" a `#b3441e`, Guardar.
3. Recargar la página completa (F5).
4. Abrir DevTools → Consola, ejecutar:
   ```js
   getComputedStyle(document.documentElement).getPropertyValue('--primary')
   ```
5. Expected: devuelve `" 15 71% 41%"` (mismo resultado que en el Step 2 de esta tarea) — confirma que `BrandTheme` leyó la configuración pública y sobreescribió la variable CSS correctamente.
6. Volver a Configuración y restaurar el color a `#245b62` si se quiere dejar el valor por defecto.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/color.js frontend/src/components/theme/BrandTheme.jsx frontend/src/App.jsx
git commit -m "feat: aplicar color de marca del restaurante en tiempo real (BrandTheme)"
```

---

## Qué queda para después

Con esta fundación funcionando, los siguientes documentos de plan (fuera de este) migrarán, en orden: Sidebar/Topbar/Layout y tablas/badges/dropdowns compartidos; luego Ventas/POS + Cocina; luego Caja/Reportes/Productos; luego el resto de administración; y por último Login/Perfil — tal como describe el spec. Cada uno de esos planes se escribe una vez que se pueda ver el resultado real de esta fundación (los componentes `Button`/`Dialog` en uso), para dar código exacto en vez de descripciones genéricas.
