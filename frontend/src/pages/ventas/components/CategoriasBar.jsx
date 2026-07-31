export default function CategoriasBar({ categorias, categoriaActiva, onSeleccionar }) {
  const items = [{ id: null, nombre: 'Todos' }, ...categorias];

  return (
    <div className="flex flex-wrap gap-2 shrink-0">
      {items.map((cat) => {
        const activa = categoriaActiva === cat.id;
        return (
          <button
            key={cat.id ?? 'todos'}
            type="button"
            onClick={() => onSeleccionar(cat.id)}
            className={`px-4 py-2 rounded-full text-sm font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:focus-visible:ring-offset-background ${
              activa
                ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/30'
                : 'bg-card border border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
            }`}
          >
            {cat.nombre}
          </button>
        );
      })}
    </div>
  );
}
