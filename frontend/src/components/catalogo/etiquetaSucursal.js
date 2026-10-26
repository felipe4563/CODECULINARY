// "<nombre> · <sucursal>" cuando el usuario es global y el ítem trae su sucursal.
export function conSucursal(item, esGlobal) {
  return esGlobal && item.sucursal?.nombre ? `${item.nombre} · ${item.sucursal.nombre}` : item.nombre;
}
