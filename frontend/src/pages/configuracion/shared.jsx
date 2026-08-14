/* ─── Bloque reutilizable de sección con encabezado ──────────────────────── */
export function SettingsSection({ titulo, descripcion, accion, children }) {
  return (
    <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
      <div className="px-5 py-4 sm:px-6 sm:py-5 border-b border-border flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{titulo}</h2>
          {descripcion && <p className="text-xs text-muted-foreground mt-1">{descripcion}</p>}
        </div>
        {accion}
      </div>
      <div className="p-5 sm:p-6">{children}</div>
    </div>
  );
}

/* ─── Tarjeta simple sin encabezado propio (para tabs de una sola sección,
     donde el título ya lo muestra la cabecera de la página) ──────────────── */
export function SettingsCard({ toolbar, children }) {
  return (
    <div className="bg-card border border-border rounded-2xl shadow-sm p-5 sm:p-6 space-y-4">
      {toolbar && <div className="flex items-center justify-between flex-wrap gap-3">{toolbar}</div>}
      {children}
    </div>
  );
}
