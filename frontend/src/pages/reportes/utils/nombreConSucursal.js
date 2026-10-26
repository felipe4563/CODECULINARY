// Con catálogo por sucursal dos productos pueden llamarse igual: el global ve
// también la sucursal del producto/combo.
export const nombreConSucursal = (fila, esGlobal) =>
  esGlobal && fila.sucursal_nombre ? `${fila.nombre} · ${fila.sucursal_nombre}` : fila.nombre;
