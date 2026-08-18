const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Cliente, ClientePinVerificacion } = require('../../models');
const clientesService = require('../clientes/clientes.service');
const { enviarCodigoPin } = require('../../integrations/email/email.client');

const CODIGO_EXPIRA_MINUTOS = 10;
const CODIGO_INTENTOS_MAX = 5;
const PIN_REGEX = /^\d{4}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PIN_INTENTOS_MAX = 5;
const PIN_BLOQUEO_MINUTOS = 5;

function emitirToken(cliente_id) {
  return jwt.sign({ cliente_id, tipo: 'cliente' }, process.env.JWT_SECRET, { expiresIn: '180d' });
}

function _generarCodigo() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function _resolverCliente(numero_documento) {
  const cliente_id = await clientesService.resolverOCrearPorDocumento(numero_documento);
  if (!cliente_id) {
    throw Object.assign(new Error('No se pudo identificar ese CI. Verificá el número.'), { status: 404 });
  }
  return Cliente.findByPk(cliente_id);
}

async function estado(numero_documento) {
  const cliente = await _resolverCliente(numero_documento);
  return { tiene_pin: !!cliente.pin_hash };
}

async function solicitarPin({ numero_documento, pin, email }) {
  if (!PIN_REGEX.test(pin || '')) {
    throw Object.assign(new Error('El PIN debe ser de 4 dígitos'), { status: 400 });
  }
  if (!EMAIL_REGEX.test(email || '')) {
    throw Object.assign(new Error('Email inválido'), { status: 400 });
  }

  const cliente = await _resolverCliente(numero_documento);
  if (cliente.pin_hash) {
    throw Object.assign(new Error('Este CI ya tiene un PIN configurado'), { status: 409 });
  }

  const codigo = _generarCodigo();
  const [pin_hash, codigo_hash] = await Promise.all([
    bcrypt.hash(pin, 10),
    bcrypt.hash(codigo, 10),
  ]);

  await ClientePinVerificacion.destroy({ where: { cliente_id: cliente.id } });
  await ClientePinVerificacion.create({
    cliente_id: cliente.id,
    pin_hash,
    email,
    codigo_hash,
    intentos: 0,
    expira_en: new Date(Date.now() + CODIGO_EXPIRA_MINUTOS * 60_000),
  });

  await enviarCodigoPin({ to: email, codigo });
  return { ok: true };
}

async function confirmarPin({ numero_documento, codigo }) {
  const cliente = await _resolverCliente(numero_documento);
  const pendiente = await ClientePinVerificacion.findOne({ where: { cliente_id: cliente.id } });

  if (!pendiente || pendiente.expira_en < new Date()) {
    if (pendiente) await pendiente.destroy();
    throw Object.assign(new Error('Código vencido, pedí uno nuevo'), { status: 400 });
  }
  if (pendiente.intentos >= CODIGO_INTENTOS_MAX) {
    throw Object.assign(new Error('Demasiados intentos, pedí un código nuevo'), { status: 429 });
  }

  const coincide = await bcrypt.compare(String(codigo || ''), pendiente.codigo_hash);
  if (!coincide) {
    await pendiente.update({ intentos: pendiente.intentos + 1 });
    throw Object.assign(new Error('Código incorrecto'), { status: 400 });
  }

  await cliente.update({ pin_hash: pendiente.pin_hash, email: pendiente.email });
  await pendiente.destroy();

  return { token: emitirToken(cliente.id) };
}

async function verificarPin({ numero_documento, pin }) {
  const cliente = await _resolverCliente(numero_documento);
  if (!cliente.pin_hash) {
    throw Object.assign(new Error('Este CI todavía no tiene un PIN configurado'), { status: 409 });
  }

  if (cliente.pin_bloqueado_hasta && cliente.pin_bloqueado_hasta > new Date()) {
    throw Object.assign(new Error('Demasiados intentos, esperá unos minutos y volvé a intentar'), { status: 429 });
  }

  const coincide = await bcrypt.compare(String(pin || ''), cliente.pin_hash);
  if (!coincide) {
    const intentos = cliente.pin_intentos_fallidos + 1;
    if (intentos >= PIN_INTENTOS_MAX) {
      await cliente.update({ pin_intentos_fallidos: 0, pin_bloqueado_hasta: new Date(Date.now() + PIN_BLOQUEO_MINUTOS * 60_000) });
    } else {
      await cliente.update({ pin_intentos_fallidos: intentos });
    }
    throw Object.assign(new Error('PIN incorrecto'), { status: 401 });
  }

  await cliente.update({ pin_intentos_fallidos: 0 });
  return { token: emitirToken(cliente.id) };
}

module.exports = { estado, solicitarPin, confirmarPin, verificarPin, emitirToken };
