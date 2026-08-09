const { Op } = require('sequelize');
const { Cliente } = require('../../models');
const personasClient = require('../../integrations/personas/personas.client');

async function listar({ buscar } = {}) {
  const where = {};
  if (buscar) {
    where[Op.or] = [
      { nombre: { [Op.like]: `%${buscar}%` } },
      { numero_documento: { [Op.like]: `%${buscar}%` } },
    ];
  }
  return Cliente.findAll({ where, order: [['nombre', 'ASC']] });
}

async function obtener(id) {
  const c = await Cliente.findByPk(id);
  if (!c) throw Object.assign(new Error('Cliente no encontrado'), { status: 404 });
  return c;
}

async function crear({ nombre, tipo_documento = 'CI', numero_documento, email, telefono, direccion, fecha_nacimiento }) {
  return Cliente.create({ nombre, tipo_documento, numero_documento, email, telefono, direccion, fecha_nacimiento: fecha_nacimiento || null });
}

async function actualizar(id, datos) {
  const c = await Cliente.findByPk(id);
  if (!c) throw Object.assign(new Error('Cliente no encontrado'), { status: 404 });
  await c.update(datos);
  return c;
}

function _mapPersona(persona) {
  const nombre = [
    persona.primerNombre, persona.segundoNombre,
    persona.primerApellido, persona.segundoApellido, persona.tercerApellido, persona.apellidoCasada,
  ].map((s) => (s || '').trim()).filter(Boolean).join(' ');

  return {
    codigo: persona.codigo,
    nombre,
    // numeroDocumento es el número de CI real — lo que se puede volver a
    // buscar más tarde con /personas/documento/{numeroDocumento} (ver
    // buscarPorDocumento más abajo). codigo es la PK interna de la API de
    // Personas, siempre presente pero NO es un documento buscable por ese
    // endpoint — solo se usa como respaldo para los registros donde
    // numeroDocumento viene vacío, para no dejar el campo en blanco.
    numero_documento: persona.numeroDocumento || persona.codigo || null,
    fecha_nacimiento: persona.fechaNacimiento || null,
  };
}

// Consulta la API de Personas (registro civil) por número de CI, para
// autocompletar el formulario de "Nuevo Cliente" — no persiste nada, solo
// devuelve los datos ya mapeados a nuestro formato.
//
// Algunos registros tienen numeroDocumento vacío en la API de Personas y
// solo son ubicables por su codigo interno (ver API-V2.md §3) — para quien
// usa el sistema, el número que tiene a mano es "su documento", sin
// distinguir si técnicamente es numeroDocumento o codigo. Si la búsqueda por
// documento no encuentra nada, probamos el mismo valor como codigo antes de
// darnos por vencidos.
async function buscarPorDocumento(numeroDocumento) {
  const persona = await personasClient.buscarPorDocumento(numeroDocumento);
  if (persona) return _mapPersona(persona);

  const porCodigo = await personasClient.buscarPorCodigo(numeroDocumento);
  return porCodigo ? _mapPersona(porCodigo) : null;
}

// Búsqueda por nombre completo (para cuando no se tiene el número de
// documento a mano) — la API exige mínimo 3 caracteres útiles, así que acá
// se corta antes de pegarle a la red con búsquedas inútiles.
async function buscarPorNombre(q) {
  if (!q || q.trim().length < 3) return [];
  const resultado = await personasClient.buscarPorNombre(q.trim());
  return (resultado.content || []).map(_mapPersona);
}

// Por "código" (PK interna) — para los registros sin numero_documento, que
// no se pueden ubicar por el buscador de CI.
async function buscarPorCodigo(codigo) {
  const persona = await personasClient.buscarPorCodigo(codigo);
  return persona ? _mapPersona(persona) : null;
}

module.exports = { listar, obtener, crear, actualizar, buscarPorDocumento, buscarPorNombre, buscarPorCodigo };
