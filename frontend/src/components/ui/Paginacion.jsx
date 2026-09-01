import { ChevronLeft, ChevronRight } from 'lucide-react';

// Arma la lista de números de página a mostrar, con `null` como marcador
// de "..." — máximo 7 elementos visibles para que no se rompa en mobile.
function _paginasVisibles(pagina, totalPaginas) {
  if (totalPaginas <= 7) {
    return Array.from({ length: totalPaginas }, (_, i) => i + 1);
  }
  const set = new Set([1, totalPaginas, pagina, pagina - 1, pagina + 1]);
  const ordenadas = Array.from(set).filter(p => p >= 1 && p <= totalPaginas).sort((a, b) => a - b);
  const resultado = [];
  ordenadas.forEach((p, i) => {
    if (i > 0 && p - ordenadas[i - 1] > 1) resultado.push(null);
    resultado.push(p);
  });
  return resultado;
}

export default function Paginacion({ pagina, totalPaginas, onCambiar }) {
  if (!totalPaginas || totalPaginas <= 1) return null;
  const paginas = _paginasVisibles(pagina, totalPaginas);

  return (
    <div className="flex items-center justify-center gap-1 py-3">
      <button
        onClick={() => onCambiar(pagina - 1)}
        disabled={pagina <= 1}
        className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none"
        aria-label="Página anterior"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>

      {paginas.map((p, i) =>
        p === null ? (
          <span key={`ellipsis-${i}`} className="px-1.5 text-xs text-muted-foreground">…</span>
        ) : (
          <button
            key={p}
            onClick={() => onCambiar(p)}
            className={`min-w-[2rem] h-8 px-2 rounded-lg text-xs font-medium transition-colors ${
              p === pagina
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            }`}
          >
            {p}
          </button>
        )
      )}

      <button
        onClick={() => onCambiar(pagina + 1)}
        disabled={pagina >= totalPaginas}
        className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none"
        aria-label="Página siguiente"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}
