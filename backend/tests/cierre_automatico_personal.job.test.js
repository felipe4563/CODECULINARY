const bcrypt = require('bcryptjs');
const { Sucursal, Rol, Usuario, HorarioPersonal, MarcacionPersonal } = require('../src/models');
const { cerrarMarcacionesAbandonadas } = require('../src/jobs/cierreAutomaticoPersonal.job');

function _fechaHaceDias(dias) {
  return new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function _diaSemanaDeFecha(fecha) {
  return new Date(`${fecha}T12:00:00Z`).getUTCDay();
}
function _fechaMasDias(fecha, dias) {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

describe('Job: cierre automático de marcaciones de personal', () => {
  let sucursalId, usuarioId;

  beforeAll(async () => {
    const ts = Date.now();
    const sucursal = await Sucursal.create({ nombre: `Sucursal CierreAuto Test ${ts}` });
    sucursalId = sucursal.id;
    const rol = await Rol.findOne({ where: { nombre: 'Mozo' } });
    const hash = await bcrypt.hash('clave123', 10);
    const usuario = await Usuario.create({ rol_id: rol.id, nombre: `CierreAuto Test ${ts}`, email: `cierreauto-test-${ts}@restaurante.com`, contrasena: hash });
    usuarioId = usuario.id;
  });

  afterAll(async () => {
    await MarcacionPersonal.destroy({ where: { usuario_id: usuarioId } });
    await HorarioPersonal.destroy({ where: { usuario_id: usuarioId } });
    await Usuario.destroy({ where: { id: usuarioId } });
    await Sucursal.destroy({ where: { id: sucursalId } });
  });

  it('no toca una marcación abierta hace menos de 16 horas', async () => {
    const reciente = await MarcacionPersonal.create({
      usuario_id: usuarioId, sucursal_id: sucursalId, fecha: _fechaHaceDias(0),
      hora_entrada: new Date(Date.now() - 2 * 60 * 60 * 1000), estado: 'abierto',
    });
    await cerrarMarcacionesAbandonadas();
    await reciente.reload();
    expect(reciente.estado).toBe('abierto');
    await reciente.destroy();
  });

  it('cierra con la hora de salida del horario configurado ese día', async () => {
    const fecha = _fechaHaceDias(2);
    const diaSemana = _diaSemanaDeFecha(fecha);
    await HorarioPersonal.create({ usuario_id: usuarioId, dia_semana: diaSemana, trabaja: 1, hora_entrada: '08:00:00', hora_salida: '17:00:00' });
    const abandonada = await MarcacionPersonal.create({
      usuario_id: usuarioId, sucursal_id: sucursalId, fecha,
      hora_entrada: new Date(`${fecha}T08:00:00-04:00`), estado: 'abierto',
    });
    const { cerrados } = await cerrarMarcacionesAbandonadas();
    expect(cerrados).toBeGreaterThanOrEqual(1);
    await abandonada.reload();
    expect(abandonada.estado).toBe('cierre_automatico');
    expect(abandonada.verificacion_salida).toBe('sin_verificar');
    expect(abandonada.hora_salida.toISOString()).toBe(new Date(`${fecha}T17:00:00-04:00`).toISOString());
  });

  it('turno nocturno: si la salida configurada es "antes" que la entrada, la corre al día siguiente', async () => {
    const fecha = _fechaHaceDias(4);
    const diaSemana = _diaSemanaDeFecha(fecha);
    await HorarioPersonal.create({ usuario_id: usuarioId, dia_semana: diaSemana, trabaja: 1, hora_entrada: '22:00:00', hora_salida: '02:00:00' });
    const nocturno = await MarcacionPersonal.create({
      usuario_id: usuarioId, sucursal_id: sucursalId, fecha,
      hora_entrada: new Date(`${fecha}T22:00:00-04:00`), estado: 'abierto',
    });
    const { cerrados } = await cerrarMarcacionesAbandonadas();
    expect(cerrados).toBeGreaterThanOrEqual(1);
    await nocturno.reload();
    const fechaSiguiente = _fechaMasDias(fecha, 1);
    expect(nocturno.hora_salida.toISOString()).toBe(new Date(`${fechaSiguiente}T02:00:00-04:00`).toISOString());
  });

  it('sin horario configurado, usa entrada + 8 horas como tope', async () => {
    const fecha = _fechaHaceDias(6);
    const sinHorario = await MarcacionPersonal.create({
      usuario_id: usuarioId, sucursal_id: sucursalId, fecha,
      hora_entrada: new Date(`${fecha}T08:00:00-04:00`), estado: 'abierto',
    });
    const { cerrados } = await cerrarMarcacionesAbandonadas();
    expect(cerrados).toBeGreaterThanOrEqual(1);
    await sinHorario.reload();
    expect(sinHorario.hora_salida.toISOString()).toBe(new Date(`${fecha}T16:00:00-04:00`).toISOString());
  });
});
