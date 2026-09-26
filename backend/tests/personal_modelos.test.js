const bcrypt = require('bcryptjs');
const { Sucursal, Rol, Usuario, HorarioPersonal, MarcacionPersonal } = require('../src/models');

describe('Modelos de Control de Personal', () => {
  let sucursalId, usuarioId;

  beforeAll(async () => {
    const ts = Date.now();
    const sucursal = await Sucursal.create({
      nombre: `Sucursal Personal Test ${ts}`,
      latitud: -17.393800, longitud: -63.190500, radio_geocerca_metros: 200,
    });
    sucursalId = sucursal.id;
    const rol = await Rol.findOne({ where: { nombre: 'Mozo' } });
    const hash = await bcrypt.hash('clave123', 10);
    const usuario = await Usuario.create({
      rol_id: rol.id, nombre: `Personal Test ${ts}`,
      email: `personal-test-${ts}@restaurante.com`, contrasena: hash,
    });
    usuarioId = usuario.id;
  });

  afterAll(async () => {
    await MarcacionPersonal.destroy({ where: { usuario_id: usuarioId } });
    await HorarioPersonal.destroy({ where: { usuario_id: usuarioId } });
    await Usuario.destroy({ where: { id: usuarioId } });
    await Sucursal.destroy({ where: { id: sucursalId } });
  });

  it('la sucursal guarda su radio_geocerca_metros', async () => {
    const sucursal = await Sucursal.findByPk(sucursalId);
    expect(sucursal.radio_geocerca_metros).toBe(200);
  });

  it('crea un horario semanal asociado al usuario', async () => {
    await HorarioPersonal.create({ usuario_id: usuarioId, dia_semana: 1, trabaja: 1, hora_entrada: '08:00:00', hora_salida: '17:00:00' });
    const horarios = await HorarioPersonal.findAll({ where: { usuario_id: usuarioId } });
    expect(horarios).toHaveLength(1);
    expect(horarios[0].hora_entrada).toBe('08:00:00');
  });

  it('crea una marcación y resuelve sus asociaciones usuario/sucursal', async () => {
    const marcacion = await MarcacionPersonal.create({
      usuario_id: usuarioId, sucursal_id: sucursalId, fecha: '2026-09-26',
      hora_entrada: new Date('2026-09-26T08:00:00-04:00'), verificacion_entrada: 'ok', estado: 'abierto',
    });
    const conRelaciones = await MarcacionPersonal.findByPk(marcacion.id, {
      include: [{ model: Usuario, as: 'usuario' }, { model: Sucursal, as: 'sucursal' }],
    });
    expect(conRelaciones.usuario.id).toBe(usuarioId);
    expect(conRelaciones.sucursal.id).toBe(sucursalId);
    expect(conRelaciones.estado).toBe('abierto');
  });

  it('rechaza un valor fuera del enum de estado', async () => {
    await expect(MarcacionPersonal.create({
      usuario_id: usuarioId, sucursal_id: sucursalId, fecha: '2026-09-26',
      hora_entrada: new Date(), estado: 'invalido',
    })).rejects.toThrow();
  });
});
