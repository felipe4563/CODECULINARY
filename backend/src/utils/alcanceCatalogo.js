const { Sucursal } = require('../models');

// Filtro `where` por sucursal para listados del catálogo. Un usuario de
// sucursal siempre ve la suya; el global ve todo salvo que pida una sucursal.
function filtroSucursalCatalogo({ sucursal_id, acceso_todas }, sucursalSolicitada) {
  if (!acceso_todas) return { sucursal_id };
  const pedida = Number(sucursalSolicitada);
  return pedida ? { sucursal_id: pedida } : {};
}

// Sucursal en la que se crea un registro del catálogo. Un usuario de sucursal
// crea en la suya; el global debe indicar una sucursal existente.
async function sucursalParaCrear({ sucursal_id, acceso_todas }, sucursalBody) {
  if (!acceso_todas) return sucursal_id;
  const id = Number(sucursalBody);
  if (!id) throw Object.assign(new Error('sucursal_id es requerido'), { status: 400 });
  const sucursal = await Sucursal.findByPk(id);
  if (!sucursal) throw Object.assign(new Error('Sucursal no encontrada'), { status: 404 });
  return sucursal.id;
}

// 404 (no 403) para no revelar que el registro existe en otra sucursal.
function verificarSucursal(registro, { sucursal_id, acceso_todas }, mensaje404) {
  if (!acceso_todas && registro.sucursal_id !== sucursal_id) {
    throw Object.assign(new Error(mensaje404), { status: 404 });
  }
}

module.exports = { filtroSucursalCatalogo, sucursalParaCrear, verificarSucursal };
