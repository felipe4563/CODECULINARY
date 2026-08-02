const DIAS = [
  { valor: 1, etiqueta: 'L' },
  { valor: 2, etiqueta: 'M' },
  { valor: 3, etiqueta: 'X' },
  { valor: 4, etiqueta: 'J' },
  { valor: 5, etiqueta: 'V' },
  { valor: 6, etiqueta: 'S' },
  { valor: 0, etiqueta: 'D' },
];

// `value` es un CSV de números 0=domingo..6=sábado (o null/'' = todos los días).
export default function SelectorDiasSemana({ value, onChange }) {
  const seleccionados = value ? value.split(',').map((d) => parseInt(d.trim(), 10)) : [];

  function toggle(dia) {
    const nuevos = seleccionados.includes(dia)
      ? seleccionados.filter((d) => d !== dia)
      : [...seleccionados, dia];
    onChange(nuevos.length === 0 ? null : nuevos.sort().join(','));
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {DIAS.map((d) => (
        <button
          key={d.valor}
          type="button"
          onClick={() => toggle(d.valor)}
          className={`w-9 h-9 rounded-lg text-xs font-semibold border transition-colors ${
            seleccionados.includes(d.valor)
              ? 'bg-primary border-primary text-primary-foreground'
              : 'bg-background border-input text-muted-foreground hover:border-primary/50'
          }`}
        >
          {d.etiqueta}
        </button>
      ))}
    </div>
  );
}
